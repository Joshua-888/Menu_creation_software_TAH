/**
 * READ-ONLY: Veroni product 18 form completeness diagnostic.
 * Does NOT click Opdater / Skab. Zero intentional mutations.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extractAdminFormCompletenessSnapshot } from "../src/tah/adapters/v1/pageScripts.mjs";
import {
  validateAdminFormBeforeSubmit,
  validateInstantiatedRowsComplete,
  unintendedBlankRows,
  instantiatedRows,
  type AdminFormCompletenessSnapshot,
  type WritePlanDynamicCollections,
} from "../src/tah/write/formCompleteness.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(join(root, ".env"));

const base = "https://veronipizza.dk";
const outDir = join(
  root,
  "runs",
  "discovery",
  `m3h-form-completeness-${Date.now()}`,
);
mkdirSync(outDir, { recursive: true });

/**
 * Product-specific WritePlan collections for canary 18 — NOT a global default.
 * Variant names remain open-ended; this is only THIS product's approved rows.
 */
const CANARY_18_WRITE_PLAN: WritePlanDynamicCollections = {
  variants: [{ name: "Alm.", price: "0" }],
  ingredients: [
    { name: "Test ingredient A" },
    { name: "Test ingredient B" },
  ],
  additions: [],
};

const CANARY = {
  databaseId: "18",
  menuNumber: "99001",
  name: "__TAH_CANARY_PRODUCT_M3__",
  description: "Automated TakeAwayHero inactive canary test",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: existsSync(join(root, "playwright/.auth/tah-admin-veroni.json"))
    ? join(root, "playwright/.auth/tah-admin-veroni.json")
    : undefined,
});
const page = await context.newPage();

const mutationMeta: Array<{ method: string; url: string }> = [];
page.on("request", (req) => {
  const m = req.method().toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(m)) {
    mutationMeta.push({ method: m, url: req.url().split("?")[0]! });
  }
});

async function ensureAdmin() {
  await page.goto(`${base}/admin/menu/18/edit`, {
    waitUntil: "domcontentloaded",
  });
  if (/\/login/i.test(page.url())) {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page
      .locator('input[type="email"]')
      .first()
      .fill(process.env.TAH_ADMIN_EMAIL!);
    await page
      .locator('input[type="password"]')
      .first()
      .fill(process.env.TAH_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
    await page.goto(`${base}/admin/menu/18/edit`, {
      waitUntil: "domcontentloaded",
    });
  }
}

await ensureAdmin();

try {
  const allow = page.getByRole("button", { name: /allow cookies/i });
  if (await allow.count()) await allow.click({ timeout: 2000 }).catch(() => {});
} catch {
  /* ignore */
}

const raw = (await page.evaluate(
  extractAdminFormCompletenessSnapshot,
)) as AdminFormCompletenessSnapshot;

if (
  raw.name !== CANARY.name ||
  raw.menuNumber !== CANARY.menuNumber ||
  raw.description !== CANARY.description
) {
  console.error(
    JSON.stringify({ status: "BLOCKED", reason: "identity", raw }, null, 2),
  );
  await browser.close();
  process.exit(2);
}

const completenessOnly = validateInstantiatedRowsComplete(raw);
const againstPlan = validateAdminFormBeforeSubmit(raw, CANARY_18_WRITE_PLAN);
const blanks = unintendedBlankRows(raw, CANARY_18_WRITE_PLAN);

const liveVariants = instantiatedRows(raw.variants);
const liveIngredients = instantiatedRows(raw.ingredients);
const liveAdditions = instantiatedRows(raw.additions);

const report = {
  host: "veronipizza.dk",
  databaseId: "18",
  readOnly: true,
  opdaterClicked: false,
  mutationRequestsObserved: mutationMeta,
  writePlanNote:
    "CANARY_18_WRITE_PLAN is product-specific for canary 18 only — not a global row-count/name default; variant names remain open-ended.",
  writePlan: CANARY_18_WRITE_PLAN,
  scalars: {
    menuNumberPopulated: Boolean(raw.menuNumber?.trim()),
    namePopulated: Boolean(raw.name?.trim()),
    descriptionPopulated: Boolean(raw.description?.trim()),
    basePricePopulated: Boolean(String(raw.basePrice ?? "").trim()),
    categorySelected: (raw.categoryIds || []).length > 0,
    menuNumber: raw.menuNumber,
    name: raw.name,
    description: raw.description,
    basePrice: raw.basePrice,
    categoryIds: raw.categoryIds,
  },
  variants: {
    instantiatedCount: liveVariants.length,
    blueprintsIgnored: raw.variants.filter((r) => r.isBlueprint).length,
    rows: liveVariants.map((r, i) => ({
      index: i,
      name: r.name,
      price: r.price,
      complete: Boolean(r.name?.trim()) && Boolean(String(r.price ?? "").trim()),
    })),
  },
  ingredients: {
    instantiatedCount: liveIngredients.length,
    blueprintsIgnored: raw.ingredients.filter((r) => r.isBlueprint).length,
    rows: liveIngredients.map((r, i) => ({
      index: i,
      name: r.name,
      complete: Boolean(r.name?.trim()),
    })),
  },
  additions: {
    instantiatedCount: liveAdditions.length,
    blueprintsIgnored: raw.additions.filter((r) => r.isBlueprint).length,
    rows: liveAdditions.map((r, i) => ({
      index: i,
      name: r.name,
      price: r.price,
      complete:
        Boolean(r.name?.trim()) && Boolean(String(r.price ?? "").trim()),
    })),
  },
  unexpectedBlankDynamicRows: blanks,
  nativeCheckValidity: raw.nativeCheckValidity,
  completenessOnly,
  againstProductWritePlan: againstPlan,
  overall:
    againstPlan.submitReady && completenessOnly.submitReady
      ? "SUBMIT_READY"
      : "NOT_SUBMIT_READY",
};

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
mkdirSync(join(root, "fixtures", "admin-contracts", "v1"), { recursive: true });
writeFileSync(
  join(
    root,
    "fixtures",
    "admin-contracts",
    "v1",
    "m3h-form-completeness-evidence.json",
  ),
  JSON.stringify(report, null, 2),
);

console.log(JSON.stringify(report, null, 2));
await browser.close();

if (mutationMeta.length > 0) {
  console.error("UNEXPECTED_MUTATION_REQUEST during read-only diagnostic");
  process.exit(3);
}
