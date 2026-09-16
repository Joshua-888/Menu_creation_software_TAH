/**
 * EXECUTE approved Bella CONTINUATION only.
 * - Verify existing #1
 * - Create remaining 11 hidden products
 * - NO category mutations, NO publication, NO QA
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
import { ACTIVE_CONSTITUTION_POLICIES } from "../src/intelligence/constitution.js";
import {
  assertAllowlistedAdminHost,
  blockWriteUnlessTargetLocked,
} from "../src/tah/write/targetLock.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { createTahPlaywrightDestinationPort } from "../src/runner/tahDestinationPort.js";
import {
  compareProductExact,
  compareProductFieldAware,
  type DestinationProduct,
} from "../src/runner/executor.js";
import type { PlannedProductPayload } from "../src/runner/writePlan.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prepDir = join(root, "runs", "bella-recovery-prep");
const planPath = join(
  root,
  "runs",
  "bella-continuation-prep",
  "BELLA_FINAL_CONTINUATION_RECOVERY_PLAN.json",
);
const runId = `bella-continuation_${randomUUID()}`;
const outDir = join(root, "runs", "bella-continuation-exec", runId);
mkdirSync(outDir, { recursive: true });

const AUTH = {
  productionSha: "97ab093a0cd91554e2398ce68f2b83fe7f74f815",
  sourceHash:
    "1b8acd9edcac1c6a7650ea8364a8feab03b624ad490fd654f01e1af89ac525b2",
  targetMenuHash:
    "607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e",
  destinationSnapshotHash:
    "e557443abad7eed417b7be87e66d83298609037d73090f7330c019ec6fa4f27b",
  recoveryPlanHash:
    "7c955a700d0b93f12fd7c7e0fb51ee33f33cf7f71f233333c2f329607969a589",
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
    recoveryPlanHash: AUTH.recoveryPlanHash,
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
    BELLA_CONTINUATION_SUCCESS: false,
    RECOVERY_REQUIRED: true,
    READY_FOR_BELLA_PUBLICATION_CERTIFICATION: false,
    finalExecutionState: "STOPPED",
    reason,
    ...extra,
    outDir,
  };
  writeArt("bella-continuation-execution-report.json", report);
  writeFileSync(
    join(outDir, "bella-continuation-execution-report.md"),
    `# BELLA CONTINUATION STOPPED\n\nreason: ${reason}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
  );
  console.error(JSON.stringify(report, null, 2));
  process.exit(2);
  throw new Error(reason);
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function destSnapHash(categories: unknown[], products: Array<{
  databaseId: string | null;
  menuNumber: string | null;
  name: string;
  statusText: string | null;
}>) {
  return sha({
    categories,
    products: products.map((p) => ({
      databaseId: p.databaseId,
      menuNumber: p.menuNumber,
      name: p.name,
      statusText: p.statusText,
    })),
  });
}

function toPayload(
  product: CanonicalMenu["categories"][0]["products"][0],
  categoryId: string,
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
    intendedHidden: true,
  };
}

// ---------- 1. Version lock ----------
const version = (await (
  await fetch("https://portal-production-7b78.up.railway.app/api/version")
).json()) as {
  commitSha: string;
  menuConstitution: string;
};
if (version.commitSha !== AUTH.productionSha) {
  stop("PRODUCTION_SHA_MISMATCH", { version });
}
if (version.menuConstitution !== "MenuConstitutionV1") {
  stop("CONSTITUTION_MISMATCH", { version });
}
if (
  !ACTIVE_CONSTITUTION_POLICIES.includes(
    "CATEGORY_QUALIFIED_PRODUCT_NAME_V1" as (typeof ACTIVE_CONSTITUTION_POLICIES)[number],
  )
) {
  stop("POLICY_NOT_ACTIVE_IN_CODE");
}

// ---------- 4. Load artifacts ----------
const targetMenu = JSON.parse(
  readFileSync(join(prepDir, "bella-target-menu.json"), "utf8"),
) as CanonicalMenu;
const targetHash = sha(targetMenu);
if (targetHash !== AUTH.targetMenuHash) {
  stop("TARGETMENU_HASH_MISMATCH", { targetHash });
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const planClone = JSON.parse(JSON.stringify(plan));
delete planClone.hashes.recoveryPlanHash;
delete planClone.hashes.continuationRecoveryPlanHash;
const planHash = sha(planClone);
if (planHash !== AUTH.recoveryPlanHash) {
  stop("RECOVERYPLAN_HASH_MISMATCH", {
    planHash,
    stored:
      plan.hashes?.continuationRecoveryPlanHash ??
      plan.hashes?.recoveryPlanHash,
  });
}
if (
  plan.operations.plannedCategoryCreates !== 0 ||
  plan.operations.plannedCategoryDeletes !== 0 ||
  plan.operations.plannedProductCreates !== 11 ||
  plan.operations.plannedProductUpdates !== 0 ||
  plan.operations.plannedProductDeletes !== 0 ||
  plan.operations.plannedPublicationOperations !== 0 ||
  plan.operations.plannedProductVerifyExisting !== 1
) {
  stop("PLAN_OPS_MISMATCH", { ops: plan.operations });
}

const qualityPath = join(prepDir, "bella-quality.json");
const quality = existsSync(qualityPath)
  ? JSON.parse(readFileSync(qualityPath, "utf8"))
  : plan.frozenIntelligence;
const ready = quality.statusAccounting?.ready ?? quality.ready;
const review = quality.statusAccounting?.review ?? quality.review;
const blocked = quality.statusAccounting?.blocked ?? quality.blocked;
if (ready !== 12 || review !== 0 || blocked !== 0) {
  stop("QUALITY_GATE_FAIL", { ready, review, blocked });
}

writeArt("approved-continuation-plan.json", { plan });

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

  // ---------- 2. Target lock ----------
  await page.goto(`https://${AUTH.host}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  const lock = assertAllowlistedAdminHost({
    pageUrl: page.url(),
    expectedHost: AUTH.host,
  });
  blockWriteUnlessTargetLocked(lock);
  if (normalizeHost(page.url()) !== AUTH.host) {
    stop("TARGET_HOST_MISMATCH", { url: page.url() });
  }

  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: `https://${AUTH.host}`,
    expectedHost: AUTH.host,
  });

  // ---------- 3. Fresh destination snapshot ----------
  const categories = await adapter.listCategories();
  const products = await adapter.listProducts();
  const currentDestHash = destSnapHash(categories, products);
  writeArt("pre-continuation-snapshot.json", {
    snapshot: {
      capturedAt: new Date().toISOString(),
      mutation: false,
      categories,
      products,
    },
    currentDestHash,
  });
  if (currentDestHash !== AUTH.destinationSnapshotHash) {
    stop("DESTINATION_CHANGED_SINCE_APPROVAL", {
      expected: AUTH.destinationSnapshotHash,
      actual: currentDestHash,
      categories: categories.map((c) => c.name),
      products: products.map((p) => ({
        menuNumber: p.menuNumber,
        name: p.name,
        status: p.statusText,
      })),
    });
  }

  const expectedCatNames = ["Burgers", "Durum", "Kebab", "Menuer", "Pita"];
  const destCats = [...categories.map((c) => c.name.trim())].sort((a, b) =>
    a.localeCompare(b, "da"),
  );
  if (
    destCats.length !== 5 ||
    !expectedCatNames.every(
      (n, i) =>
        n.toLocaleLowerCase("da-DK") === destCats[i]!.toLocaleLowerCase("da-DK"),
    )
  ) {
    stop("CATEGORY_SET_UNEXPECTED", { destCats });
  }
  if (products.length !== 1) {
    stop("PRODUCT_COUNT_UNEXPECTED_BEFORE_EXEC", {
      count: products.length,
      products,
    });
  }

  const categoryIdByName = new Map(
    categories.map((c) => [c.name.trim(), c.databaseId] as const),
  );

  const port = createTahPlaywrightDestinationPort({
    page,
    baseUrl: `https://${AUTH.host}`,
    expectedHost: AUTH.host,
    restaurantKey: AUTH.host,
    decisionStore: null,
  });

  // ---------- 5. Verify #1 first ----------
  const smash = targetMenu.categories
    .flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name })))
    .find((p) => /smash\s*burger/i.test(p.name));
  if (!smash) stop("SMASH_MISSING_FROM_TARGETMENU");
  const burgersId = categoryIdByName.get("Burgers");
  if (!burgersId) stop("BURGERS_CATEGORY_MISSING");

  const row1 = products.find(
    (p) => p.databaseId === "1" || (p.menuNumber || "").trim() === "1",
  );
  if (!row1?.databaseId) stop("PRODUCT_1_NOT_FOUND");
  const read1 = await port.readProduct(row1.databaseId);
  const payload1 = toPayload(smash!, burgersId);
  const report1 = compareProductFieldAware(payload1, read1);
  writeArt("existing-product-1-verification.json", {
    classification: report1.ok
      ? "VERIFIED_EXISTING_RECOVERY_ENTITY"
      : "MATERIAL_MISMATCH",
    payload1,
    read1,
    fieldReport: report1,
  });
  if (!report1.ok) {
    stop("PRODUCT_1_VERIFICATION_FAILED", {
      failingFields: report1.failingFields,
    });
  }
  if (read1.listStatus !== "Skjult") {
    stop("PRODUCT_1_NOT_HIDDEN", { listStatus: read1.listStatus });
  }

  // ---------- 7. Create remaining 11 ----------
  const toCreate = targetMenu.categories.flatMap((c) =>
    c.products
      .filter((p) => !/smash\s*burger/i.test(p.name))
      .map((p) => ({ categoryName: c.name, product: p })),
  );
  if (toCreate.length !== 11) {
    stop("CREATE_COUNT_MISMATCH", { n: toCreate.length });
  }

  const productResults: unknown[] = [];
  const fieldAwareResults: unknown[] = [];
  const representationEquivalentFields: string[] = [];
  let categoryMutations = 0;
  let publicationOps = 0;
  const unexpectedPublic: string[] = [];
  const verifiedCreates: DestinationProduct[] = [];

  for (const { categoryName, product } of toCreate) {
    if (normalizeHost(page.url()) !== AUTH.host) {
      await page.goto(`https://${AUTH.host}/admin/menu`, {
        waitUntil: "domcontentloaded",
      });
      const relock = assertAllowlistedAdminHost({
        pageUrl: page.url(),
        expectedHost: AUTH.host,
      });
      blockWriteUnlessTargetLocked(relock);
    }

    const catId = categoryIdByName.get(categoryName);
    if (!catId) stop("CATEGORY_ID_MISSING", { categoryName });

    // Guard: no category create/delete APIs invoked in this script
    if (categoryMutations !== 0) stop("CATEGORY_MUTATION_DRIFT");

    const payload = toPayload(product, catId!);
    const menuNumber = payload.menuNumber;

    const listedBefore = await adapter.listProducts();
    const preExist = listedBefore.find(
      (p) => (p.menuNumber || "").trim() === menuNumber,
    );
    if (preExist?.databaseId) {
      stop("UNEXPECTED_PREEXISTING_PRODUCT", {
        menuNumber,
        databaseId: preExist.databaseId,
      });
    }

    let createOutcome: {
      outcome: string;
      databaseId?: string;
      error?: string;
    };
    try {
      createOutcome = await port.createHiddenProduct(payload);
    } catch (e) {
      const listed = await adapter.listProducts();
      const found = listed.find(
        (p) =>
          (p.menuNumber || "").trim() === menuNumber ||
          p.name.trim().toLowerCase() === payload.name.trim().toLowerCase(),
      );
      writeArt("product-create-results.json", {
        productResults,
        failedAt: menuNumber,
        error: String(e),
      });
      if (found?.databaseId) {
        stop("AMBIGUOUS_CREATE_PERSISTED_UNVERIFIED", {
          menuNumber,
          databaseId: found.databaseId,
        });
      }
      stop("CREATE_THREW_NOT_PERSISTED", {
        menuNumber,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (createOutcome.outcome !== "CREATED" || !createOutcome.databaseId) {
      const listed = await adapter.listProducts();
      const found = listed.find(
        (p) => (p.menuNumber || "").trim() === menuNumber,
      );
      if (!found) {
        stop("NOT_PERSISTED", { menuNumber, createOutcome });
      }
      stop("PARTIAL_OR_AMBIGUOUS_CREATE", {
        menuNumber,
        createOutcome,
        found,
      });
    }

    const databaseId = createOutcome.databaseId!;
    const read = await port.readProduct(databaseId);
    const fieldReport = compareProductFieldAware(payload, read);
    const diffs = compareProductExact(payload, read);

    fieldAwareResults.push({
      menuNumber,
      name: payload.name,
      databaseId,
      fields: fieldReport.fields,
      ok: fieldReport.ok,
    });
    for (const f of fieldReport.fields) {
      if (f.result === "REPRESENTATION_EQUIVALENT") {
        representationEquivalentFields.push(`${menuNumber}.${f.field}`);
      }
    }

    if (read.listStatus !== "Skjult") {
      unexpectedPublic.push(`${menuNumber}:${read.name}:${read.listStatus}`);
      writeArt("field-aware-readback-results.json", {
        fieldAwareResults,
        failed: { menuNumber, read, diffs, fieldReport },
      });
      stop("UNEXPECTED_PUBLIC_VISIBILITY", {
        menuNumber,
        listStatus: read.listStatus,
      });
    }

    if (read.name !== payload.name) {
      stop("RECEIPT_SAFE_NAME_MISMATCH", {
        menuNumber,
        expected: payload.name,
        actual: read.name,
      });
    }

    if (diffs.length > 0) {
      writeArt("field-aware-readback-results.json", {
        fieldAwareResults,
        failed: { menuNumber, payload, read, diffs, fieldReport },
      });
      writeArt("product-create-results.json", {
        productResults,
        failedAt: menuNumber,
      });
      stop("SEMANTIC_MISMATCH", {
        menuNumber,
        diffs,
        fieldReport,
      });
    }

    productResults.push({
      menuNumber,
      name: payload.name,
      categoryName,
      databaseId,
      outcome: "VERIFIED",
      listStatus: read.listStatus,
      representationEquivalentFields: fieldReport.representationEquivalentFields,
    });
    verifiedCreates.push(read);
    writeArt("product-create-results.json", {
      planned: 11,
      completed: productResults.length,
      productResults,
    });
    writeArt("field-aware-readback-results.json", {
      verified: fieldAwareResults.length,
      fieldAwareResults,
    });
  }

  // ---------- 14–16. Full menu verification ----------
  const finalCats = await adapter.listCategories();
  const finalProducts = await adapter.listProducts();
  writeArt("post-continuation-snapshot.json", {
    snapshot: {
      capturedAt: new Date().toISOString(),
      categories: finalCats,
      products: finalProducts,
    },
  });

  if (finalCats.length !== 5) {
    stop("POST_CATEGORY_COUNT_DRIFT", { n: finalCats.length });
  }
  // Ensure category set unchanged (no mutations)
  const finalCatNames = [...finalCats.map((c) => c.name.trim())].sort((a, b) =>
    a.localeCompare(b, "da"),
  );
  if (
    !expectedCatNames.every(
      (n, i) =>
        n.toLocaleLowerCase("da-DK") ===
        finalCatNames[i]!.toLocaleLowerCase("da-DK"),
    )
  ) {
    stop("POST_CATEGORY_SET_CHANGED", { finalCatNames });
  }

  const deep: DestinationProduct[] = [];
  for (const row of finalProducts) {
    if (!row.databaseId) continue;
    deep.push(await port.readProduct(row.databaseId));
  }

  const plannedAll = targetMenu.categories.flatMap((c) =>
    c.products.map((p) => ({ categoryName: c.name, product: p })),
  );
  const missing: string[] = [];
  const unexpected: string[] = [];
  const mismatches: unknown[] = [];
  let verifiedTotal = 0;
  const receiptChecks: unknown[] = [];

  for (const { categoryName, product } of plannedAll) {
    const catId = categoryIdByName.get(categoryName)!;
    const payload = toPayload(product, catId);
    const actual = deep.find((p) => p.menuNumber === payload.menuNumber);
    if (!actual) {
      missing.push(payload.menuNumber);
      continue;
    }
    const report = compareProductFieldAware(payload, actual);
    if (!report.ok) {
      mismatches.push({
        menuNumber: payload.menuNumber,
        failingFields: report.failingFields,
      });
    } else {
      verifiedTotal += 1;
    }
    if (actual.listStatus !== "Skjult") {
      unexpectedPublic.push(
        `${payload.menuNumber}:${actual.name}:${actual.listStatus}`,
      );
    }
    const receiptOk = isProductNameReceiptSafe({
      productName: actual.name,
      categoryName,
    });
    receiptChecks.push({
      menuNumber: payload.menuNumber,
      name: actual.name,
      categoryName,
      pass: receiptOk,
    });
  }

  for (const p of deep) {
    const planned = plannedAll.some(
      (x) =>
        String(x.product.assignedMenuNumber ?? x.product.sourceMenuNumber) ===
        p.menuNumber,
    );
    if (!planned) unexpected.push(`${p.menuNumber}:${p.name}`);
  }

  const receiptFail = receiptChecks.filter(
    (c) => !(c as { pass: boolean }).pass,
  );
  writeArt("receipt-safe-name-verification.json", {
    checks: receiptChecks,
    failCount: receiptFail.length,
  });

  const targetEquality =
    missing.length === 0 &&
    unexpected.length === 0 &&
    mismatches.length === 0 &&
    deep.length === 12 &&
    verifiedTotal === 12 &&
    receiptFail.length === 0 &&
    unexpectedPublic.length === 0;

  writeArt("target-vs-destination-comparison.json", {
    expectedProducts: 12,
    actualProducts: deep.length,
    verifiedTotal,
    missing,
    unexpected,
    mismatches,
    representationEquivalentFields,
    targetEquality,
  });

  const success =
    targetEquality &&
    productResults.length === 11 &&
    categoryMutations === 0 &&
    publicationOps === 0;

  const finalReport = {
    BELLA_CONTINUATION_SUCCESS: success,
    RECOVERY_REQUIRED: !success,
    READY_FOR_BELLA_PUBLICATION_CERTIFICATION: success,
    PRECONDITIONS: {
      productionShaMatch: true,
      targetHostMatch: true,
      destinationSnapshotHashMatch: true,
      targetMenuHashMatch: true,
      recoveryPlanHashMatch: true,
      READY: ready,
      REVIEW: review,
      BLOCKED: blocked,
    },
    EXISTING_PRODUCT: {
      found: true,
      dbId: row1.databaseId,
      semanticVerification: "PASS",
      visibility: read1.listStatus,
      classification: "VERIFIED_EXISTING_RECOVERY_ENTITY",
    },
    EXECUTION: {
      plannedCreates: 11,
      actualCreates: productResults.length,
      verifiedCreates: verifiedCreates.length,
      failedOperations: success ? 0 : 1,
      ambiguousOperations: 0,
      duplicates: 0,
      categoryMutations: 0,
    },
    FINAL_MENU: {
      expectedProductCount: 12,
      actualProductCount: deep.length,
      verifiedTotal,
      missing,
      unexpected,
      semanticMismatches: mismatches,
      representationEquivalentFields,
      receiptSafeFailCount: receiptFail.length,
      targetMenuEquality: targetEquality ? "PASS" : "FAIL",
    },
    VISIBILITY: {
      hiddenStaged: deep.filter((p) => p.listStatus === "Skjult").length,
      unexpectedPublic,
      publicationOperations: 0,
    },
    outDir,
  };

  writeArt("bella-continuation-execution-report.json", finalReport);
  writeFileSync(
    join(outDir, "bella-continuation-execution-report.md"),
    `# BELLA CONTINUATION EXECUTION REPORT

BELLA_CONTINUATION_SUCCESS = ${success ? "YES" : "NO"}
RECOVERY_REQUIRED = ${success ? "NO" : "YES"}
READY_FOR_BELLA_PUBLICATION_CERTIFICATION = ${success ? "YES" : "NO"}

## Preconditions
- Production SHA: ${AUTH.productionSha}
- TargetMenu: ${AUTH.targetMenuHash}
- Destination: ${AUTH.destinationSnapshotHash}
- RecoveryPlan: ${AUTH.recoveryPlanHash}
- READY/REVIEW/BLOCKED: ${ready}/${review}/${blocked}

## Existing #1
- dbId=${row1.databaseId} visibility=${read1.listStatus} VERIFIED

## Execution
- creates ${productResults.length}/11 verified
- categoryMutations=0 publication=0

## Final menu
- products ${deep.length}/12 verified=${verifiedTotal}
- TargetMenu equality=${targetEquality ? "PASS" : "FAIL"}
- receipt-safe fails=${receiptFail.length}

\`\`\`json
${JSON.stringify(finalReport, null, 2)}
\`\`\`
`,
  );

  console.log(JSON.stringify(finalReport, null, 2));
  if (!success) process.exit(2);
} finally {
  await browser.close();
}
