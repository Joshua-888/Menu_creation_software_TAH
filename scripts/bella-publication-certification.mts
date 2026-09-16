/**
 * BELLA PUBLICATION CERTIFICATION
 * Visibility/availability only — no content mutation, no QA, no category ops.
 *
 * Mechanism (audited):
 * - Per-product edit form #active (Aktiv?) + Opdater submit
 * - checked = AVAILABLE, unchecked = HIDDEN (HUMAN_CONFIRMED)
 * - Category visibility: none (categories already public nav)
 * - Not a menu-wide publish switch
 * - Global setProductAvailable remains UNCERTIFIED; this is a scoped Bella run
 */
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { MENU_CONSTITUTION_VERSION } from "../src/intelligence/constitution.js";
import {
  CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  isProductNameReceiptSafe,
} from "../src/intelligence/categoryQualifiedProductName.js";
import {
  assertAllowlistedAdminHost,
  blockWriteUnlessTargetLocked,
} from "../src/tah/write/targetLock.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { setActiveCheckbox } from "../src/tah/write/formFill.js";
import { clickOpdaterAndObserveUpdate } from "../src/tah/write/updateRequestObserve.js";
import { createTahPlaywrightDestinationPort } from "../src/runner/tahDestinationPort.js";
import {
  compareProductExact,
  compareProductFieldAware,
} from "../src/runner/executor.js";
import type { PlannedProductPayload } from "../src/runner/writePlan.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prepDir = join(root, "runs", "bella-recovery-prep");
const runId = `bella-publication_${randomUUID()}`;
const outDir = join(root, "runs", "bella-publication", runId);
mkdirSync(outDir, { recursive: true });

const AUTH = {
  productionSha: "97ab093a0cd91554e2398ce68f2b83fe7f74f815",
  sourceHash:
    "1b8acd9edcac1c6a7650ea8364a8feab03b624ad490fd654f01e1af89ac525b2",
  targetMenuHash:
    "607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e",
  host: "bellakebab.dk",
  merchant: "Bella Kebab",
  policyVersion: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
} as const;

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(join(root, ".env"));

function sha(o: unknown) {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex");
}

function meta() {
  return {
    runId,
    productionSha: AUTH.productionSha,
    sourceHash: AUTH.sourceHash,
    targetMenuHash: AUTH.targetMenuHash,
    policyVersion: AUTH.policyVersion,
    constitutionVersion: MENU_CONSTITUTION_VERSION,
    timestamp: new Date().toISOString(),
  };
}

function writeArt(name: string, body: unknown) {
  writeFileSync(
    join(outDir, name),
    JSON.stringify({ ...meta(), ...(body as object) }, null, 2),
  );
}

