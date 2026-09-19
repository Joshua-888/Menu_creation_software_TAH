/** Debug one failing create (menu #2 Elia). */
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
import { V1_ROUTES } from "../src/tah/adapters/v1/selectors.js";

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
const before = await adapter.listProducts();
console.log("before_count", before.length);
console.log(
  "has_menu_2",
  before.some((p) => (p.menuNumber || "").trim() === "2"),
);

await page.goto(new URL(V1_ROUTES.menuCreate, "https://veronipizza.dk").toString(), {
  waitUntil: "domcontentloaded",
});
await dismissKnownCookieBanner(page);
await fillInactiveProductCreateForm(page, {
  menuNumber: "2",
  name: "Elia",
  description: "Tomat, ost, skinke",
  basePriceKr: "75",
  categoryDatabaseId: "1",
  variants: [
    { name: "Alm.", priceKr: "0" },
    { name: "Familie", priceKr: "50" },
  ],
  ingredients: ["Tomat", "ost", "skinke"],
});
await assertActiveUnchecked(page);
const validity = await page.evaluate(() => {
  const f = document.querySelector("form:has(#menu_number)") as HTMLFormElement;
  return {
    checkValidity: f.checkValidity(),
    active: (document.querySelector("#active") as HTMLInputElement)?.checked,
  };
});
console.log("pre_submit", validity);
const observed = await clickSkabAndObserveCreate({ page, timeoutMs: 30_000 });
console.log("observed", observed);
await page.waitForTimeout(1500);
const after = await adapter.listProducts();
const hit = after.find((p) => (p.menuNumber || "").trim() === "2");
console.log("after_count", after.length, "hit", hit);
await browser.close();
