/**
 * Fill missing pizza numbers that failed in m69 batch (2,4,6,…).
 * Creates Alm.+Familie like successful Hawaii/Preben, then activates.
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
import { inspectFormSubmission } from "../src/tah/write/formInspect.js";

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

type Spec = {
  menu: string;
  name: string;
  description: string;
  baseKr: string;
  familieKr: string;
  ingredients: string[];
};

const MISSING: Spec[] = [
  {
    menu: "2",
    name: "Elia",
    description: "Tomat, ost, skinke",
    baseKr: "90",
    familieKr: "85",
    ingredients: ["Tomat", "ost", "skinke"],
  },
  {
    menu: "4",
    name: "Tobi",
    description: "Tomat, ost, kebab, bearnaisesauce",
    baseKr: "95",
    familieKr: "90",
    ingredients: ["Tomat", "ost", "kebab", "bearnaisesauce"],
  },
  {
    menu: "6",
    name: "Pepperoni",
    description: "Tomat, ost, pepperoni",
    baseKr: "95",
    familieKr: "90",
    ingredients: ["Tomat", "ost", "pepperoni"],
  },
];

async function login(page: Page) {
  await page.goto("https://veronipizza.dk/login", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
  await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
}

async function activate(page: Page, databaseId: string, name: string) {
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
  if (!obs.ok) throw new Error(`${obs.code} while activating ${name}`);
}

async function createOne(
  page: Page,
  adapter: TahAdminAdapterV1,
  spec: Spec,
  mode: "alm_only" | "alm_familie",
) {
  const listed = await adapter.listProducts();
  const existing = listed.find((p) => (p.menuNumber || "").trim() === spec.menu);
  if (existing?.databaseId) {
    return { databaseId: existing.databaseId, reused: true, mode };
  }

  await page.goto("https://veronipizza.dk/admin/menu/create", {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);

  const variants =
    mode === "alm_only"
      ? [{ name: "Alm.", priceKr: "0" }]
      : [
          { name: "Alm.", priceKr: "0" },
          { name: "Familie", priceKr: spec.familieKr },
        ];

  await fillInactiveProductCreateForm(page, {
    menuNumber: spec.menu,
    name: spec.name,
    description: spec.description,
    basePriceKr: spec.baseKr,
    categoryDatabaseId: "1",
    variants,
    ingredients: spec.ingredients,
  });
  await assertActiveUnchecked(page);

  const { payload } = await inspectFormSubmission(
    page,
    "form:has(#menu_number)",
  );
  const observed = await clickSkabAndObserveCreate({ page, timeoutMs: 30_000 });
  await page.waitForTimeout(1200);
  const after = await adapter.listProducts();
  const hit = after.find((p) => (p.menuNumber || "").trim() === spec.menu);

  return {
    databaseId: hit?.databaseId ?? null,
    reused: false,
    mode,
    status: observed.ok ? observed.response.status : (observed as { code: string }).code,
    payloadKeys: Object.keys(payload.asObject).slice(0, 20),
    activeInPayload: "active" in payload.asObject,
  };
}

const outDir = join(root, "runs", "discovery", `m69-fill-gaps-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

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

  for (const spec of MISSING) {
    let result = await createOne(page, adapter, spec, "alm_familie");
    if (!result.databaseId) {
      result = await createOne(page, adapter, spec, "alm_only");
    }
    if (result.databaseId) {
      await activate(page, result.databaseId, spec.name);
      results.push({
        menu: spec.menu,
        name: spec.name,
        ok: true,
        ...result,
        activated: true,
      });
    } else {
      results.push({
        menu: spec.menu,
        name: spec.name,
        ok: false,
        ...result,
        activated: false,
      });
    }
    console.log(JSON.stringify(results[results.length - 1]));
  }
} finally {
  await browser.close();
}

writeFileSync(join(outDir, "report.json"), JSON.stringify({ results }, null, 2));
console.log(JSON.stringify({ summary: results.map((r) => ({ menu: r.menu, ok: r.ok, id: r.databaseId })) }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
