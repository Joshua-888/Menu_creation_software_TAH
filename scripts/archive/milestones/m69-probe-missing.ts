/** Probe: Veroni dest vs canonical — how many products still missing. */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { mapSourceCategoriesToDestination } from "../src/planning/categoryMapping.js";

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

const canon = JSON.parse(
  readFileSync(
    join(root, "runs/m66-veroni-validation-cleanup/canonical-menu.json"),
    "utf8",
  ),
) as {
  categories: Array<{
    sourceId: string;
    name: string;
    products: Array<{
      name: string;
      sourceMenuNumber?: string;
      assignedMenuNumber?: string;
      status: string;
      basePrice?: number;
      description?: string;
      ingredients: Array<{ display: string }>;
      variants: Array<{ name: string; surcharge: number }>;
      addOns: Array<{ name: string; price?: number }>;
    }>;
  }>;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://veronipizza.dk/login", { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
await page.getByRole("button", { name: /^login$/i }).click();
await page.waitForTimeout(1500);

const adapter = new TahAdminAdapterV1({
  page,
  baseUrl: "https://veronipizza.dk",
  expectedHost: "veronipizza.dk",
});
const cats = await adapter.listCategories();
const products = await adapter.listProducts();
const real = products.filter(
  (p) => p.databaseId && !p.name.startsWith("__TAH_CANARY_"),
);
const byMenu = new Set(
  real.map((p) => (p.menuNumber || "").trim()).filter(Boolean),
);
const maps = mapSourceCategoriesToDestination(
  canon.categories.map((c) => ({ sourceId: c.sourceId, name: c.name })),
  cats.map((c) => ({ databaseId: c.databaseId, name: c.name })),
);

const missing: Array<Record<string, unknown>> = [];
for (const cat of canon.categories) {
  const m = maps.find((x) => x.sourceCategoryId === cat.sourceId);
  for (const p of cat.products) {
    const menu = (p.assignedMenuNumber || p.sourceMenuNumber || "").trim();
    if (!menu || byMenu.has(menu)) continue;
    if (p.name.startsWith("__TAH_CANARY_")) continue;
    missing.push({
      menu,
      name: p.name,
      cat: cat.name,
      map: m?.outcome,
      destCat: m?.destinationCategoryId ?? null,
      status: p.status,
      base: p.basePrice,
    });
  }
}

const report = {
  destCats: cats.map((c) => ({ id: c.databaseId, name: c.name })),
  destRealCount: real.length,
  destMenus: [...byMenu].sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b),
  ),
  maps: maps.map((m) => ({
    name: m.sourceCategoryName,
    outcome: m.outcome,
    id: m.destinationCategoryId ?? null,
  })),
  missingCount: missing.length,
  missingByCat: missing.reduce(
    (a, x) => {
      const k = String(x.cat);
      a[k] = (a[k] || 0) + 1;
      return a;
    },
    {} as Record<string, number>,
  ),
  missing,
};
const out = join(root, "runs", "discovery", `m69-probe-${Date.now()}`);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "probe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  destRealCount: report.destRealCount,
  missingCount: report.missingCount,
  missingByCat: report.missingByCat,
  maps: report.maps,
  out,
}, null, 2));
await browser.close();
