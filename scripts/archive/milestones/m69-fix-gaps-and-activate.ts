/**
 * Fill pizza gaps 2/4/6 (true 500s) + activate all non-canary Skjult products.
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
  { menu: "2", name: "Elia", description: "Tomat, ost, skinke", price: "90", cat: "1" },
  { menu: "4", name: "Tobi", description: "Tomat, ost, kebab, bearnaisesauce", price: "95", cat: "1" },
  { menu: "6", name: "Pepperoni", description: "Tomat, ost, pepperoni", price: "95", cat: "1" },
  { menu: "12", name: "Two in one", description: "Tomat, ost", price: "110", cat: "1" },
  { menu: "13", name: "Genova", description: "Tomat, ost", price: "110", cat: "1" },
  { menu: "19", name: "Noah", description: "Tomat, ost", price: "115", cat: "1" },
  { menu: "20", name: "Hotchicken", description: "Tomat, ost, kylling", price: "120", cat: "1" },
  { menu: "22", name: "Calzone", description: "Tomat, ost, kødsovs", price: "95", cat: "4" },
] as const;

const outDir = join(root, "runs", "discovery", `m69-gaps-activate-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

async function login(page: Page) {
  await page.goto("https://veronipizza.dk/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
  await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
}

async function createGap(
  page: Page,
  adapter: TahAdminAdapterV1,
  gap: (typeof GAPS)[number],
) {
  const listed = await adapter.listProducts();
  const existing = listed.find((p) => (p.menuNumber || "").trim() === gap.menu);
  if (existing?.databaseId) {
    return { databaseId: existing.databaseId, created: false, status: "exists" };
  }

  await page.goto("https://veronipizza.dk/admin/menu/create", {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  // Alm-only: multi-variant creates have been returning HTTP 500 for these gap SKUs
  await fillInactiveProductCreateForm(page, {
    menuNumber: gap.menu,
    name: gap.name,
    description: gap.description,
    basePriceKr: gap.price,
    categoryDatabaseId: gap.cat,
    variants: [{ name: "Alm.", priceKr: "0" }],
    ingredients: [],
  });
  await assertActiveUnchecked(page);
  const observed = await clickSkabAndObserveCreate({ page, timeoutMs: 30_000 });
  await page.waitForTimeout(1200);
  const after = await adapter.listProducts();
  const hit = after.find((p) => (p.menuNumber || "").trim() === gap.menu);
  return {
    databaseId: hit?.databaseId ?? null,
    created: Boolean(hit?.databaseId),
    status: observed.ok ? String(observed.response.status) : (observed as { code: string }).code,
  };
}

async function activate(page: Page, databaseId: string) {
  await page.goto(`https://veronipizza.dk/admin/menu/${databaseId}/edit`, {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  const active = page.locator("form:has(#menu_number) #active");
  if (!(await active.isChecked())) await active.check();
  const obs = await clickOpdaterAndObserveUpdate({
    page,
    databaseId,
    timeoutMs: 25_000,
  });
  if (!obs.ok) throw new Error(obs.code);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const report: Record<string, unknown> = { gaps: [], activated: [], failedActivate: [] };
try {
  await login(page);
  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: "https://veronipizza.dk",
    expectedHost: "veronipizza.dk",
  });

  for (const gap of GAPS) {
    const result = await createGap(page, adapter, gap);
    const row = { menu: gap.menu, name: gap.name, ...result };
    (report.gaps as unknown[]).push(row);
    console.log(JSON.stringify({ gap: row }));
  }

  const all = await adapter.listProducts();
  const toActivate = all.filter(
    (p) =>
      p.databaseId &&
      !p.name.startsWith("__TAH_CANARY_") &&
      !/^90\d/.test((p.menuNumber || "").trim()) && // probe leftovers 902/903
      /skjult/i.test((p.statusText || "").trim()),
  );

  console.log(JSON.stringify({ toActivateCount: toActivate.length }));
  for (const p of toActivate) {
    try {
      await activate(page, p.databaseId!);
      (report.activated as unknown[]).push({
        menu: p.menuNumber,
        name: p.name,
        id: p.databaseId,
      });
      console.log(
        JSON.stringify({
          activated: true,
          menu: p.menuNumber,
          name: p.name,
          id: p.databaseId,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      (report.failedActivate as unknown[]).push({
        menu: p.menuNumber,
        name: p.name,
        id: p.databaseId,
        error: message,
      });
      console.log(
        JSON.stringify({
          activated: false,
          menu: p.menuNumber,
          error: message,
        }),
      );
    }
  }

  const finalList = await adapter.listProducts();
  report.finalMenus = finalList
    .filter((p) => !p.name.startsWith("__TAH_CANARY_"))
    .map((p) => ({
      menu: p.menuNumber,
      name: p.name,
      status: p.statusText,
    }))
    .sort((a, b) =>
      String(a.menu).localeCompare(String(b.menu), "da", { numeric: true }),
    );
} finally {
  await browser.close();
}

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  gaps: report.gaps,
  activatedCount: (report.activated as unknown[]).length,
  failedActivateCount: (report.failedActivate as unknown[]).length,
  outDir,
}, null, 2));
