/**
 * M2C: live TahAdminAdapterV1.readProduct against NEW WAY (read-only).
 * Uses plain dynamic import of compiled adapter path via tsx after pageScripts fix.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.ts";
import { extractVisibleProductFields } from "../src/tah/adapters/v1/pageScripts.mjs";
import { parseAdminPriceToOre } from "../src/tah/normalize/destination.ts";

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

const base = "https://newwaypizzaringsted.dk";
const authPath = join(root, "playwright", ".auth", "tah-admin-newway.json");
const outDir = join(root, "runs", "discovery", `m2c-live-read-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

async function ensurePage(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  let context = existsSync(authPath)
    ? await browser.newContext({ storageState: authPath })
    : await browser.newContext();
  let page = await context.newPage();
  await page.goto(`${base}/admin/menu`, { waitUntil: "domcontentloaded" });
  if (/\/login/i.test(page.url())) {
    await context.close();
    const email = process.env.TAH_ADMIN_EMAIL;
    const password = process.env.TAH_ADMIN_PASSWORD;
    if (!email || !password) throw new Error("Missing credentials");
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    await page
      .locator('input[type="password"], input[name="password"]')
      .first()
      .fill(password);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
    if (/\/login/i.test(page.url())) throw new Error("Login failed");
    mkdirSync(dirname(authPath), { recursive: true });
    await context.storageState({ path: authPath });
  }
  return { context, page };
}

const browser = await chromium.launch({ headless: true });
const { context, page } = await ensurePage(browser);
const adapter = new TahAdminAdapterV1({
  page,
  baseUrl: base,
  expectedHost: "newwaypizzaringsted.dk",
});

const list = await adapter.listProducts();
const targets = [
  { id: "1", roles: ["simple", "ingredients", "variants", "additions"] },
  { id: "2", roles: ["ingredients", "variants", "additions"] },
  { id: "12", roles: ["variants", "menuNumber!==dbId"] },
  { id: "4", roles: ["alphanumeric", "variants", "ingredients", "additions"] },
  { id: "18", roles: ["variants"] },
];

const results = [];
for (const t of targets) {
  const listRow = list.find((p) => p.databaseId === t.id) || null;
  const product = await adapter.readProduct(t.id);
  await page.goto(`${base}/admin/menu/${t.id}/edit`, {
    waitUntil: "domcontentloaded",
  });
  const visible = await page.evaluate(extractVisibleProductFields);

  const checks: Array<{ field: string; pass: boolean; detail: string }> = [];
  const eq = (field: string, a: unknown, b: unknown) => {
    const pass = String(a ?? "") === String(b ?? "");
    checks.push({
      field,
      pass,
      detail: `read=${JSON.stringify(a)} visible=${JSON.stringify(b)}`,
    });
  };
  eq("databaseId", product.databaseId, t.id);
  eq("menuNumber", product.menuNumber, visible.menuNumber);
  eq("name", product.name, visible.name?.replace(/\s+/g, " ").trim());
  eq(
    "description",
    product.description,
    visible.description?.replace(/\s+/g, " ").trim() || null,
  );
  eq("basePriceRaw", product.basePriceRaw, visible.basePrice);
  eq(
    "basePriceOre",
    product.basePriceOre,
    parseAdminPriceToOre(visible.basePrice ?? null),
  );
  eq("active", product.active, visible.active);
  eq(
    "variantNames",
    product.variants.map((v) => v.name).join("|"),
    visible.variantNames.join("|"),
  );
  eq(
    "variantPrices",
    product.variants.map((v) => v.priceRaw).join("|"),
    visible.variantPrices.join("|"),
  );
  eq(
    "ingredientNames",
    product.ingredients.map((i) => i.name).join("|"),
    visible.ingredientNames.join("|"),
  );
  eq(
    "additionNamesSample",
    product.additions
      .slice(0, 5)
      .map((a) => a.name)
      .join("|"),
    visible.additionNames.join("|"),
  );
  eq(
    "additionPricesSample",
    product.additions
      .slice(0, 5)
      .map((a) => a.priceRaw)
      .join("|"),
    visible.additionPrices.join("|"),
  );
  eq(
    "categoryIds",
    [...product.categoryIds].sort().join(","),
    [...visible.categoryIds].sort().join(","),
  );

  // Active vs list status (no mutation)
  if (listRow) {
    const listAvailable = /tilgængelig/i.test(listRow.statusText || "");
    checks.push({
      field: "activeVsListStatus",
      pass:
        product.active === null
          ? false
          : product.active === true
            ? listAvailable
            : !listAvailable,
      detail: `active=${product.active} statusText=${listRow.statusText}`,
    });
  }

  const pass = checks.every((c) => c.pass);
  results.push({
    roles: t.roles,
    listRow,
    product: {
      databaseId: product.databaseId,
      menuNumber: product.menuNumber,
      name: product.name,
      description: product.description,
      basePriceOre: product.basePriceOre,
      basePriceRaw: product.basePriceRaw,
      active: product.active,
      categoryIds: product.categoryIds,
      variants: product.variants,
      ingredients: product.ingredients.map((i) => i.name),
      additionCount: product.additions.length,
      additionsSample: product.additions.slice(0, 5),
      formMethodOverride: product.formMethodOverride,
    },
    checks,
    pass,
  });
}

writeFileSync(join(outDir, "live-readProduct.json"), JSON.stringify(results, null, 2));
console.log(
  JSON.stringify(
    {
      outDir,
      summary: results.map((r) => ({
        id: r.product.databaseId,
        menuNumber: r.product.menuNumber,
        name: r.product.name,
        pass: r.pass,
        failFields: r.checks.filter((c) => !c.pass).map((c) => c.field),
      })),
    },
    null,
    2,
  ),
);

await context.close();
await browser.close();
