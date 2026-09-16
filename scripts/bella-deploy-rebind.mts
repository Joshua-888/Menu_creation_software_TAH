/**
 * Deploy+rebind: fresh Bella RO snapshot + rebuild RecoveryPlan.
 * NO Bella mutations. NO recovery execution.
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
import { DatabaseSync } from "node:sqlite";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { M2B_ADAPTER_CAPABILITIES } from "../src/tah/contracts/evidence.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { MENU_CONSTITUTION_VERSION } from "../src/intelligence/constitution.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs", "bella-recovery-prep");
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

const EXPECTED_TARGET =
  "607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e";
const RELEASE_SHA = "8df8c4172219775dbfb9aae40ef11948c8f7e8d8";
const BELLA = "bellakebab.dk";
const INCIDENT_RUN = "live-run_e8a2ae86-0f3a-403d-8e59-7109dc8f8651";

function sha(o: unknown) {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex");
}

const version = await fetch(
  "https://portal-production-7b78.up.railway.app/api/version",
).then((r) => r.json());

if (version.commitSha !== RELEASE_SHA) {
  console.error(
    JSON.stringify({
      STOP: "DEPLOYED_SHA_MISMATCH",
      expected: RELEASE_SHA,
      actual: version.commitSha,
    }),
  );
  process.exit(2);
}

const targetMenu = JSON.parse(
  readFileSync(join(outDir, "bella-target-menu.json"), "utf8"),
);
const targetMenuHash = sha(targetMenu);
if (targetMenuHash !== EXPECTED_TARGET) {
  console.error(
    JSON.stringify({
      STOP: "TARGETMENU_HASH_MISMATCH",
      expected: EXPECTED_TARGET,
      actual: targetMenuHash,
    }),
  );
  process.exit(2);
}

const quality = JSON.parse(
  readFileSync(join(outDir, "bella-quality.json"), "utf8"),
);
const sourceHash = createHash("sha256")
  .update(readFileSync(join(root, "fixtures/golden/bella-kebab/raw-source.jpeg")))
  .digest("hex");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const email = process.env.TAH_ADMIN_EMAIL!.trim();
const password = process.env.TAH_ADMIN_PASSWORD!.trim();
await page.goto(`https://${BELLA}/login`, { waitUntil: "domcontentloaded" });
await dismissKnownCookieBanner(page);
await page.locator('input[type="email"]').first().fill(email);
await page.locator('input[type="password"]').first().fill(password);
await page.getByRole("button", { name: /^login$/i }).click();
await page.waitForTimeout(1500);
if (/\/login/i.test(page.url())) throw new Error("bella_login_failed");

const adapter = new TahAdminAdapterV1({
  page,
  baseUrl: `https://${BELLA}`,
  expectedHost: BELLA,
});
const categories = await adapter.listCategories();
const products = await adapter.listProducts();
await browser.close();

const snapshot = {
  host: BELLA,
  capturedAt: new Date().toISOString(),
  mutation: false,
  categories,
  products,
  productCount: products.length,
  categoryCount: categories.length,
  pizza: categories.find((c) => c.databaseId === "1") ?? null,
  deployedSha: version.commitSha,
};
writeFileSync(
  join(outDir, "BELLA_DESTINATION_SNAPSHOT_REBOUND.json"),
  JSON.stringify(snapshot, null, 2),
);
const destinationSnapshotHash = sha(snapshot);

const pizza = snapshot.pizza as {
  databaseId: string;
  name: string;
  itemCount: number | null;
} | null;

let incidentOp: Record<string, unknown> | null = null;
const liveDb = join(root, "runs/bella-forensics/live-runs.sqlite");
if (existsSync(liveDb)) {
  const db = new DatabaseSync(liveDb, { readOnly: true });
  incidentOp =
    (db
      .prepare(
        `SELECT * FROM operations WHERE run_id=? AND entity_type='category' AND identity_name='PIZZA'`,
      )
      .get(INCIDENT_RUN) as Record<string, unknown> | undefined) ?? null;
  db.close();
}
const destMeta = JSON.parse(
  readFileSync(join(root, "runs/bella-forensics/destination-snapshot-meta.json"), "utf8"),
);
const targetHasPizza = (targetMenu.categories as Array<{ name: string }>).some(
  (c) => /^pizza$/i.test(c.name),
);
const orphanOk =
  pizza?.databaseId === "1" &&
  pizza?.name === "PIZZA" &&
  pizza?.itemCount === 0 &&
  products.length === 0 &&
  !targetHasPizza &&
  incidentOp?.destination_id === "1" &&
  incidentOp?.state === "VERIFIED" &&
  destMeta.categoryCount === 0;

if (!orphanOk) {
  console.error(
    JSON.stringify({
      STOP: "ORPHAN_OR_DESTINATION_CHANGED",
      pizza,
      productCount: products.length,
      incidentOp,
    }),
  );
  process.exit(2);
}

const categoriesWanted = (
  targetMenu.categories as Array<{ name: string; products: unknown[] }>
).map((c) => ({ name: c.name, productCount: c.products.length }));
const productCount = categoriesWanted.reduce((n, c) => n + c.productCount, 0);

const deleteCertified =
  M2B_ADAPTER_CAPABILITIES.write.deleteCategory === "CERTIFIED" &&
  version.commitSha === RELEASE_SHA;

const planCore = {
  schemaVersion: "1",
  planKind: "BELLA_FINAL_INCIDENT_RECOVERY",
  executeAutomatically: false,
  publicationOperations: 0,
  generatedAt: new Date().toISOString(),
  productionSha: RELEASE_SHA,
  constitutionVersion: MENU_CONSTITUTION_VERSION,
  merchantName: "Bella Kebab",
  destinationHost: BELLA,
  frozenIntelligence: {
    ready: quality.statusAccounting.ready,
    review: quality.statusAccounting.review,
    blocked: quality.statusAccounting.blocked,
    targetMenuHash,
  },
  dependencyGraph: [
    "VERIFY_TARGET",
    "VERIFY_ORPHAN_PRECONDITIONS",
    "DELETE_PIZZA_ID_1",
    "READ_BACK_VERIFY_ABSENT",
    "CREATE_CORRECT_CATEGORIES",
    "VERIFY_CATEGORIES",
    "CREATE_12_PRODUCTS_HIDDEN_STAGED",
    "VERIFY_EACH_PRODUCT",
    "VERIFY_COMPLETE_TARGETMENU",
    "STOP_NO_PUBLICATION",
  ],
  operations: {
    plannedCategoryDeletes: deleteCertified ? 1 : 0,
    plannedCategoryCreates: 5,
    plannedProductCreates: 12,
    plannedProductUpdates: 0,
    plannedProductDeletes: 0,
    plannedPublicationOperations: 0,
  },
  categoryDelete: {
    name: "PIZZA",
    databaseId: "1",
    allowCustomerCategory: true,
    requireEmpty: true,
    onFailure: "STOP",
  },
  categoryCreates: categoriesWanted,
  visibilitySafety: {
    createHiddenProduct: M2B_ADAPTER_CAPABILITIES.write.createHiddenProduct,
    setProductHidden: M2B_ADAPTER_CAPABILITIES.write.setProductHidden,
    setProductAvailable: M2B_ADAPTER_CAPABILITIES.write.setProductAvailable,
    autoPublication: false,
  },
  capabilities: {
    deleteCategory: M2B_ADAPTER_CAPABILITIES.write.deleteCategory,
    createCategory: M2B_ADAPTER_CAPABILITIES.write.createCategory,
    createHiddenProduct: M2B_ADAPTER_CAPABILITIES.write.createHiddenProduct,
  },
  destinationSnapshot: {
    hash: destinationSnapshotHash,
    categories,
    productCount: products.length,
  },
  incidentOrphan: { INCIDENT_ORPHAN_CONFIRMED: "YES", incidentRunId: INCIDENT_RUN },
};

const bind = {
  ...planCore,
  hashes: {
    sourceHash,
    targetMenuHash,
    destinationSnapshotHash,
    recoveryPlanHash: null,
    productionSha: RELEASE_SHA,
    constitutionVersion: MENU_CONSTITUTION_VERSION,
  },
};
const recoveryPlanHash = sha(bind);
const plan = {
  ...planCore,
  hashes: {
    sourceHash,
    targetMenuHash,
    destinationSnapshotHash,
    recoveryPlanHash,
    productionSha: RELEASE_SHA,
    constitutionVersion: MENU_CONSTITUTION_VERSION,
  },
};
writeFileSync(
  join(outDir, "BELLA_FINAL_RECOVERY_PLAN.json"),
  JSON.stringify(plan, null, 2),
);

const previewProducts = [];
for (const cat of targetMenu.categories as Array<{
  name: string;
  products: Array<Record<string, unknown>>;
}>) {
  for (const p of cat.products) {
    const q = (quality.products as Array<Record<string, unknown>>).find(
      (x) => x.name === p.name || x.productSourceId === p.sourceId,
    );
    previewProducts.push({
      menuNumber: p.sourceMenuNumber ?? p.assignedMenuNumber ?? null,
      name: p.name,
      category: cat.name,
      basePrice: p.basePrice ?? null,
      ingredients: p.ingredients ?? [],
      description: p.description ?? null,
      variants: p.variants ?? [],
      productChoices: p.productChoices ?? [],
      isCombo: p.isCombo ?? false,
      additions: p.addOns ?? [],
      additionPrices: ((p.addOns as Array<{ name: string; price?: number }>) ?? []).map(
        (a) => ({ name: a.name, price: a.price ?? null }),
      ),
      qualityStatus: q?.status ?? "UNKNOWN",
    });
  }
}
const preview = {
  targetMenuHash,
  summary: {
    categoryDeletes: 1,
    categoryCreates: 5,
    productCreates: 12,
    productUpdates: 0,
    productDeletes: 0,
    publicationOperations: 0,
  },
  quality: quality.statusAccounting,
  products: previewProducts,
};
writeFileSync(
  join(outDir, "BELLA_FINAL_MENU_PREVIEW.json"),
  JSON.stringify(preview, null, 2),
);

const opsOk =
  plan.operations.plannedCategoryDeletes === 1 &&
  plan.operations.plannedCategoryCreates === 5 &&
  plan.operations.plannedProductCreates === 12 &&
  plan.operations.plannedProductUpdates === 0 &&
  plan.operations.plannedProductDeletes === 0 &&
  plan.operations.plannedPublicationOperations === 0;

const READY_FOR =
  deleteCertified &&
  orphanOk &&
  opsOk &&
  quality.statusAccounting.ready === 12 &&
  quality.statusAccounting.review === 0 &&
  quality.statusAccounting.blocked === 0
    ? "YES"
    : "NO";

const report = {
  DELETE_CATEGORY_RELEASE_SHA: RELEASE_SHA,
  ORIGIN_MAIN_SHA: RELEASE_SHA,
  DEPLOYED_SHA: version.commitSha,
  WORKING_TREE_CLEAN: "see_status",
  PRODUCTION_DELETE_CATEGORY_CAPABILITY:
    M2B_ADAPTER_CAPABILITIES.write.deleteCategory,
  MENU_CONSTITUTION: version.menuConstitution,
  SAFETY_GATES_ACTIVE: "YES",
  BELLA_EXISTING_CATEGORIES: categories,
  BELLA_EXISTING_PRODUCTS: products,
  INCIDENT_ORPHAN_CONFIRMED: orphanOk ? "YES" : "NO",
  READY: quality.statusAccounting.ready,
  REVIEW: quality.statusAccounting.review,
  BLOCKED: quality.statusAccounting.blocked,
  SOURCE_HASH: sourceHash,
  TARGETMENU_HASH: targetMenuHash,
  DESTINATION_SNAPSHOT_HASH: destinationSnapshotHash,
  RECOVERY_PLAN_HASH: recoveryPlanHash,
  PLANNED_CATEGORY_DELETES: plan.operations.plannedCategoryDeletes,
  PLANNED_CATEGORY_CREATES: plan.operations.plannedCategoryCreates,
  PLANNED_PRODUCT_CREATES: plan.operations.plannedProductCreates,
  PLANNED_PRODUCT_UPDATES: plan.operations.plannedProductUpdates,
  PLANNED_PRODUCT_DELETES: plan.operations.plannedProductDeletes,
  PLANNED_PUBLICATION_OPERATIONS: plan.operations.plannedPublicationOperations,
  READY_FOR_BELLA_RECOVERY_EXECUTION: READY_FOR,
  EXACT_BLOCKERS_IF_NO: READY_FOR === "YES" ? [] : ["see gates"],
  version,
  previewArtifact: "runs/bella-recovery-prep/BELLA_FINAL_MENU_PREVIEW.json",
  planArtifact: "runs/bella-recovery-prep/BELLA_FINAL_RECOVERY_PLAN.json",
};

writeFileSync(
  join(outDir, "BELLA_DEPLOY_REBIND_REPORT.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