function stop(reason: string, extra: Record<string, unknown> = {}): never {
  const report = {
    BELLA_PUBLICATION_SUCCESS: false,
    BELLA_MENU_STATE: "PUBLICATION_STOPPED",
    reason,
    ...extra,
    outDir,
  };
  writeArt("bella-publication-certification-report.json", report);
  writeFileSync(
    join(outDir, "bella-publication-certification-report.md"),
    `# BELLA PUBLICATION STOPPED\n\nreason: ${reason}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
  );
  console.error(JSON.stringify(report, null, 2));
  process.exit(2);
  throw new Error(reason);
}

function toPayload(
  product: CanonicalMenu["categories"][0]["products"][0],
  categoryId: string,
  intendedHidden: boolean,
): PlannedProductPayload {
  const menuNumber = String(
    product.assignedMenuNumber ?? product.sourceMenuNumber ?? "",
  );
  return {
    sourceId: product.sourceId,
    menuNumber,
    name: product.name,
    description: String(product.description ?? ""),
    basePriceOre: Number(product.basePrice ?? 0),
    categoryIds: [categoryId],
    variants:
      product.variants.length > 0
        ? product.variants.map((v) => ({
            name: v.name,
            surchargeOre: v.surcharge ?? 0,
          }))
        : [{ name: "Alm.", surchargeOre: 0 }],
    ingredients: product.ingredients.map((i) => i.display),
    additions: product.addOns.map((a) => ({
      name: a.name,
      priceOre: a.price ?? 0,
    })),
    intendedHidden,
  };
}

function contentDiffsOnly(
  payloadHidden: PlannedProductPayload,
  actual: {
    menuNumber: string;
    name: string;
    description: string;
    basePriceOre: number;
    categoryIds: string[];
    variants: Array<{ name: string; priceOre: number }>;
    ingredients: Array<{ name: string }>;
    additions: Array<{ name: string; priceOre: number }>;
    listStatus: string;
  },
) {
  // Compare content as if still hidden; ignore visibility by using field-aware
  // with intendedHidden matching actual, then strip visibility failures.
  const intendedHidden = /skjult/i.test(actual.listStatus);
  const report = compareProductFieldAware(
    { ...payloadHidden, intendedHidden },
    actual,
  );
  const contentFails = report.fields.filter(
    (f) => f.field !== "visibility" && f.result === "SEMANTIC_MISMATCH",
  );
  const exact = compareProductExact(
    { ...payloadHidden, intendedHidden },
    actual,
  ).filter((d) => d !== "listStatus" && d !== "visibility");
  return { contentFails, exact, report };
}

// ---------- Version lock ----------
const version = (await (
  await fetch("https://portal-production-7b78.up.railway.app/api/version")
).json()) as { commitSha: string; menuConstitution: string };
if (version.commitSha !== AUTH.productionSha) {
  stop("PRODUCTION_SHA_MISMATCH", { version });
}

const targetMenu = JSON.parse(
  readFileSync(join(prepDir, "bella-target-menu.json"), "utf8"),
) as CanonicalMenu;
if (sha(targetMenu) !== AUTH.targetMenuHash) {
  stop("TARGETMENU_HASH_MISMATCH");
}
const sourceHash = createHash("sha256")
  .update(
    readFileSync(join(root, "fixtures/golden/bella-kebab/raw-source.jpeg")),
  )
  .digest("hex");
if (sourceHash !== AUTH.sourceHash) stop("SOURCE_HASH_MISMATCH", { sourceHash });

const email = process.env.TAH_ADMIN_EMAIL?.trim();
const password = process.env.TAH_ADMIN_PASSWORD?.trim();
if (!email || !password) stop("missing_TAH_ADMIN_credentials");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`https://${AUTH.host}/login`, {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);

  await page.goto(`https://${AUTH.host}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  const lock = assertAllowlistedAdminHost({
    pageUrl: page.url(),
    expectedHost: AUTH.host,
  });
  blockWriteUnlessTargetLocked(lock);

  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: `https://${AUTH.host}`,
    expectedHost: AUTH.host,
  });
  const port = createTahPlaywrightDestinationPort({
    page,
    baseUrl: `https://${AUTH.host}`,
    expectedHost: AUTH.host,
    restaurantKey: AUTH.host,
    decisionStore: null,
  });

  // ---------- 1. RO precheck ----------
  const categories = await adapter.listCategories();
  const products = await adapter.listProducts();
  const expectedCats = ["Burgers", "Durum", "Kebab", "Menuer", "Pita"];
  const destCats = [...categories.map((c) => c.name.trim())].sort((a, b) =>
    a.localeCompare(b, "da"),
  );
  if (
    destCats.length !== 5 ||
    !expectedCats.every(
      (n, i) =>
        n.toLocaleLowerCase("da-DK") === destCats[i]!.toLocaleLowerCase("da-DK"),
    )
  ) {
    stop("CATEGORY_SET_UNEXPECTED", { destCats });
  }
  if (products.length !== 12) {
    stop("PRODUCT_COUNT_UNEXPECTED", { count: products.length });
  }
  const notHidden = products.filter(
    (p) => !/skjult/i.test((p.statusText || "").trim()),
  );
  if (notHidden.length > 0) {
    stop("PRECHECK_NOT_ALL_HIDDEN", {
      notHidden: notHidden.map((p) => ({
        id: p.databaseId,
        name: p.name,
        status: p.statusText,
      })),
    });
  }

  const categoryIdByName = new Map(
    categories.map((c) => [c.name.trim(), c.databaseId] as const),
  );
  const targetProducts = targetMenu.categories.flatMap((c) =>
    c.products.map((p) => ({
      categoryName: c.name,
      product: p,
      menuNumber: String(p.assignedMenuNumber ?? p.sourceMenuNumber ?? ""),
    })),
  );
  if (targetProducts.length !== 12) {
    stop("TARGETMENU_PRODUCT_COUNT", { n: targetProducts.length });
  }

  // Semantic precheck vs TargetMenu (hidden)
  const precheckMismatches: unknown[] = [];
  for (const tp of targetProducts) {
    const row = products.find(
      (p) => (p.menuNumber || "").trim() === tp.menuNumber,
    );
    if (!row?.databaseId) {
      precheckMismatches.push({ menuNumber: tp.menuNumber, reason: "missing" });
      continue;
    }
    const catId = categoryIdByName.get(tp.categoryName);
    if (!catId) {
      precheckMismatches.push({
        menuNumber: tp.menuNumber,
        reason: "category_missing",
      });
      continue;
    }
    const read = await port.readProduct(row.databaseId);
    const payload = toPayload(tp.product, catId, true);
    const report = compareProductFieldAware(payload, {
      ...read,
      listStatus: row.statusText ?? read.listStatus,
    });
    if (!report.ok) {
      precheckMismatches.push({
        menuNumber: tp.menuNumber,
        failingFields: report.failingFields,
      });
    }
  }
  if (precheckMismatches.length > 0) {
    stop("PRECHECK_TARGETMENU_EQUALITY_FAIL", { precheckMismatches });
  }

  writeArt("precheck-snapshot.json", {
    categories,
    products: products.map((p) => ({
      databaseId: p.databaseId,
      menuNumber: p.menuNumber,
      name: p.name,
      statusText: p.statusText,
      categoryText: p.categoryText,
      priceText: p.priceText,
    })),
    hiddenCount: 12,
    targetMenuEquality: "PASS",
  });

  // ---------- 2. Audit publication capability ----------
  const capabilityAudit = {
    mechanism:
      "Per-product edit form #active (Aktiv?) checkbox + Opdater submit",
    mapping: {
      checked: "AVAILABLE / storefront-visible",
      unchecked: "HIDDEN / Skjult",
      evidence: "HUMAN_CONFIRMED",
    },
    categoryVisibility: {
      exists: false,
      note: "TAH has no category Aktiv?/visibility; nav labels already public",
    },
    scope: "per_product",
    menuWidePublishSwitch: false,
    mustToggleIndividually: true,
    storefrontChanges: "after Opdater persist (not checkbox alone)",
    readBack: [
      "admin list statusText must not be Skjult",
      "field-aware content verify vs TargetMenu",
      "storefront body text product presence",
    ],
    globalCapability: {
      setProductAvailable: "UNCERTIFIED",
      note: "This run uses scoped #active+Opdater protocol (same as m68b pasta activate); does not globally CERTIFY setProductAvailable",
    },
    contentMutationRisk:
      "Opdater submits full form; protocol only toggles #active — then content re-verified",
  };
  writeArt("publication-capability-audit.json", capabilityAudit);

  // ---------- 3–4. Immutable publication plan + preview ----------
  const planOps = targetProducts
    .map((tp) => {
      const row = products.find(
        (p) => (p.menuNumber || "").trim() === tp.menuNumber,
      )!;
      return {
        sequence: 0,
        databaseId: row.databaseId!,
        menuNumber: tp.menuNumber,
        name: tp.product.name,
        categoryName: tp.categoryName,
        currentStatus: (row.statusText || "").trim(),
        targetStatus: "AVAILABLE (not Skjult)",
        operation: "SET_ACTIVE_TRUE_AND_OPDATER",
        contentUpdates: 0,
      };
    })
    .sort((a, b) => Number(a.menuNumber) - Number(b.menuNumber))
    .map((op, i) => ({ ...op, sequence: i + 1 }));

  const publicationPlan = {
    planKind: "BELLA_PUBLICATION_VISIBILITY_ONLY",
    executeAutomatically: true,
    authorizedBy: "BELLA_PUBLICATION_CERTIFICATION_PROMPT",
    operations: {
      plannedPublicationOperations: 12,
      plannedProductCreates: 0,
      plannedProductDeletes: 0,
      plannedProductContentUpdates: 0,
      plannedCategoryCreates: 0,
      plannedCategoryDeletes: 0,
      plannedCategoryUpdates: 0,
    },
    products: planOps,
    hashes: {
      productionSha: AUTH.productionSha,
      sourceHash: AUTH.sourceHash,
      targetMenuHash: AUTH.targetMenuHash,
    },
  };
  const planClone = JSON.parse(JSON.stringify(publicationPlan));
  delete (planClone as { planHash?: string }).planHash;
  const planHash = sha(planClone);
  (publicationPlan as { planHash?: string }).planHash = planHash;
  writeArt("bella-publication-plan.json", { plan: publicationPlan });
  writeArt("bella-publication-plan-preview.json", {
    productsToPublish: planOps.map((p) => ({
      databaseId: p.databaseId,
      menuNumber: p.menuNumber,
      name: p.name,
      currentStatus: p.currentStatus,
      targetStatus: p.targetStatus,
    })),
    counts: publicationPlan.operations,
  });

  console.log(
    JSON.stringify(
      {
        phase: "PUBLICATION_PLAN_PREVIEW",
        planHash,
        products: planOps.length,
        ops: publicationPlan.operations,
      },
      null,
      2,
    ),
  );

  if (
    publicationPlan.operations.plannedPublicationOperations !== 12 ||
    publicationPlan.operations.plannedProductCreates !== 0 ||
    publicationPlan.operations.plannedProductDeletes !== 0 ||
    publicationPlan.operations.plannedProductContentUpdates !== 0 ||
    publicationPlan.operations.plannedCategoryCreates !== 0 ||
    publicationPlan.operations.plannedCategoryDeletes !== 0
  ) {
    stop("PLAN_OPS_MISMATCH", { ops: publicationPlan.operations });
  }

  // ---------- 5. Execute sequentially ----------
  const publishResults: unknown[] = [];
  const unexpectedContentChanges: unknown[] = [];
  const failedOps: unknown[] = [];
  let verifiedPublished = 0;

  for (const op of planOps) {
    if (!page.url().includes(AUTH.host) || !page.url().includes("/admin/")) {
      await page.goto(`https://${AUTH.host}/admin/menu`, {
        waitUntil: "domcontentloaded",
      });
    }
    blockWriteUnlessTargetLocked(
      assertAllowlistedAdminHost({
        pageUrl: page.url(),
        expectedHost: AUTH.host,
      }),
    );

    const tp = targetProducts.find((t) => t.menuNumber === op.menuNumber)!;
    const catId = categoryIdByName.get(tp.categoryName)!;
    const contentPayload = toPayload(tp.product, catId, true);
    const livePayload = toPayload(tp.product, catId, false);

    // Capture content before publish
    const before = await port.readProduct(op.databaseId);
    const beforeCheck = contentDiffsOnly(contentPayload, {
      ...before,
      listStatus: "Skjult",
    });
    if (beforeCheck.contentFails.length > 0 || beforeCheck.exact.length > 0) {
      stop("PRE_PUBLISH_CONTENT_DRIFT", {
        menuNumber: op.menuNumber,
        beforeCheck,
      });
    }

    await page.goto(
      `https://${AUTH.host}/admin/menu/${op.databaseId}/edit`,
      { waitUntil: "domcontentloaded" },
    );
    await dismissKnownCookieBanner(page);
    blockWriteUnlessTargetLocked(
      assertAllowlistedAdminHost({
        pageUrl: page.url(),
        expectedHost: AUTH.host,
      }),
    );

    const nameVal = await page
      .locator("form:has(#menu_number) #name")
      .inputValue();
    if (nameVal.trim() !== op.name) {
      stop("EDIT_NAME_MISMATCH_BEFORE_PUBLISH", {
        expected: op.name,
        actual: nameVal,
        databaseId: op.databaseId,
      });
    }

    // Visibility ONLY
    await setActiveCheckbox(page, false);

    const observed = await clickOpdaterAndObserveUpdate({
      page,
      databaseId: op.databaseId,
      timeoutMs: 25_000,
    });
    if (!observed.ok) {
      failedOps.push({
        menuNumber: op.menuNumber,
        error: `${observed.code}${observed.detail ? `: ${observed.detail}` : ""}`,
      });
      stop("OPDATER_FAILED", {
        menuNumber: op.menuNumber,
        observed,
        failedOps,
        publishResults,
      });
    }
    if (observed.response.status >= 400) {
      failedOps.push({
        menuNumber: op.menuNumber,
        error: `HTTP ${observed.response.status}`,
      });
      stop("OPDATER_HTTP_ERROR", {
        menuNumber: op.menuNumber,
        status: observed.response.status,
        failedOps,
        publishResults,
      });
    }

    await page.waitForTimeout(800);
    const listed = await adapter.listProducts();
    const row = listed.find((p) => p.databaseId === op.databaseId);
    const listStatus = (row?.statusText || "").trim();
    if (!row) {
      stop("PRODUCT_MISSING_AFTER_PUBLISH", { menuNumber: op.menuNumber });
    }
    if (/skjult/i.test(listStatus)) {
      failedOps.push({ menuNumber: op.menuNumber, listStatus });
      stop("STILL_HIDDEN_AFTER_PUBLISH", {
        menuNumber: op.menuNumber,
        listStatus,
        failedOps,
        publishResults,
      });
    }

    const after = await port.readProduct(op.databaseId);
    const afterWithStatus = { ...after, listStatus };
    const liveVerify = compareProductFieldAware(livePayload, afterWithStatus);
    const contentAfter = contentDiffsOnly(contentPayload, afterWithStatus);
    if (contentAfter.contentFails.length > 0 || contentAfter.exact.length > 0) {
      unexpectedContentChanges.push({
        menuNumber: op.menuNumber,
        contentFails: contentAfter.contentFails,
        exact: contentAfter.exact,
      });
      writeArt("publication-results.json", {
        publishResults,
        unexpectedContentChanges,
        failedAt: op.menuNumber,
      });
      stop("UNEXPECTED_CONTENT_CHANGE", {
        menuNumber: op.menuNumber,
        contentAfter,
        publishResults,
      });
    }
    if (!liveVerify.ok) {
      // visibility or other
      const nonVis = liveVerify.fields.filter(
        (f) => f.result === "SEMANTIC_MISMATCH",
      );
      if (nonVis.length > 0) {
        unexpectedContentChanges.push({
          menuNumber: op.menuNumber,
          nonVis,
        });
        stop("POST_PUBLISH_VERIFY_FAIL", {
          menuNumber: op.menuNumber,
          failingFields: liveVerify.failingFields,
        });
      }
    }

    verifiedPublished += 1;
    publishResults.push({
      sequence: op.sequence,
      databaseId: op.databaseId,
      menuNumber: op.menuNumber,
      name: op.name,
      categoryName: op.categoryName,
      listStatusBefore: op.currentStatus,
      listStatusAfter: listStatus,
      outcome: "PUBLISHED_VERIFIED",
      opdaterStatus: observed.response.status,
      contentUnchanged: true,
    });
    writeArt("publication-results.json", {
      publishResults,
      verifiedPublished,
      failedOps,
      unexpectedContentChanges,
    });
  }

  // ---------- 6. Storefront verification ----------
  await page.goto(`https://${AUTH.host}/`, {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  await page.waitForTimeout(1500);
  const publicText = await page.locator("body").innerText();
  const publicLower = publicText.toLowerCase();

  const storefrontVisible: string[] = [];
  const storefrontMissing: string[] = [];
  const categoryNameSet = new Set(
    categories.map((c) => c.name.trim().toLowerCase()),
  );

  for (const op of planOps) {
    const nameHit = publicLower.includes(op.name.toLowerCase());
    const menuHit =
      publicLower.includes(`#${op.menuNumber}`) ||
      new RegExp(`(^|\\D)${op.menuNumber}(\\D|$)`).test(publicText);
    // For names that equal category labels, require menu number or stronger signal
    const overlapsCategory = categoryNameSet.has(op.name.toLowerCase());
    const visible = overlapsCategory ? nameHit && menuHit : nameHit;
    if (visible) storefrontVisible.push(op.menuNumber);
    else storefrontMissing.push(`${op.menuNumber}:${op.name}`);
  }

  writeArt("storefront-verification.json", {
    storefrontVisibleCount: storefrontVisible.length,
    storefrontVisible,
    storefrontMissing,
    categoryNavLikelyVisible: expectedCats.filter((c) =>
      publicLower.includes(c.toLowerCase()),
    ),
    publicTextSample: publicText.slice(0, 4000),
  });

  if (storefrontMissing.length > 0) {
    stop("STOREFRONT_MISSING_PRODUCTS", {
      storefrontMissing,
      storefrontVisible,
      verifiedPublished,
    });
  }

  // ---------- 7. Final menu content equality (visibility may differ) ----------
  await page.goto(`https://${AUTH.host}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  blockWriteUnlessTargetLocked(
    assertAllowlistedAdminHost({
      pageUrl: page.url(),
      expectedHost: AUTH.host,
    }),
  );
  const finalListed = await adapter.listProducts();
  if (finalListed.length !== 12) {
    stop("FINAL_PRODUCT_COUNT", { count: finalListed.length });
  }
  const duplicates = (() => {
    const seen = new Map<string, number>();
    for (const p of finalListed) {
      const k = (p.menuNumber || "").trim();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  })();
  if (duplicates.length > 0) stop("DUPLICATES", { duplicates });

  const finalUnexpected: string[] = [];
  const targetNums = new Set(targetProducts.map((t) => t.menuNumber));
  for (const p of finalListed) {
    const mn = (p.menuNumber || "").trim();
    if (!targetNums.has(mn)) finalUnexpected.push(`${mn}:${p.name}`);
  }
  if (finalUnexpected.length > 0) {
    stop("UNEXPECTED_PRODUCTS", { finalUnexpected });
  }

  const semanticMismatches: unknown[] = [];
  const receiptChecks: unknown[] = [];
  const representationEquivalentFields: string[] = [];

  for (const tp of targetProducts) {
    const row = finalListed.find(
      (p) => (p.menuNumber || "").trim() === tp.menuNumber,
    )!;
    const catId = categoryIdByName.get(tp.categoryName)!;
    const read = await port.readProduct(row.databaseId!);
    const livePayload = toPayload(tp.product, catId, false);
    const withStatus = {
      ...read,
      listStatus: row.statusText ?? read.listStatus,
    };
    const report = compareProductFieldAware(livePayload, withStatus);
    for (const f of report.fields) {
      if (f.result === "REPRESENTATION_EQUIVALENT") {
        representationEquivalentFields.push(`${tp.menuNumber}.${f.field}`);
      }
    }
    if (!report.ok) {
      semanticMismatches.push({
        menuNumber: tp.menuNumber,
        failingFields: report.failingFields,
      });
    }
    const receiptOk = isProductNameReceiptSafe({
      productName: read.name,
      categoryName: tp.categoryName,
    });
    receiptChecks.push({
      menuNumber: tp.menuNumber,
      name: read.name,
      pass: receiptOk && read.name === tp.product.name,
    });
  }

  writeArt("post-publication-targetmenu-comparison.json", {
    semanticMismatches,
    representationEquivalentFields,
    receiptChecks,
  });

  if (semanticMismatches.length > 0) {
    stop("POST_PUBLICATION_SEMANTIC_MISMATCH", { semanticMismatches });
  }
  const receiptFail = receiptChecks.filter(
    (c) => !(c as { pass: boolean }).pass,
  ).length;
  if (receiptFail > 0) {
    stop("RECEIPT_SAFE_FAIL", { receiptChecks });
  }

  const stillHidden = finalListed.filter((p) =>
    /skjult/i.test((p.statusText || "").trim()),
  );
  if (stillHidden.length > 0) {
    stop("SOME_STILL_HIDDEN", {
      stillHidden: stillHidden.map((p) => ({
        id: p.databaseId,
        name: p.name,
        status: p.statusText,
      })),
    });
  }

  const success =
    verifiedPublished === 12 &&
    failedOps.length === 0 &&
    unexpectedContentChanges.length === 0 &&
    storefrontVisible.length === 12 &&
    storefrontMissing.length === 0 &&
    finalUnexpected.length === 0 &&
    duplicates.length === 0 &&
    semanticMismatches.length === 0 &&
    receiptFail === 0 &&
    stillHidden.length === 0;

  const report = {
    BELLA_PUBLICATION_SUCCESS: success,
    BELLA_MENU_STATE: success ? "VERIFIED_LIVE" : "PUBLICATION_INCOMPLETE",
    CURRENT_HIDDEN_BEFORE: 12,
    PUBLICATION_MECHANISM: capabilityAudit.mechanism,
    PLANNED_PUBLICATION_OPERATIONS: 12,
    ACTUAL_PUBLICATION_OPERATIONS: verifiedPublished,
    VERIFIED_PUBLISHED_PRODUCTS: verifiedPublished,
    FAILED_PUBLICATION_OPERATIONS: failedOps.length,
    UNEXPECTED_CONTENT_CHANGES: unexpectedContentChanges.length,
    STOREFRONT_VISIBLE_PRODUCTS: storefrontVisible.length,
    MISSING_PRODUCTS: storefrontMissing,
    UNEXPECTED_PRODUCTS: finalUnexpected,
    DUPLICATE_PRODUCTS: duplicates,
    RECEIPT_SAFE_NAMING: receiptFail === 0 ? "PASS" : "FAIL",
    TARGETMENU_EQUALITY: semanticMismatches.length === 0 ? "PASS" : "FAIL",
    representationEquivalentFields,
    planHash,
    outDir,
  };

  writeArt("bella-publication-certification-report.json", report);
  writeFileSync(
    join(outDir, "bella-publication-certification-report.md"),
    `# BELLA PUBLICATION CERTIFICATION REPORT\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (!success) process.exit(2);
} finally {
  await browser.close();
}
