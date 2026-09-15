/**
 * Workaround: create gap pizzas under temp menu numbers, then Opdater → real #.
 * Direct create for 2/4/6/12/13/19/20 returns HTTP 500 on Veroni.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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

const GAPS = [
  { menu: "2", temp: "802", name: "Elia", description: "Tomat, ost, skinke", price: "90" },
  { menu: "4", temp: "804", name: "Tobi", description: "Tomat, ost, kebab, bearnaisesauce", price: "95" },
  { menu: "6", temp: "806", name: "Pepperoni", description: "Tomat, ost, pepperoni", price: "95" },
  { menu: "12", temp: "812", name: "Two in one", description: "Tomat, ost", price: "110" },
  { menu: "13", temp: "813", name: "Genova", description: "Tomat, ost", price: "110" },
  { menu: "19", temp: "819", name: "Noah", description: "Tomat, ost", price: "115" },
  { menu: "20", temp: "820", name: "Hotchicken", description: "Tomat, ost, kylling", price: "120" },
] as const;

const outDir = join(root, "runs", "discovery", `m69-renumber-gaps-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

async function login(page: Page) {
  await page.goto("https://veronipizza.dk/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
  await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const results = [];
try {
  await login(page);
  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: "https://veronipizza.dk",
    expectedHost: "veronipizza.dk",
  });

  for (const gap of GAPS) {
    const listed = await adapter.listProducts();
    const already = listed.find((p) => (p.menuNumber || "").trim() === gap.menu);
    if (already?.databaseId) {
      results.push({ menu: gap.menu, ok: true, reused: true, id: already.databaseId });
      console.log(JSON.stringify(results[results.length - 1]));
      continue;
    }

    let tempRow = listed.find((p) => (p.menuNumber || "").trim() === gap.temp);
    if (!tempRow?.databaseId) {
      await page.goto("https://veronipizza.dk/admin/menu/create", {
        waitUntil: "domcontentloaded",
      });
      await dismissKnownCookieBanner(page);
      await fillInactiveProductCreateForm(page, {
        menuNumber: gap.temp,
        name: gap.name,
        description: gap.description,
        basePriceKr: gap.price,
        categoryDatabaseId: "1",
        variants: [{ name: "Alm.", priceKr: "0" }],
        ingredients: [],
      });
      await assertActiveUnchecked(page);
      const observed = await clickSkabAndObserveCreate({ page, timeoutMs: 30_000 });
      if (!observed.ok || observed.response.status >= 400) {
        results.push({
          menu: gap.menu,
          ok: false,
          step: "temp-create",
          status: observed.ok ? observed.response.status : (observed as { code: string }).code,
        });
        console.log(JSON.stringify(results[results.length - 1]));
        continue;
      }
      await page.waitForTimeout(1000);
      const after = await adapter.listProducts();
      tempRow = after.find((p) => (p.menuNumber || "").trim() === gap.temp);
    }

    if (!tempRow?.databaseId) {
      results.push({ menu: gap.menu, ok: false, step: "temp-missing" });
      console.log(JSON.stringify(results[results.length - 1]));
      continue;
    }

    await page.goto(
      `https://veronipizza.dk/admin/menu/${tempRow.databaseId}/edit`,
      { waitUntil: "domcontentloaded" },
    );
    await dismissKnownCookieBanner(page);
    await page.locator("form:has(#menu_number) #menu_number").fill(gap.menu);
    await page.locator("form:has(#menu_number) #name").fill(gap.name);
    const active = page.locator("form:has(#menu_number) #active");
    if (!(await active.isChecked())) await active.check();
    const upd = await clickOpdaterAndObserveUpdate({
      page,
      databaseId: tempRow.databaseId,
      timeoutMs: 25_000,
    });
    await page.waitForTimeout(800);
    const verify = await adapter.listProducts();
    const final = verify.find((p) => p.databaseId === tempRow!.databaseId);
    results.push({
      menu: gap.menu,
      ok: (final?.menuNumber || "").trim() === gap.menu && upd.ok,
      id: tempRow.databaseId,
      statusText: final?.statusText ?? null,
      updateStatus: upd.ok ? upd.response.status : (upd as { code: string }).code,
    });
    console.log(JSON.stringify(results[results.length - 1]));
  }
} finally {
  await browser.close();
}

writeFileSync(join(outDir, "report.json"), JSON.stringify({ results }, null, 2));
console.log(JSON.stringify({
  ok: results.filter((r) => r.ok).map((r) => r.menu),
  failed: results.filter((r) => !r.ok),
}, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
