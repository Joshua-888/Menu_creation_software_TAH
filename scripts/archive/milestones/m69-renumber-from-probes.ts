/**
 * Renumber existing probe products 902/903 → 2/4, and try fresh high-number creates.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import {
  assertActiveUnchecked,
  fillInactiveProductCreateForm,
} from "../src/tah/write/formFill.js";
import { clickSkabAndObserveCreate } from "../src/tah/write/createRequestObserve.js";
import { clickOpdaterAndObserveUpdate } from "../src/tah/write/updateRequestObserve.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";

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

async function login(page: Page) {
  await page.goto("https://veronipizza.dk/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
  await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
}

async function renumberActivate(
  page: Page,
  adapter: TahAdminAdapterV1,
  databaseId: string,
  menu: string,
  name: string,
  description: string,
  price: string,
) {
  await page.goto(`https://veronipizza.dk/admin/menu/${databaseId}/edit`, {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  await page.locator("form:has(#menu_number) #menu_number").fill(menu);
  await page.locator("form:has(#menu_number) #name").fill(name);
  await page.locator("form:has(#menu_number) #description").fill(description);
  await page.locator("form:has(#menu_number) #price").fill(price);
  const active = page.locator("form:has(#menu_number) #active");
  if (!(await active.isChecked())) await active.check();
  const upd = await clickOpdaterAndObserveUpdate({
    page,
    databaseId,
    timeoutMs: 25_000,
  });
  await page.waitForTimeout(800);
  const listed = await adapter.listProducts();
  const row = listed.find((p) => p.databaseId === databaseId);
  return {
    ok: upd.ok && (row?.menuNumber || "").trim() === menu,
    statusText: row?.statusText ?? null,
    update: upd.ok ? upd.response.status : (upd as { code: string }).code,
  };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const results: unknown[] = [];
try {
  await login(page);
  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: "https://veronipizza.dk",
    expectedHost: "veronipizza.dk",
  });
  let listed = await adapter.listProducts();

  // Sanity: can we still create ANY pizza?
  await page.goto("https://veronipizza.dk/admin/menu/create", {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  await fillInactiveProductCreateForm(page, {
    menuNumber: "999",
    name: "Probe Sanity Pizza",
    description: "test",
    basePriceKr: "99",
    categoryDatabaseId: "1",
    variants: [{ name: "Alm.", priceKr: "0" }],
    ingredients: [],
  });
  await assertActiveUnchecked(page);
  const sanity = await clickSkabAndObserveCreate({ page, timeoutMs: 30_000 });
  results.push({
    sanityCreate: sanity.ok ? sanity.response.status : (sanity as { code: string }).code,
  });
  console.log(JSON.stringify(results[results.length - 1]));

  listed = await adapter.listProducts();
  const map = new Map(
    listed.filter((p) => p.databaseId).map((p) => [(p.menuNumber || "").trim(), p]),
  );

  const renumbers = [
    {
      from: "902",
      menu: "2",
      name: "Elia",
      description: "Tomat, ost, skinke",
      price: "90",
    },
    {
      from: "903",
      menu: "4",
      name: "Tobi",
      description: "Tomat, ost, kebab, bearnaisesauce",
      price: "95",
    },
    {
      from: "999",
      menu: "6",
      name: "Pepperoni",
      description: "Tomat, ost, pepperoni",
      price: "95",
    },
  ];

  for (const r of renumbers) {
    const src = map.get(r.from);
    if (!src?.databaseId) {
      results.push({ menu: r.menu, ok: false, reason: `missing source ${r.from}` });
      console.log(JSON.stringify(results[results.length - 1]));
      continue;
    }
    if (map.get(r.menu)?.databaseId) {
      results.push({ menu: r.menu, ok: true, reused: true, id: map.get(r.menu)!.databaseId });
      console.log(JSON.stringify(results[results.length - 1]));
      continue;
    }
    const out = await renumberActivate(
      page,
      adapter,
      src.databaseId,
      r.menu,
      r.name,
      r.description,
      r.price,
    );
    results.push({ menu: r.menu, id: src.databaseId, ...out });
    console.log(JSON.stringify(results[results.length - 1]));
    listed = await adapter.listProducts();
    for (const p of listed) {
      if (p.databaseId) map.set((p.menuNumber || "").trim(), p);
    }
  }
} finally {
  await browser.close();
}

const outDir = join(root, "runs", "discovery", `m69-renumber-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify({ results }, null, 2));
console.log(JSON.stringify({ results }, null, 2));
