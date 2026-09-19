import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import {
  assertActiveUnchecked,
  fillInactiveProductCreateForm,
} from "../src/tah/write/formFill.js";
import { clickSkabAndObserveCreate } from "../src/tah/write/createRequestObserve.js";
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

const specs = [
  {
    menu: "902",
    name: "Elia Probe Alm",
    variants: [{ name: "Alm.", priceKr: "0" }],
    price: "90",
  },
  {
    menu: "903",
    name: "Elia Probe Fam",
    variants: [
      { name: "Alm.", priceKr: "0" },
      { name: "Familie", priceKr: "85" },
    ],
    price: "90",
  },
];

for (const spec of specs) {
  await page.goto("https://veronipizza.dk/admin/menu/create", {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  await fillInactiveProductCreateForm(page, {
    menuNumber: spec.menu,
    name: spec.name,
    description: "Tomat, ost, skinke",
    basePriceKr: spec.price,
    categoryDatabaseId: "1",
    variants: spec.variants,
    ingredients: ["Tomat", "ost", "skinke"],
  });
  await assertActiveUnchecked(page);
  const obs = await clickSkabAndObserveCreate({ page, timeoutMs: 30_000 });
  await page.waitForTimeout(1000);
  const listed = await adapter.listProducts();
  const hit = listed.find((p) => (p.menuNumber || "").trim() === spec.menu);
  console.log(
    JSON.stringify({
      menu: spec.menu,
      variants: spec.variants.length,
      status: obs.ok ? obs.response.status : (obs as { code: string }).code,
      hit: hit
        ? { id: hit.databaseId, name: hit.name, status: hit.statusText }
        : null,
    }),
  );
}
await browser.close();
