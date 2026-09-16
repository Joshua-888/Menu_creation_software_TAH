/**
 * BELLA FINAL STATE RECONCILIATION — READ-ONLY.
 * No creates / updates / deletes / publication / QA.
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
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { createTahPlaywrightDestinationPort } from "../src/runner/tahDestinationPort.js";
import {
  compareProductExact,
  compareProductFieldAware,
} from "../src/runner/executor.js";
import type { PlannedProductPayload } from "../src/runner/writePlan.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prepDir = join(root, "runs", "bella-recovery-prep");
const contPrep = join(root, "runs", "bella-continuation-prep");
const runId = `bella-final-recon_${randomUUID()}`;
const outDir = join(root, "runs", "bella-final-recon", runId);
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
    mutation: false,
  };
}

function writeArt(name: string, body: unknown) {
  writeFileSync(
    join(outDir, name),
    JSON.stringify({ ...meta(), ...(body as object) }, null, 2),
  );
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

// ---------- Mark stale plans superseded (artifact annotation only) ----------
const superseded = {
  status: "SUPERSEDED_BY_DESTINATION_STATE",
  reason:
    "Destination already contains all 12 intended hidden products; do not execute against current Bella state",
  supersededAt: new Date().toISOString(),
  supersededDestinationHashes: [
    "e557443abad7eed417b7be87e66d83298609037d73090f7330c019ec6fa4f27b",
  ],
  supersededRecoveryPlanHashes: [
    "7c955a700d0b93f12fd7c7e0fb51ee33f33cf7f71f233333c2f329607969a589",
    "a743b98314ea8b5c148f9c1cb9cc15bedd1ddd1049e82241ec14eba9d741298b",
  ],
  note: "Historical run results are not rewritten. CURRENT DESTINATION is certified separately.",
};
writeArt("superseded-continuation-plans.json", superseded);
for (const rel of [
  "BELLA_FINAL_CONTINUATION_RECOVERY_PLAN.json",
  "BELLA_CONTINUATION_RECOVERY_PLAN.json",
  "BELLA_CONTINUATION_DESTINATION_SNAPSHOT.json",
]) {
  const p = join(contPrep, rel);
  if (!existsSync(p)) continue;
  const marker = join(contPrep, `${rel}.SUPERSEDED_BY_DESTINATION_STATE.json`);
  writeFileSync(marker, JSON.stringify(superseded, null, 2));
}

// ---------- Version + artifact locks ----------
const version = (await (
  await fetch("https://portal-production-7b78.up.railway.app/api/version")
).json()) as { commitSha: string; menuConstitution: string };
if (version.commitSha !== AUTH.productionSha) {
  throw new Error(`PRODUCTION_SHA_MISMATCH ${version.commitSha}`);
}
if (version.menuConstitution !== "MenuConstitutionV1") {
  throw new Error(`CONSTITUTION_MISMATCH ${version.menuConstitution}`);
}

const targetMenu = JSON.parse(
  readFileSync(join(prepDir, "bella-target-menu.json"), "utf8"),
) as CanonicalMenu;
const targetHash = sha(targetMenu);
if (targetHash !== AUTH.targetMenuHash) {
  throw new Error(`TARGETMENU_HASH_MISMATCH ${targetHash}`);
}
const sourceHash = createHash("sha256")
  .update(
    readFileSync(join(root, "fixtures/golden/bella-kebab/raw-source.jpeg")),
  )
  .digest("hex");
if (sourceHash !== AUTH.sourceHash) {
  throw new Error(`SOURCE_HASH_MISMATCH ${sourceHash}`);
}

const email = process.env.TAH_ADMIN_EMAIL?.trim();
const password = process.env.TAH_ADMIN_PASSWORD?.trim();
if (!email || !password) throw new Error("missing_TAH_ADMIN_credentials");

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
  if (!page.url().includes(AUTH.host)) {
    throw new Error(`TARGET_HOST_MISMATCH ${page.url()}`);
  }

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

  const categories = await adapter.listCategories();
  const products = await adapter.listProducts();
  const deep = [];
  for (const p of products) {
    if (!p.databaseId) continue;
    const full = await port.readProduct(p.databaseId);
    deep.push({
      ...full,
      listStatus: p.statusText ?? full.listStatus,
      editPath: p.editPath,
      showPath: p.showPath,
      categoryText: p.categoryText,
      priceText: p.priceText,
    });
  }

  writeArt("fresh-destination-snapshot.json", {
    snapshot: {
      capturedAt: new Date().toISOString(),
      categories,
      products,
      deepProducts: deep,
    },
  });

  const expectedCats = ["Burgers", "Durum", "Kebab", "Menuer", "Pita"];
  const destCatNames = [...categories.map((c) => c.name.trim())].sort((a, b) =>
    a.localeCompare(b, "da"),
  );
  const pizzaPresent = categories.some((c) => /pizza/i.test(c.name));
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

  const fieldResults: unknown[] = [];
  const representationEquivalentFields: string[] = [];
  const trueSemanticMismatches: unknown[] = [];
  const exactFieldMatches: string[] = [];
  const matched: string[] = [];
  const missing: string[] = [];
  const unexpected: string[] = [];
  const duplicates: string[] = [];
  const receiptChecks: unknown[] = [];

  const destByMenu = new Map<string, typeof deep>();
  for (const d of deep) {
    const mn = (d.menuNumber || "").trim();
    const arr = destByMenu.get(mn) ?? [];
    arr.push(d);
    destByMenu.set(mn, arr);
  }
  for (const [mn, arr] of destByMenu) {
    if (arr.length > 1) duplicates.push(mn);
  }

  for (const tp of targetProducts) {
    const candidates = destByMenu.get(tp.menuNumber) ?? [];
    if (candidates.length === 0) {
      missing.push(tp.menuNumber);
      continue;
    }
    if (candidates.length > 1) {
      duplicates.push(tp.menuNumber);
      continue;
    }
    const dest = candidates[0]!;
    const catId = categoryIdByName.get(tp.categoryName);
    if (!catId) {
      trueSemanticMismatches.push({
        menuNumber: tp.menuNumber,
        reason: "CATEGORY_ID_MISSING",
        categoryName: tp.categoryName,
      });
      continue;
    }
    const payload = toPayload(tp.product, catId);
    const fieldReport = compareProductFieldAware(payload, dest);
    const exactDiffs = compareProductExact(payload, dest);
    fieldResults.push({
      menuNumber: tp.menuNumber,
      name: payload.name,
      databaseId: dest.databaseId,
      categoryName: tp.categoryName,
      visibility: dest.listStatus,
      ok: fieldReport.ok,
      fields: fieldReport.fields,
      exactDiffs,
    });
    for (const f of fieldReport.fields) {
      if (f.result === "REPRESENTATION_EQUIVALENT") {
        representationEquivalentFields.push(`${tp.menuNumber}.${f.field}`);
      } else if (f.result === "EXACT_VALUE") {
        exactFieldMatches.push(`${tp.menuNumber}.${f.field}`);
      } else if (f.result === "SEMANTIC_MISMATCH") {
        trueSemanticMismatches.push({
          menuNumber: tp.menuNumber,
          field: f,
        });
      }
    }
    if (!fieldReport.ok || exactDiffs.length > 0) {
      if (
        !trueSemanticMismatches.some(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            "menuNumber" in m &&
            (m as { menuNumber: string }).menuNumber === tp.menuNumber &&
            "failingFields" in m,
        )
      ) {
        trueSemanticMismatches.push({
          menuNumber: tp.menuNumber,
          failingFields: fieldReport.failingFields,
          exactDiffs,
        });
      }
    } else {
      matched.push(tp.menuNumber);
    }

    const receiptOk = isProductNameReceiptSafe({
      productName: dest.name,
      categoryName: tp.categoryName,
    });
    const nameEquals = dest.name === payload.name;
    receiptChecks.push({
      menuNumber: tp.menuNumber,
      name: dest.name,
      categoryName: tp.categoryName,
      receiptSafe: receiptOk,
      nameEqualsTarget: nameEquals,
      pass: receiptOk && nameEquals,
    });
  }

  const targetMenuNumbers = new Set(targetProducts.map((t) => t.menuNumber));
  for (const d of deep) {
    const mn = (d.menuNumber || "").trim();
    if (!targetMenuNumbers.has(mn)) {
      unexpected.push(`${mn}:${d.name}`);
    }
  }

  writeArt("field-aware-verification.json", {
    fieldResults,
    representationEquivalentFields,
    trueSemanticMismatches,
    exactFieldMatchCount: exactFieldMatches.length,
  });
  writeArt("receipt-safe-verification.json", {
    checks: receiptChecks,
    failCount: receiptChecks.filter(
      (c) => !(c as { pass: boolean }).pass,
    ).length,
  });

  // ---------- Storefront check (RO) ----------
  await page.goto(`https://${AUTH.host}/`, {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  await page.waitForTimeout(1000);
  const publicText = await page.locator("body").innerText();
  const productNames = deep.map((d) => d.name.trim()).filter(Boolean);
  const categoryNameSet = new Set(
    categories.map((c) => c.name.trim().toLowerCase()),
  );
  const publicProductHits: string[] = [];
  for (const name of productNames) {
    // Category nav labels may equal product names (e.g. "Durum"); exclude those.
    if (categoryNameSet.has(name.toLowerCase())) continue;
    if (publicText.toLowerCase().includes(name.toLowerCase())) {
      publicProductHits.push(name);
    }
  }
  const categoryNavVisible = expectedCats.filter((c) =>
    publicText.toLowerCase().includes(c.toLowerCase()),
  );
  writeArt("storefront-visibility.json", {
    publicProductHits,
    publicProductCardEstimate: publicProductHits.length,
    categoryNavVisible,
    note: "Category nav may remain public (TAH cannot hide categories). Product cards must be 0.",
    publicTextSample: publicText.slice(0, 2500),
  });

  const hiddenCount = deep.filter((p) => p.listStatus === "Skjult").length;
  const publicAdminCount = deep.filter((p) => p.listStatus !== "Skjult").length;
  const receiptFail = receiptChecks.filter(
    (c) => !(c as { pass: boolean }).pass,
  ).length;
  const uniqueDuplicates = [...new Set(duplicates)];

  const targetMenuEquality =
    targetProducts.length === 12 &&
    deep.length === 12 &&
    matched.length === 12 &&
    missing.length === 0 &&
    unexpected.length === 0 &&
    uniqueDuplicates.length === 0 &&
    trueSemanticMismatches.length === 0 &&
    receiptFail === 0 &&
    hiddenCount === 12 &&
    publicAdminCount === 0 &&
    publicProductHits.length === 0 &&
    !pizzaPresent &&
    destCatNames.length === 5 &&
    expectedCats.every(
      (n, i) =>
        n.toLocaleLowerCase("da-DK") ===
        destCatNames[i]!.toLocaleLowerCase("da-DK"),
    );

  // ---------- Historical successful 11-create run ----------
  const histRunId = "bella-continuation_e015ea44-1a74-43b9-abb8-77508c92dcaa";
  const histPath = join(
    root,
    "runs",
    "bella-continuation-exec",
    histRunId,
    "bella-continuation-execution-report.json",
  );
  const hist = existsSync(histPath)
    ? JSON.parse(readFileSync(histPath, "utf8"))
    : null;
  writeArt("historical-11-create-run.json", {
    runId: histRunId,
    found: !!hist,
    report: hist,
  });

  // ---------- BELLA-012 regression presence ----------
  const registry = readFileSync(
    join(root, "docs/INCIDENT_REGRESSION_REGISTRY.md"),
    "utf8",
  );
  const testSrc = readFileSync(
    join(root, "tests/unit/multi-merchant-go-live.test.ts"),
    "utf8",
  );
  const bella012Active =
    registry.includes("BELLA-012") &&
    registry.includes("HOST_ALLOWLIST_UNDEFINED_BEFORE_WRITE") &&
    testSrc.includes("BELLA-012") &&
    existsSync(join(root, "src/tah/write/hostAllowlist.ts"));

  const verifiedComplete =
    targetMenuEquality &&
    matched.length === 12 &&
    trueSemanticMismatches.length === 0;

  const report = {
    BELLA_RECOVERY_MENU_STATE: verifiedComplete
      ? "VERIFIED_COMPLETE_HIDDEN"
      : "MISMATCH_OR_INCOMPLETE",
    RECOVERY_REQUIRED: verifiedComplete ? false : true,
    READY_FOR_BELLA_PUBLICATION_CERTIFICATION: verifiedComplete,
    customerMutations: 0,
    CURRENT_STATE: {
      productionSha: AUTH.productionSha,
      categories: categories.map((c) => ({
        databaseId: c.databaseId,
        name: c.name,
        itemCount: c.itemCount,
      })),
      destinationProductCount: deep.length,
      hiddenProductCount: hiddenCount,
      publicProductCount: publicAdminCount,
      storefrontProductHits: publicProductHits.length,
      duplicateCount: uniqueDuplicates.length,
      pizzaPresent,
    },
    TARGET_RECONCILIATION: {
      targetMenuProductCount: targetProducts.length,
      matchedProducts: matched.length,
      missingProducts: missing,
      unexpectedProducts: unexpected,
      exactFieldMatchCount: exactFieldMatches.length,
      representationEquivalentFields,
      trueSemanticMismatches,
      receiptSafeNaming: receiptFail === 0 ? "PASS" : "FAIL",
      targetMenuEquality: targetMenuEquality ? "PASS" : "FAIL",
    },
    HISTORICAL_EXECUTION: {
      runId: histRunId,
      productionSha: hist?.productionSha ?? null,
      plannedCreates: hist?.EXECUTION?.plannedCreates ?? null,
      actualCreates: hist?.EXECUTION?.actualCreates ?? null,
      verifiedCreates: hist?.EXECUTION?.verifiedCreates ?? null,
      failedOperations: hist?.EXECUTION?.failedOperations ?? null,
      ambiguousOperations: hist?.EXECUTION?.ambiguousOperations ?? null,
      finalState: hist?.BELLA_CONTINUATION_SUCCESS
        ? "SUCCESS"
        : hist
          ? "NOT_SUCCESS"
          : "NOT_FOUND",
    },
    SAFETY: {
      oldContinuationPlansMarkedSuperseded: true,
      bella012RegressionActive: bella012Active,
      customerMutations: 0,
    },
    outDir,
  };

  writeArt("targetmenu-comparison.json", {
    targetMenuEquality: report.TARGET_RECONCILIATION.targetMenuEquality,
    matched,
    missing,
    unexpected,
    duplicates: uniqueDuplicates,
    representationEquivalentFields,
    trueSemanticMismatches,
  });

  if (!verifiedComplete && trueSemanticMismatches.length > 0) {
    writeArt("BellaRepairPlan.json", {
      executeAutomatically: false,
      mismatchedEntities: trueSemanticMismatches,
      note: "Propose-only. Do not auto-execute.",
    });
  }

  writeArt("bella-final-destination-reconciliation-report.json", report);
  writeFileSync(
    join(outDir, "bella-final-destination-reconciliation-report.md"),
    `# BELLA FINAL DESTINATION RECONCILIATION REPORT\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
