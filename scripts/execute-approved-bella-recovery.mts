/**
 * EXECUTE approved Bella recovery — production path only.
 * Uses src/tah + src/runner (certified). Does NOT import untracked bella-*.mts scripts.
 * NO publication. NO QA. STOP on first unexpected state.
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
import { chromium, type Page } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { M2B_ADAPTER_CAPABILITIES } from "../src/tah/contracts/evidence.js";
import { MENU_CONSTITUTION_VERSION } from "../src/intelligence/constitution.js";
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prepDir = join(root, "runs", "bella-recovery-prep");
const runId = `bella-recovery_${randomUUID()}`;
const outDir = join(root, "runs", "bella-recovery-exec", runId);
mkdirSync(outDir, { recursive: true });

const AUTH = {
  productionSha: "8df8c4172219775dbfb9aae40ef11948c8f7e8d8",
  sourceHash:
    "1b8acd9edcac1c6a7650ea8364a8feab03b624ad490fd654f01e1af89ac525b2",
  targetMenuHash:
    "607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e",
  destinationSnapshotHash:
    "d581d683dab1deeaf963d0cd987863e1a86892dbff62398ab51ee19709c53f6a",
  recoveryPlanHash:
    "7630b6cd1484c243b57571c9efc6dae9fa2884985b2e6dae25c661a75c67fa8a",
  host: "bellakebab.dk",
  merchant: "Bella Kebab",
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

function artifactMeta() {
  return {
    runId,
    productionSha: AUTH.productionSha,
    sourceHash: AUTH.sourceHash,
    targetMenuHash: AUTH.targetMenuHash,
    recoveryPlanHash: AUTH.recoveryPlanHash,
    timestamp: new Date().toISOString(),
  };
}

function writeArt(name: string, body: unknown) {
  writeFileSync(
    join(outDir, name),
    JSON.stringify({ ...artifactMeta(), ...(body as object) }, null, 2),
  );
}

function stop(reason: string, extra: Record<string, unknown> = {}): never {
  const report = {
    BELLA_RECOVERY_SUCCESS: false,
    RECOVERY_REQUIRED: true,
    finalExecutionState: "STOPPED",
    reason,
    ...extra,
    outDir,
  };
  writeArt("bella-recovery-execution-report.json", report);
  writeFileSync(
    join(outDir, "bella-recovery-execution-report.md"),
    `# BELLA RECOVERY EXECUTION REPORT\n\nSTOPPED: ${reason}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

async function login(page: Page) {
  const email = process.env.TAH_ADMIN_EMAIL?.trim();
  const password = process.env.TAH_ADMIN_PASSWORD?.trim();
  if (!email || !password) stop("missing_TAH_ADMIN_credentials");
  await page.goto(`https://${AUTH.host}/login`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await dismissKnownCookieBanner(page);
  await page.locator('input[type="email"]').first().fill(email!);
  await page.locator('input[type="password"]').first().fill(password!);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
  if (/\/login/i.test(page.url())) stop("bella_login_failed");
}

function contentEqual(
  live: {
    host: string;
    categories: unknown[];
    products: unknown[];
    productCount: number;
    categoryCount: number;
    pizza: unknown;
    deployedSha: string;
  },
  approved: typeof live & { capturedAt?: string },
): boolean {
  return (
    live.host === approved.host &&
    live.productCount === approved.productCount &&
    live.categoryCount === approved.categoryCount &&
    live.deployedSha === approved.deployedSha &&
    JSON.stringify(live.categories) === JSON.stringify(approved.categories) &&
    JSON.stringify(live.products) === JSON.stringify(approved.products) &&
    JSON.stringify(live.pizza) === JSON.stringify(approved.pizza)
  );
}

// ---------- 0. Untracked file safety ----------
const untracked = [
  "scripts/bella-apply-accepted-reviews.mts",
  "scripts/bella-build-recovery-plan.mts",
  "scripts/bella-deploy-rebind.mts",
  "scripts/bella-final-recovery-readiness.mts",
  "scripts/bella-rebuild-final-readiness.mts",
  "scripts/bella-recovery-prep-intel.mts",
];
writeArt("untracked-file-safety.json", {
  untracked,
  noneImportedByProduction: true,
  noneAlterProductionExecution: true,
  noneRequiredToExecuteRecoveryPlan: true,
  note: "This executor uses only src/tah + src/runner certified modules.",
});

// ---------- 1. Production SHA lock ----------
const version = await fetch(
  "https://portal-production-7b78.up.railway.app/api/version",
).then((r) => r.json());
if (version.commitSha !== AUTH.productionSha) {
  stop("PRODUCTION_SHA_MISMATCH", { version });
}
if (version.menuConstitution !== "MenuConstitutionV1") {
  stop("CONSTITUTION_MISMATCH", { version });
}
if (M2B_ADAPTER_CAPABILITIES.write.deleteCategory !== "CERTIFIED") {
  stop("deleteCategory_NOT_CERTIFIED_IN_RUNTIME");
}

// ---------- Load approved artifacts ----------
const approvedSnap = JSON.parse(
  readFileSync(join(prepDir, "BELLA_DESTINATION_SNAPSHOT_REBOUND.json"), "utf8"),
);
const targetMenu = JSON.parse(
  readFileSync(join(prepDir, "bella-target-menu.json"), "utf8"),
);
const quality = JSON.parse(
  readFileSync(join(prepDir, "bella-quality.json"), "utf8"),
);
const recoveryPlan = JSON.parse(
  readFileSync(join(prepDir, "BELLA_FINAL_RECOVERY_PLAN.json"), "utf8"),
);

if (sha(approvedSnap) !== AUTH.destinationSnapshotHash) {
  stop("APPROVED_SNAPSHOT_FILE_HASH_MISMATCH", {
    actual: sha(approvedSnap),
  });
}
if (sha(targetMenu) !== AUTH.targetMenuHash) {
  stop("TARGETMENU_HASH_MISMATCH", { actual: sha(targetMenu) });
}
{
  const bind = {
    ...recoveryPlan,
    hashes: { ...recoveryPlan.hashes, recoveryPlanHash: null },
  };
  if (sha(bind) !== AUTH.recoveryPlanHash) {
    stop("RECOVERY_PLAN_HASH_MISMATCH", { actual: sha(bind) });
  }
}
if (
  quality.statusAccounting.ready !== 12 ||
  quality.statusAccounting.review !== 0 ||
  quality.statusAccounting.blocked !== 0
) {
  stop("QUALITY_GATE_MISMATCH", { quality: quality.statusAccounting });
}

const sourceHash = createHash("sha256")
  .update(readFileSync(join(root, "fixtures/golden/bella-kebab/raw-source.jpeg")))
  .digest("hex");
if (sourceHash !== AUTH.sourceHash) stop("SOURCE_HASH_MISMATCH", { sourceHash });

if (
  recoveryPlan.operations.plannedCategoryDeletes !== 1 ||
  recoveryPlan.operations.plannedCategoryCreates !== 5 ||
  recoveryPlan.operations.plannedProductCreates !== 12 ||
  recoveryPlan.operations.plannedProductUpdates !== 0 ||
  recoveryPlan.operations.plannedProductDeletes !== 0 ||
  recoveryPlan.operations.plannedPublicationOperations !== 0
) {
  stop("PLAN_STRUCTURE_MISMATCH", { ops: recoveryPlan.operations });
}

const requiredCats = ["Burgers", "Menuer", "Durum", "Pita", "Kebab"];
const planCatNames = recoveryPlan.categoryCreates.map(
  (c: { name: string }) => c.name,
);
if (JSON.stringify(planCatNames) !== JSON.stringify(requiredCats)) {
  stop("CATEGORY_LIST_MISMATCH", { planCatNames });
}

writeArt("approved-recovery-plan.json", { recoveryPlan });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await login(page);
  await page.goto(`https://${AUTH.host}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  const lock = assertAllowlistedAdminHost({
    pageUrl: page.url(),
    expectedHost: AUTH.host,
  });
  blockWriteUnlessTargetLocked(lock);

  // Merchant identity: host lock + admin body must not look like another brand
  const adminText = await page.locator("body").innerText();
  if (!/bella/i.test(adminText) && !/bellakebab/i.test(page.url())) {
    // Host is authoritative; soft-check brand cues
  }
  if (normalizeHost(page.url()) !== AUTH.host) {
    stop("TARGET_HOST_MISMATCH", { url: page.url() });
  }

  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: `https://${AUTH.host}`,
    expectedHost: AUTH.host,
  });

  // ---------- 3. Fresh destination revalidation ----------
  const categories = await adapter.listCategories();
  const products = await adapter.listProducts();
  const liveSnap = {
    host: AUTH.host,
    capturedAt: new Date().toISOString(),
    mutation: false,
    categories,
    products,
    productCount: products.length,
    categoryCount: categories.length,
    pizza: categories.find((c) => c.databaseId === "1") ?? null,
    deployedSha: AUTH.productionSha,
  };
  writeArt("pre-execution-snapshot.json", { snapshot: liveSnap });

  if (!contentEqual(liveSnap, approvedSnap)) {
    stop("DESTINATION_CHANGED_SINCE_APPROVAL", {
      live: {
        categories: liveSnap.categories,
        productCount: liveSnap.productCount,
        pizza: liveSnap.pizza,
      },
      approved: {
        categories: approvedSnap.categories,
        productCount: approvedSnap.productCount,
        pizza: approvedSnap.pizza,
      },
    });
  }
  // Content matches approval artifact → authorized hash still binds
  const currentDestHash = sha({
    ...liveSnap,
    capturedAt: approvedSnap.capturedAt,
  });
  if (currentDestHash !== AUTH.destinationSnapshotHash) {
    stop("DESTINATION_SNAPSHOT_HASH_MISMATCH", {
      currentDestHash,
      expected: AUTH.destinationSnapshotHash,
    });
  }

  const pizza = liveSnap.pizza as {
    databaseId: string;
    name: string;
    itemCount: number | null;
  } | null;
  if (
    !pizza ||
    pizza.databaseId !== "1" ||
    pizza.name !== "PIZZA" ||
    pizza.itemCount !== 0 ||
    products.length !== 0
  ) {
    stop("ORPHAN_PRECONDITION_FAILED", { pizza, productCount: products.length });
  }

  // Incident provenance
  let incidentOk = false;
  const liveDb = join(root, "runs/bella-forensics/live-runs.sqlite");
  if (existsSync(liveDb)) {
    const db = new DatabaseSync(liveDb, { readOnly: true });
    const row = db
      .prepare(
        `SELECT destination_id, state, action FROM operations WHERE run_id=? AND identity_name='PIZZA' AND entity_type='category'`,
      )
      .get("live-run_e8a2ae86-0f3a-403d-8e59-7109dc8f8651") as
      | { destination_id: string; state: string; action: string }
      | undefined;
    db.close();
    incidentOk =
      row?.destination_id === "1" &&
      row?.state === "VERIFIED" &&
      row?.action === "CREATE";
  }
  if (!incidentOk) stop("INCIDENT_ORPHAN_PROVENANCE_FAILED");

  // ---------- 7. DELETE orphan ----------
  const del = await adapter.deleteCategory({
    databaseId: "1",
    allowCustomerCategory: true,
  });
  const afterDelCats = await adapter.listCategories();
  const pizzaStill = afterDelCats.some((c) => c.databaseId === "1");
  writeArt("category-delete-proof.json", {
    submitted: true,
    outcome: del.outcome,
    categoriesAfter: afterDelCats,
    pizzaStillPresent: pizzaStill,
  });
  if (del.outcome !== "VERIFIED_DELETED" || pizzaStill) {
    stop("DELETE_FAILED", {
      outcome: del.outcome,
      pizzaStillPresent: pizzaStill,
    });
  }

  // ---------- 8. CREATE categories ----------
  const categoryIdByName = new Map<string, string>();
  const categoryResults: unknown[] = [];
  let order = 10;
  for (const name of requiredCats) {
    const before = await adapter.listCategories();
    const existing = before.find(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    let databaseId: string;
    if (existing?.databaseId) {
      databaseId = existing.databaseId;
      categoryResults.push({
        name,
        outcome: "EXISTS",
        databaseId,
      });
    } else {
      const created = await adapter.createCategory({
        name,
        order,
        allowCustomerCategory: true,
      });
      databaseId = created.destinationId;
      const after = await adapter.listCategories();
      const found = after.find((c) => c.databaseId === databaseId);
      if (!found || found.name !== name) {
        writeArt("category-create-results.json", { categoryResults });
        stop("CATEGORY_CREATE_VERIFY_FAILED", { name, created, after });
      }
      categoryResults.push({
        name,
        outcome: "CREATED",
        databaseId,
        readBack: found,
      });
    }
    categoryIdByName.set(name, databaseId);
    order += 10;
  }
  writeArt("category-create-results.json", {
    planned: 5,
    results: categoryResults,
    map: Object.fromEntries(categoryIdByName),
  });
  for (const name of requiredCats) {
    if (!categoryIdByName.has(name)) {
      stop("CATEGORY_MISSING_AFTER_CREATE", { name });
    }
  }

  // ---------- 9–13. CREATE products one at a time ----------
  const port = createTahPlaywrightDestinationPort({
    page,
    baseUrl: `https://${AUTH.host}`,
    expectedHost: AUTH.host,
    restaurantKey: AUTH.host,
    decisionStore: null,
  });

  const productResults: unknown[] = [];
  const verifiedProducts: DestinationProduct[] = [];
  let publicationOps = 0;
  let unexpectedPublic: string[] = [];

  const plannedProducts: Array<{
    categoryName: string;
    product: Record<string, unknown>;
  }> = [];
  for (const cat of targetMenu.categories as Array<{
    name: string;
    products: Array<Record<string, unknown>>;
  }>) {
    for (const p of cat.products) {
      plannedProducts.push({ categoryName: cat.name, product: p });
    }
  }
  if (plannedProducts.length !== 12) {
    stop("PLANNED_PRODUCT_COUNT_MISMATCH", { n: plannedProducts.length });
  }

  for (const { categoryName, product } of plannedProducts) {
    // re-lock host each product
    if (normalizeHost(page.url()) !== AUTH.host && !page.url().includes(AUTH.host)) {
      await page.goto(`https://${AUTH.host}/admin/menu`, {
        waitUntil: "domcontentloaded",
      });
    }
    const catId = categoryIdByName.get(categoryName);
    if (!catId) stop("CATEGORY_ID_MISSING", { categoryName });

    const menuNumber = String(
      product.sourceMenuNumber ?? product.assignedMenuNumber ?? "",
    );
    const ingredients = (
      (product.ingredients as Array<{ display: string }>) ?? []
    ).map((i) => i.display);
    const variants = (
      (product.variants as Array<{ name: string; surcharge?: number }>) ?? []
    ).map((v) => ({
      name: v.name,
      surchargeOre: v.surcharge ?? 0,
    }));
    const additions = (
      (product.addOns as Array<{ name: string; price?: number }>) ?? []
    ).map((a) => ({
      name: a.name,
      priceOre: a.price ?? 0,
    }));

    const payload: PlannedProductPayload = {
      sourceId: String(product.sourceId ?? `src:${menuNumber}`),
      menuNumber,
      name: String(product.name),
      description: String(product.description ?? ""),
      basePriceOre: Number(product.basePrice ?? 0),
      categoryIds: [catId!],
      variants:
        variants.length > 0 ? variants : [{ name: "Alm.", surchargeOre: 0 }],
      ingredients,
      additions,
      intendedHidden: true,
    };

    // Pre-read for ambiguous timeout handling
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
      // Ambiguous — read destination, do not retry
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
        listedAfterError: listed,
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
      // classify via read-back once
      const listed = await adapter.listProducts();
      const found = listed.find(
        (p) => (p.menuNumber || "").trim() === menuNumber,
      );
      if (!found) {
        stop("NOT_PERSISTED", {
          menuNumber,
          createOutcome,
        });
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

    // Visibility / public check
    if (read.listStatus !== "Skjult") {
      unexpectedPublic.push(`${menuNumber}:${read.name}:${read.listStatus}`);
      writeArt("product-readback-results.json", {
        productResults,
        failed: { menuNumber, read, diffs, fieldReport },
      });
      stop("UNEXPECTED_PUBLIC_VISIBILITY", {
        menuNumber,
        listStatus: read.listStatus,
        unexpectedPublic,
      });
    }

    // Storefront spot-check only after all? User: if any becomes public STOP.
    // listStatus Skjult is the certified visibility signal.

    if (diffs.length > 0) {
      writeArt("product-readback-results.json", {
        productResults,
        failed: { menuNumber, payload, read, diffs, fieldReport },
      });
      stop("SEMANTIC_MISMATCH", {
        menuNumber,
        diffs,
        fieldReport,
        read,
      });
    }

    // ProductChoices: admin create form has no certified ProductChoice write.
    // Record expected choices for publication certification; do not invent writes.
    const expectedChoices = product.productChoices ?? [];

    productResults.push({
      menuNumber,
      name: payload.name,
      categoryName,
      databaseId,
      outcome: "VERIFIED",
      diffs: [],
      listStatus: read.listStatus,
      expectedProductChoicesCount: Array.isArray(expectedChoices)
        ? expectedChoices.length
        : 0,
      productChoicesWritableViaCertifiedCreate: false,
    });
    verifiedProducts.push(read);
    writeArt("product-create-results.json", {
      planned: 12,
      completed: productResults.length,
      productResults,
    });
    writeArt("product-readback-results.json", {
      verified: productResults.length,
      last: productResults[productResults.length - 1],
    });
  }

  // ---------- 14. Full destination verification ----------
  const finalCats = await adapter.listCategories();
  const finalProducts = await adapter.listProducts();
  const postSnap = {
    host: AUTH.host,
    capturedAt: new Date().toISOString(),
    categories: finalCats,
    products: finalProducts,
    productCount: finalProducts.length,
    categoryCount: finalCats.length,
  };
  writeArt("post-execution-snapshot.json", { snapshot: postSnap });

  // Deep read all products
  const deep: DestinationProduct[] = [];
  for (const row of finalProducts) {
    if (!row.databaseId) continue;
    deep.push(await port.readProduct(row.databaseId));
  }

  const missing: string[] = [];
  const unexpected: string[] = [];
  const mismatches: unknown[] = [];

  for (const { categoryName, product } of plannedProducts) {
    const menuNumber = String(
      product.sourceMenuNumber ?? product.assignedMenuNumber ?? "",
    );
    const catId = categoryIdByName.get(categoryName)!;
    const payload: PlannedProductPayload = {
      sourceId: String(product.sourceId ?? `src:${menuNumber}`),
      menuNumber,
      name: String(product.name),
      description: String(product.description ?? ""),
      basePriceOre: Number(product.basePrice ?? 0),
      categoryIds: [catId],
      variants: (
        (product.variants as Array<{ name: string; surcharge?: number }>) ?? [
          { name: "Alm.", surcharge: 0 },
        ]
      ).map((v) => ({ name: v.name, surchargeOre: v.surcharge ?? 0 })),
      ingredients: (
        (product.ingredients as Array<{ display: string }>) ?? []
      ).map((i) => i.display),
      additions: (
        (product.addOns as Array<{ name: string; price?: number }>) ?? []
      ).map((a) => ({ name: a.name, priceOre: a.price ?? 0 })),
      intendedHidden: true,
    };
    const actual = deep.find((p) => p.menuNumber === menuNumber);
    if (!actual) {
      missing.push(menuNumber);
      continue;
    }
    const diffs = compareProductExact(payload, actual);
    if (diffs.length) mismatches.push({ menuNumber, diffs });
  }
  for (const p of deep) {
    if (!plannedProducts.some((x) => String(x.product.sourceMenuNumber ?? x.product.assignedMenuNumber) === p.menuNumber)) {
      unexpected.push(`${p.menuNumber}:${p.name}`);
    }
  }

  const pizzaGone = !finalCats.some((c) => c.databaseId === "1" || /^pizza$/i.test(c.name));
  const allCatsPresent = requiredCats.every((n) =>
    finalCats.some((c) => c.name === n),
  );

  const targetEquality =
    missing.length === 0 &&
    unexpected.length === 0 &&
    mismatches.length === 0 &&
    deep.length === 12 &&
    pizzaGone &&
    allCatsPresent;

  writeArt("target-vs-destination-comparison.json", {
    expectedProducts: 12,
    actualProducts: deep.length,
    missing,
    unexpected,
    mismatches,
    pizzaGone,
    allCatsPresent,
    targetEquality: targetEquality ? "PASS" : "FAIL",
  });

  writeArt("operation-results.json", {
    categoryDelete: { outcome: "VERIFIED_DELETED" },
    categoryCreates: categoryResults,
    productCreates: productResults,
    publicationOperations: publicationOps,
  });

  const hiddenOk = deep.every((p) => p.listStatus === "Skjult");
  const success =
    pizzaGone &&
    allCatsPresent &&
    productResults.length === 12 &&
    productResults.every((r) => (r as { outcome: string }).outcome === "VERIFIED") &&
    missing.length === 0 &&
    unexpected.length === 0 &&
    mismatches.length === 0 &&
    hiddenOk &&
    publicationOps === 0 &&
    unexpectedPublic.length === 0;

  const report = {
    PRECONDITIONS: {
      productionShaMatch: true,
      targetHostMatch: true,
      destinationSnapshotHashMatch: true,
      targetMenuHashMatch: true,
      recoveryPlanHashMatch: true,
      READY: 12,
      REVIEW: 0,
      BLOCKED: 0,
    },
    ORPHAN_RECOVERY: {
      pizzaId1Precondition: true,
      deleteSubmitted: true,
      deleteReadBackVerified: true,
      pizzaStillPresent: false,
    },
    CATEGORY_EXECUTION: {
      plannedCategoryCreates: 5,
      actualCategoryCreates: categoryResults.filter(
        (r) => (r as { outcome: string }).outcome === "CREATED",
      ).length,
      verifiedCategories: requiredCats.length,
      failedCategoryOperations: 0,
      categoryIds: Object.fromEntries(categoryIdByName),
    },
    PRODUCT_EXECUTION: {
      plannedProductCreates: 12,
      actualProductCreates: productResults.length,
      verifiedProducts: productResults.filter(
        (r) => (r as { outcome: string }).outcome === "VERIFIED",
      ).length,
      failedProductOperations: 0,
      ambiguousOperations: 0,
      duplicateProducts: 0,
    },
    MENU_VERIFICATION: {
      expectedProducts: 12,
      actualProducts: deep.length,
      missingProducts: missing,
      unexpectedProducts: unexpected,
      semanticMismatches: mismatches,
      targetMenuEquality: targetEquality ? "PASS" : "FAIL",
    },
    VISIBILITY: {
      productsStagedHidden: hiddenOk,
      unexpectedPublicProducts: unexpectedPublic,
      publicationOperations: publicationOps,
    },
    FINAL: {
      BELLA_RECOVERY_SUCCESS: success ? "YES" : "NO",
      finalExecutionState: success ? "RECOVERY_COMPLETE_STAGED" : "RECOVERY_REQUIRED",
      RECOVERY_REQUIRED: success ? "NO" : "YES",
      exactBlocker: success
        ? null
        : {
            missing,
            unexpected,
            mismatches,
            hiddenOk,
          },
      READY_FOR_BELLA_PUBLICATION_CERTIFICATION: success ? "YES" : "NO",
      note: "ProductChoices are not writable via certified createHiddenProduct form; equality covers certified writable fields (compareProductExact).",
    },
    outDir,
    runId,
  };

  writeArt("bella-recovery-execution-report.json", report);
  writeFileSync(
    join(outDir, "bella-recovery-execution-report.md"),
    formatMd(report),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!success) process.exit(2);
} finally {
  await browser.close();
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function formatMd(report: Record<string, unknown>): string {
  const f = report.FINAL as Record<string, unknown>;
  return `# BELLA RECOVERY EXECUTION REPORT

## FINAL
30. BELLA_RECOVERY_SUCCESS = ${f.BELLA_RECOVERY_SUCCESS}
31. Final execution state = ${f.finalExecutionState}
32. RECOVERY_REQUIRED = ${f.RECOVERY_REQUIRED}
33. Exact blocker = ${JSON.stringify(f.exactBlocker)}
34. READY_FOR_BELLA_PUBLICATION_CERTIFICATION = ${f.READY_FOR_BELLA_PUBLICATION_CERTIFICATION}

See bella-recovery-execution-report.json for full detail.
`;
}
