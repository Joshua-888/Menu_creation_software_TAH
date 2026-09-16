/**
 * Bella continuation readiness — READ-ONLY.
 * Fresh destination snapshot + field-aware verify of existing #1 + new RecoveryPlan.
 * NO creates. NO publication. NO QA.
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
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { createTahPlaywrightDestinationPort } from "../src/runner/tahDestinationPort.js";
import {
  compareProductFieldAware,
  type DestinationProduct,
} from "../src/runner/executor.js";
import type { PlannedProductPayload } from "../src/runner/writePlan.js";
import {
  CATEGORY_CREATE_IS_PUBLIC_MUTATION,
  CATEGORY_VISIBILITY_CONTROL_EXISTS,
  auditCategoryExposureCapabilities,
  buildMinimizedCategoryExposureSteps,
} from "../src/runner/categoryExposure.js";
import { MENU_CONSTITUTION_VERSION } from "../src/intelligence/constitution.js";

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

const targetMenu = JSON.parse(
  readFileSync(join(prepDir, "bella-target-menu.json"), "utf8"),
);
const sourceJpeg = readFileSync(
  join(root, "fixtures/golden/bella-kebab/raw-source.jpeg"),
);
const sourceHash = createHash("sha256").update(sourceJpeg).digest("hex");
const targetMenuHash = sha(targetMenu);

const expectedCats = (targetMenu.categories as Array<{ name: string }>).map(
  (c) => c.name,
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const email = process.env.TAH_ADMIN_EMAIL?.trim();
const password = process.env.TAH_ADMIN_PASSWORD?.trim();
if (!email || !password) {
  throw new Error("missing_TAH_ADMIN_credentials");
}

await page.goto("https://bellakebab.dk/login", {
  waitUntil: "domcontentloaded",
});
await dismissKnownCookieBanner(page);
await page.locator('input[type="email"]').first().fill(email);
await page.locator('input[type="password"]').first().fill(password);
await page.getByRole("button", { name: /^login$/i }).click();
await page.waitForTimeout(1500);

const adapter = new TahAdminAdapterV1({
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

const categories = await adapter.listCategories();
const products = await adapter.listProducts();
const deep: DestinationProduct[] = [];
for (const row of products) {
  if (!row.databaseId) continue;
  const read = await port.readProduct(row.databaseId);
  deep.push(read);
}

await page.goto("https://bellakebab.dk/", { waitUntil: "domcontentloaded" });
const publicText = (await page.locator("body").innerText()).slice(0, 2500);
await browser.close();

const snapshot = {
  capturedAt: new Date().toISOString(),
  mutation: false,
  host: "bellakebab.dk",
  categories,
  products,
  deepProducts: deep,
  publicTextSample: publicText,
  publicMentionsSmash: /smash/i.test(publicText),
  emptyCategoryNamesPublic: categories
    .filter((c) => (c.itemCount ?? 0) === 0)
    .map((c) => c.name),
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

// Build expected payload for Smash #1 from TargetMenu
const smash = (
  targetMenu.categories as Array<{
    name: string;
    products: Array<Record<string, unknown>>;
  }>
)
  .flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name })))
  .find((p) => String(p.name) === "Smash burger");

if (!smash) throw new Error("Smash burger missing from TargetMenu");

const burgersCat = categories.find((c) => c.name === "Burgers");
const expectedPayload: PlannedProductPayload = {
  sourceId: String(smash.sourceId),
  menuNumber: "1",
  name: "Smash burger",
  description: String(smash.description ?? ""),
  basePriceOre: Number(
    (smash.variants as Array<{ sourceTotalPrice?: number }>)?.[0]
      ?.sourceTotalPrice ?? 7500,
  ),
  categoryIds: burgersCat?.databaseId ? [burgersCat.databaseId] : ["2"],
  variants: (
    (smash.variants as Array<{ name: string; surcharge: number }>) ?? []
  ).map((v) => ({ name: v.name, surchargeOre: v.surcharge ?? 0 })),
  ingredients: (
    (smash.ingredients as Array<{ display: string }>) ?? []
  ).map((i) => i.display),
  additions: ((smash.addOns as Array<{ name: string; price: number }>) ?? []).map(
    (a) => ({ name: a.name, priceOre: a.price }),
  ),
  intendedHidden: true,
};

const actual =
  deep.find((p) => p.databaseId === "1" || p.menuNumber === "1") ?? null;

let product1Class: string = "ABSENT";
let product1Report = null as ReturnType<typeof compareProductFieldAware> | null;
let materialDiff = false;

if (!actual) {
  product1Class = "ABSENT";
  materialDiff = true;
} else {
  product1Report = compareProductFieldAware(expectedPayload, actual);
  if (!product1Report.ok) {
    product1Class = "MATERIAL_MISMATCH";
    materialDiff = true;
  } else {
    product1Class = "VERIFIED_EXISTING_RECOVERY_ENTITY";
  }
}

const destCatNames = categories.map((c) => c.name.trim()).sort();
const expCatNames = [...expectedCats].map((c) => c.trim()).sort();
const categoriesMatch =
  destCatNames.length === expCatNames.length &&
  destCatNames.every((n, i) => n.toLocaleLowerCase("da-DK") === expCatNames[i]!.toLocaleLowerCase("da-DK"));

if (!categoriesMatch) materialDiff = true;

const remainingProducts = (
  targetMenu.categories as Array<{
    name: string;
    products: Array<{ sourceId: string; name: string }>;
  }>
)
  .flatMap((c) =>
    c.products.map((p) => ({
      sourceId: p.sourceId,
      name: p.name,
      categoryName: c.name,
    })),
  )
  .filter((p) => p.name !== "Smash burger");

const minimized = buildMinimizedCategoryExposureSteps({
  categories: expectedCats.map((name) => ({ name })),
  products: [
    {
      sourceId: String(smash.sourceId),
      categoryName: "Burgers",
      ready: true,
    },
    ...remainingProducts.map((p) => ({
      sourceId: p.sourceId,
      categoryName: p.categoryName,
      ready: true,
    })),
  ],
});

// Continuation: categories already exist → 0 creates; verify existing #1; create 11
const continuationPlan = {
  schemaVersion: "1",
  planKind: "BELLA_CONTINUATION_FROM_PARTIAL_STATE",
  executeAutomatically: false,
  publicationOperations: 0,
  generatedAt: new Date().toISOString(),
  constitutionVersion: MENU_CONSTITUTION_VERSION,
  merchantName: "Bella Kebab",
  destinationHost: "bellakebab.dk",
  frozenIntelligence: {
    ready: 12,
    review: 0,
    blocked: 0,
    targetMenuHash,
  },
  categoryExposure: {
    CATEGORY_CREATE_IS_PUBLIC_MUTATION,
    CATEGORY_VISIBILITY_CONTROL_EXISTS,
    audit: auditCategoryExposureCapabilities(),
    note: "Categories already present from prior recovery — no new category creates in this continuation. Future menus use minimized exposure steps.",
    minimizedExposureStepsForGreenfield: minimized.steps.length,
  },
  operations: {
    plannedCategoryDeletes: 0,
    plannedCategoryCreates: 0,
    plannedProductCreates: remainingProducts.length,
    plannedProductUpdates: 0,
    plannedProductDeletes: 0,
    plannedProductVerifyExisting: product1Class === "VERIFIED_EXISTING_RECOVERY_ENTITY" ? 1 : 0,
    plannedPublicationOperations: 0,
  },
  existingEntities: {
    PRODUCT_1: product1Class,
    product1DbId: actual?.databaseId ?? null,
    product1Visibility: actual?.listStatus ?? null,
    categories: categories.map((c) => ({
      databaseId: c.databaseId,
      name: c.name,
      itemCount: c.itemCount,
    })),
    categoriesMatchTargetMenu: categoriesMatch,
    requiringModification: materialDiff
      ? ["STOP: material destination divergence from approved TargetMenu"]
      : [],
  },
  productCreates: remainingProducts.map((p, idx) => ({
    sequence: idx + 1,
    sourceId: p.sourceId,
    name: p.name,
    categoryName: p.categoryName,
    intendedHidden: true,
  })),
  hashes: {
    sourceHash,
    targetMenuHash,
    destinationSnapshotHash,
    productionShaPlaceholder: "SET_AFTER_VERIFIER_DEPLOY",
  },
  STOP: true,
  NO_EXECUTION_THIS_MILESTONE: true,
};

const recoveryPlanHash = sha(continuationPlan);
(continuationPlan.hashes as Record<string, string>).recoveryPlanHash =
  recoveryPlanHash;

write("BELLA_CONTINUATION_RECOVERY_PLAN.json", continuationPlan);
write("BELLA_PRODUCT_1_FIELD_VERIFY.json", {
  classification: product1Class,
  expectedPayload,
  actual,
  fieldReport: product1Report,
});

write("BELLA_CONTINUATION_READINESS.json", {
  BELLA_DESTINATION_UNCHANGED_DURING_THIS_MILESTONE: true,
  READY_FOR_BELLA_CONTINUATION_EXECUTION: false,
  reason: "Verifier fix must be certified and deployed first; this script is plan-only",
  product1Class,
  materialDiff,
  categoriesMatch,
  destinationSnapshotHash,
  recoveryPlanHash,
  sourceHash,
  targetMenuHash,
  ops: continuationPlan.operations,
});

console.log(
  JSON.stringify(
    {
      outDir,
      product1Class,
      materialDiff,
      categoriesMatch,
      destinationSnapshotHash,
      recoveryPlanHash,
      ops: continuationPlan.operations,
    },
    null,
    2,
  ),
);
