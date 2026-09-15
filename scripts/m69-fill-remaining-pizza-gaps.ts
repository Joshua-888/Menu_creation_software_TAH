/** Fill remaining pizza gaps 12/13/19/20 via temp create + renumber. */
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

const GAPS = [
  { menu: "12", temp: "912", name: "Two in one", description: "Tomat, ost", price: "110" },
  { menu: "13", temp: "913", name: "Genova", description: "Tomat, ost", price: "110" },
  { menu: "19", temp: "919", name: "Noah", description: "Tomat, ost", price: "115" },
  { menu: "20", temp: "920", name: "Hotchicken", description: "Tomat, ost, kylling", price: "120" },
] as const;

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
    let listed = await adapter.listProducts();
    const existing = listed.find((p) => (p.menuNumber || "").trim() === gap.menu);
    if (existing?.databaseId) {
      // ensure active
      await page.goto(`https://veronipizza.dk/admin/menu/${existing.databaseId}/edit`, {
        waitUntil: "domcontentloaded",
      });
      await dismissKnownCookieBanner(page);
      const active = page.locator("form:has(#menu_number) #active");
      if (!(await active.isChecked())) {
        await active.check();
        await clickOpdaterAndObserveUpdate({
          page,
          databaseId: existing.databaseId,
          timeoutMs: 25_000,
        });
      }
      results.push({ menu: gap.menu, ok: true, reused: true, id: existing.databaseId });
      console.log(JSON.stringify(results[results.length - 1]));
      continue;
    }

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
    const created = await clickSkabAndObserveCreate({ page, timeoutMs: 30_000 });
    await page.waitForTimeout(1000);
    listed = await adapter.listProducts();
    const temp = listed.find((p) => (p.menuNumber || "").trim() === gap.temp);
    if (!temp?.databaseId || !created.ok || created.response.status >= 400) {
      results.push({
        menu: gap.menu,
        ok: false,
        step: "temp",
        status: created.ok ? created.response.status : (created as { code: string }).code,
      });
      console.log(JSON.stringify(results[results.length - 1]));
      continue;
    }

    await page.goto(`https://veronipizza.dk/admin/menu/${temp.databaseId}/edit`, {
      waitUntil: "domcontentloaded",
    });
    await dismissKnownCookieBanner(page);
    await page.locator("form:has(#menu_number) #menu_number").fill(gap.menu);
    await page.locator("form:has(#menu_number) #name").fill(gap.name);
    const active = page.locator("form:has(#menu_number) #active");
    if (!(await active.isChecked())) await active.check();
    const upd = await clickOpdaterAndObserveUpdate({
      page,
      databaseId: temp.databaseId,
      timeoutMs: 25_000,
    });
    results.push({
      menu: gap.menu,
      ok: upd.ok,
      id: temp.databaseId,
      update: upd.ok ? upd.response.status : (upd as { code: string }).code,
    });
    console.log(JSON.stringify(results[results.length - 1]));
  }
} finally {
  await browser.close();
}

const outDir = join(root, "runs", "discovery", `m69-more-gaps-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify({ results }, null, 2));
console.log(JSON.stringify({ results }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
