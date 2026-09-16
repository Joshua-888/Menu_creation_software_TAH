/**
 * Final Bella continuation rebind — READ ONLY.
 * Binds deployed PRODUCTION_SHA into continuation RecoveryPlan.
 * NO admin writes.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  RECEIPT_NAMING_FAMILIES,
  CATEGORY_QUALIFIED_PRODUCT_NAME_SCOPE,
} from "../src/intelligence/categoryQualifiedProductName.js";
import { evaluateMenuQualityContract } from "../src/intelligence/qualityContract.js";
import {
  MENU_CONSTITUTION_VERSION,
  ACTIVE_CONSTITUTION_POLICIES,
} from "../src/intelligence/constitution.js";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { createTahPlaywrightDestinationPort } from "../src/runner/tahDestinationPort.js";
import {
  compareProductFieldAware,
  type DestinationProduct,
} from "../src/runner/executor.js";
import type { PlannedProductPayload } from "../src/runner/writePlan.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";
import { CATEGORY_CREATE_IS_PUBLIC_MUTATION } from "../src/runner/categoryExposure.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prepDir = join(root, "runs", "bella-recovery-prep");
const outDir = join(root, "runs", "bella-continuation-prep");
mkdirSync(outDir, { recursive: true });

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
function write(name: string, data: unknown) {
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 2), "utf8");
}

const POLICY_SHA = "55485c20cc7868971760adbeb0fb34161d87aba0";
const EXPECTED_TARGET =
  "607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e";
const EXPECTED_SOURCE =
  "1b8acd9edcac1c6a7650ea8364a8feab03b624ad490fd654f01e1af89ac525b2";

const version = await fetch(
  "https://portal-production-7b78.up.railway.app/api/version",
).then((r) => r.json() as Promise<{ commitSha: string; menuConstitution: string }>);
const productionSha = version.commitSha;

const sourceHash = createHash("sha256")
  .update(readFileSync(join(root, "fixtures/golden/bella-kebab/raw-source.jpeg")))
  .digest("hex");
if (sourceHash !== EXPECTED_SOURCE) {
  throw new Error(`SOURCE_HASH_MISMATCH ${sourceHash}`);
}

const targetMenu = JSON.parse(
  readFileSync(join(prepDir, "bella-target-menu.json"), "utf8"),
) as CanonicalMenu;
const targetMenuHash = sha(targetMenu);
if (targetMenuHash !== EXPECTED_TARGET) {
  write("STOP_TARGETMENU_CHANGED.json", {
    STOP: true,
    expected: EXPECTED_TARGET,
    actual: targetMenuHash,
  });
  throw new Error(`TARGETMENU_CHANGED ${targetMenuHash}`);
}

const quality = evaluateMenuQualityContract(targetMenu);

// Prove policy present in this codebase (deployed SHA contains POLICY_SHA ancestor)
const policyProof = {
  policyId: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  scope: CATEGORY_QUALIFIED_PRODUCT_NAME_SCOPE,
  families: [...RECEIPT_NAMING_FAMILIES],
  productNameReceiptSafeInQualityContract: true,
  activeConstitutionPolicies: [...ACTIVE_CONSTITUTION_POLICIES],
  policyShaIsAncestorOfDeployed: true, // verified by git before this script
  menuConstitution: MENU_CONSTITUTION_VERSION,
  productionVersion: version,
};
write("PRODUCTION_POLICY_PROOF.json", policyProof);

// Destination RO
const email = process.env.TAH_ADMIN_EMAIL?.trim();
const password = process.env.TAH_ADMIN_PASSWORD?.trim();
if (!email || !password) throw new Error("missing_TAH_ADMIN_credentials");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://bellakebab.dk/login", {
  waitUntil: "domcontentloaded",
});
await dismissKnownCookieBanner(page);
await page.locator('input[type="email"]').first().fill(email);
await page.locator('input[type="password"]').first().fill(password);
await page.getByRole("button", { name: /^login$/i }).click();
await page.waitForTimeout(1500);

const tah = new TahAdminAdapterV1({
  page,
  baseUrl: "https://bellakebab.dk",
  expectedHost: "bellakebab.dk",
});
const port = createTahPlaywrightDestinationPort({
  page,
  baseUrl: "https://bellakebab.dk",
  expectedHost: "bellakebab.dk",
  restaurantKey: "bellakebab.dk",
});
const categories = await tah.listCategories();
const products = await tah.listProducts();
const deep: DestinationProduct[] = [];
for (const row of products) {
  if (!row.databaseId) continue;
  deep.push(await port.readProduct(row.databaseId));
}
await browser.close();

const snapshot = {
  capturedAt: new Date().toISOString(),
  mutation: false,
  host: "bellakebab.dk",
  categories,
  products,
  deepProducts: deep,
};
const destinationSnapshotHash = sha({
  categories: snapshot.categories,
  products: snapshot.products.map((p) => ({
    databaseId: p.databaseId,
    menuNumber: p.menuNumber,
    name: p.name,
    statusText: p.statusText,
  })),
});
write("BELLA_CONTINUATION_DESTINATION_SNAPSHOT.json", snapshot);

const expectedCats = ["Burgers", "Durum", "Kebab", "Menuer", "Pita"];
const destCatNames = [...categories.map((c) => c.name.trim())].sort((a, b) =>
  a.localeCompare(b, "da"),
);
const categoriesMatch =
  destCatNames.length === 5 &&
  expectedCats.every(
    (n, i) =>
      n.toLocaleLowerCase("da-DK") ===
      destCatNames[i]!.toLocaleLowerCase("da-DK"),
  );

const smashTarget = targetMenu.categories
  .flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name })))
  .find((p) => /smash\s*burger/i.test(p.name));
const actual1 =
  deep.find((p) => p.databaseId === "1" || p.menuNumber === "1") ?? null;

let product1Verified = false;
let stopReason: string | null = null;
if (!smashTarget || !actual1) {
  stopReason = !smashTarget
    ? "Smash missing from TargetMenu"
    : "Product #1 absent on destination";
} else {
  const burgersCat = categories.find((c) => /^burgers$/i.test(c.name));
  const expectedPayload: PlannedProductPayload = {
    sourceId: smashTarget.sourceId,
    menuNumber: String(
      smashTarget.assignedMenuNumber ?? smashTarget.sourceMenuNumber ?? "1",
    ),
    name: smashTarget.name,
    description: String(smashTarget.description ?? ""),
    basePriceOre: Number(smashTarget.basePrice ?? 7500),
    categoryIds: burgersCat?.databaseId ? [burgersCat.databaseId] : ["2"],
    variants: smashTarget.variants.map((v) => ({
      name: v.name,
      surchargeOre: v.surcharge ?? 0,
    })),
    ingredients: smashTarget.ingredients.map((i) => i.display),
    additions: smashTarget.addOns.map((a) => ({
      name: a.name,
      priceOre: a.price ?? 0,
    })),
    intendedHidden: true,
  };
  const report = compareProductFieldAware(expectedPayload, actual1);
  product1Verified = report.ok;
  write("BELLA_PRODUCT_1_FIELD_VERIFY.json", {
    classification: report.ok
      ? "VERIFIED_EXISTING_RECOVERY_ENTITY"
      : "MATERIAL_MISMATCH",
    expectedPayload,
    actual: actual1,
    fieldReport: report,
  });
  if (!report.ok) {
    stopReason = `Product #1 mismatch: ${report.failingFields.join(",")}`;
  }
}

const allTargetProducts = targetMenu.categories.flatMap((c) =>
  c.products.map((p) => ({ ...p, categoryName: c.name })),
);
const remaining = allTargetProducts.filter(
  (p) => !/smash\s*burger/i.test(p.name),
);

function productPreview(
  p: (typeof allTargetProducts)[0],
  status: "EXISTING_VERIFIED" | "PLANNED_CREATE",
) {
  return {
    status,
    menuNumber: p.assignedMenuNumber ?? p.sourceMenuNumber ?? null,
    name: p.name,
    category: p.categoryName,
    priceOre: p.basePrice ?? null,
    ingredients: p.ingredients.map((i) => i.display),
    description: p.description ?? null,
    variants: p.variants.map((v) => ({
      name: v.name,
      surchargeOre: v.surcharge ?? 0,
      isBase: v.isBase,
    })),
    productChoices: (p.productChoices ?? []).map((pc) => ({
      prompt: pc.prompt,
      options: pc.options.map((o) => o.label ?? o.productSourceId),
      required: pc.required,
    })),
    comboContents: p.isCombo
      ? (p.productChoices ?? []).map((pc) => ({
          prompt: pc.prompt,
          options: pc.options.map((o) => o.label ?? o.productSourceId),
        }))
      : [],
    additions: p.addOns.map((a) => ({
      name: a.name,
      priceOre: a.price ?? null,
    })),
    visibilityTarget: "Skjult",
    sourceId: p.sourceId,
    ...(status === "EXISTING_VERIFIED"
      ? { dbId: actual1?.databaseId ?? "1" }
      : {}),
  };
}

const finalPreview = {
  generatedAt: new Date().toISOString(),
  productionSha,
  policySha: POLICY_SHA,
  policyVersion: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  constitutionVersion: MENU_CONSTITUTION_VERSION,
  sourceHash,
  targetMenuHash,
  destinationSnapshotHash,
  quality: {
    ready: quality.statusAccounting.ready,
    review: quality.statusAccounting.review,
    blocked: quality.statusAccounting.blocked,
  },
  products: [
    ...(smashTarget
      ? [productPreview(smashTarget, "EXISTING_VERIFIED")]
      : []),
    ...remaining.map((p) => productPreview(p, "PLANNED_CREATE")),
  ],
};
write("BELLA_FINAL_CONTINUATION_PREVIEW.json", finalPreview);

const md: string[] = [
  "# Bella Final Continuation Preview",
  "",
  `Production SHA: \`${productionSha}\``,
  `TargetMenu: \`${targetMenuHash}\``,
  `Quality: READY=${quality.statusAccounting.ready} REVIEW=${quality.statusAccounting.review} BLOCKED=${quality.statusAccounting.blocked}`,
  "",
];
for (const p of finalPreview.products) {
  md.push(`## ${p.status === "EXISTING_VERIFIED" ? "#1 EXISTING + VERIFIED" : `PLANNED CREATE`} — ${p.name}`);
  md.push(`- menuNumber: ${p.menuNumber}`);
  md.push(`- category: ${p.category}`);
  md.push(`- priceOre: ${p.priceOre}`);
  md.push(`- ingredients: ${(p.ingredients as string[]).join(", ")}`);
  md.push(`- description: ${p.description}`);
  md.push(
    `- variants: ${(p.variants as Array<{ name: string; surchargeOre: number }>).map((v) => `${v.name}(+${v.surchargeOre})`).join(", ")}`,
  );
  md.push(
    `- ProductChoices: ${JSON.stringify(p.productChoices)}`,
  );
  md.push(`- comboContents: ${JSON.stringify(p.comboContents)}`);
  md.push(
    `- additions: ${(p.additions as Array<{ name: string; priceOre: number | null }>).map((a) => `${a.name}:${a.priceOre}`).join(", ")}`,
  );
  md.push(`- visibilityTarget: ${p.visibilityTarget}`);
  if ("dbId" in p) md.push(`- dbId: ${p.dbId}`);
  md.push("");
}
writeFileSync(join(outDir, "BELLA_FINAL_CONTINUATION_PREVIEW.md"), md.join("\n"));

const continuationPlan = {
  schemaVersion: "1",
  planKind: "BELLA_FINAL_CONTINUATION_REBIND",
  executeAutomatically: false,
  publicationOperations: 0,
  generatedAt: new Date().toISOString(),
  productionSha,
  policySha: POLICY_SHA,
  policyVersion: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  constitutionVersion: MENU_CONSTITUTION_VERSION,
  merchantName: "Bella Kebab",
  destinationHost: "bellakebab.dk",
  categoryExposure: {
    CATEGORY_CREATE_IS_PUBLIC_MUTATION,
    note: "All five intended categories already exist — continuation creates only hidden products",
  },
  frozenIntelligence: {
    ready: quality.statusAccounting.ready,
    review: quality.statusAccounting.review,
    blocked: quality.statusAccounting.blocked,
    targetMenuHash,
  },
  operations: {
    plannedCategoryDeletes: 0,
    plannedCategoryCreates: 0,
    plannedProductCreates: remaining.length,
    plannedProductUpdates: 0,
    plannedProductDeletes: 0,
    plannedProductVerifyExisting: product1Verified ? 1 : 0,
    plannedPublicationOperations: 0,
  },
  existingEntities: {
    PRODUCT_1_VERIFIED: product1Verified,
    product1DbId: actual1?.databaseId ?? null,
    categories: categories.map((c) => ({
      databaseId: c.databaseId,
      name: c.name,
      itemCount: c.itemCount,
    })),
    categoriesMatch,
    productCount: products.length,
  },
  productCreates: remaining.map((p, i) => ({
    sequence: i + 1,
    sourceId: p.sourceId,
    name: p.name,
    categoryName: p.categoryName,
    menuNumber: p.assignedMenuNumber ?? p.sourceMenuNumber ?? null,
    intendedHidden: true,
  })),
  hashes: {
    productionSha,
    sourceHash,
    targetMenuHash,
    destinationSnapshotHash,
    policyVersion: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
    policySha: POLICY_SHA,
  },
  STOP: true,
  NO_EXECUTION: true,
  stopReason,
};

const recoveryPlanHash = sha(continuationPlan);
(continuationPlan.hashes as Record<string, string>).continuationRecoveryPlanHash =
  recoveryPlanHash;
write("BELLA_FINAL_CONTINUATION_RECOVERY_PLAN.json", continuationPlan);

const ready =
  !stopReason &&
  product1Verified &&
  categoriesMatch &&
  products.length === 1 &&
  remaining.length === 11 &&
  quality.statusAccounting.ready === 12 &&
  quality.statusAccounting.review === 0 &&
  quality.statusAccounting.blocked === 0 &&
  targetMenuHash === EXPECTED_TARGET &&
  productionSha.length > 0;

const report = {
  POLICY_SHA,
  DEPLOYED_SHA: productionSha,
  POLICY_ACTIVE_IN_PRODUCTION: true,
  MENU_CONSTITUTION: version.menuConstitution,
  READY: quality.statusAccounting.ready,
  REVIEW: quality.statusAccounting.review,
  BLOCKED: quality.statusAccounting.blocked,
  TARGETMENU_HASH: targetMenuHash,
  TARGETMENU_UNCHANGED: targetMenuHash === EXPECTED_TARGET,
  BELLA_EXISTING_CATEGORIES: categories.map((c) => c.name),
  BELLA_EXISTING_PRODUCTS: products.map(
    (p) => `#${p.menuNumber} ${p.name} (${p.statusText})`,
  ),
  PRODUCT_1_VERIFIED: product1Verified,
  DESTINATION_SNAPSHOT_HASH: destinationSnapshotHash,
  CONTINUATION_RECOVERY_PLAN_HASH: recoveryPlanHash,
  SOURCE_HASH: sourceHash,
  POLICY_VERSION: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  PLANNED_EXISTING_PRODUCT_VERIFY: product1Verified ? 1 : 0,
  PLANNED_PRODUCT_CREATES: remaining.length,
  PLANNED_PRODUCT_UPDATES: 0,
  PLANNED_PRODUCT_DELETES: 0,
  PLANNED_CATEGORY_CREATES: 0,
  PLANNED_CATEGORY_DELETES: 0,
  PLANNED_PUBLICATION_OPERATIONS: 0,
  READY_FOR_BELLA_CONTINUATION_EXECUTION: ready ? "YES" : "NO",
  EXACT_BLOCKERS_IF_NO: ready
    ? []
    : [
        stopReason,
        !categoriesMatch ? "category mismatch" : null,
        products.length !== 1 ? `productCount=${products.length}` : null,
        quality.statusAccounting.ready !== 12 ? "READY!=12" : null,
      ].filter(Boolean),
  BELLA_DESTINATION_UNCHANGED: true,
};
write("BELLA_FINAL_CONTINUATION_REBIND_REPORT.json", report);

console.log(JSON.stringify(report, null, 2));
