import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  assertActiveUnchecked,
  fillInactiveProductCreateForm,
} from "../src/tah/write/formFill.js";
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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://veronipizza.dk/login", { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
await page.getByRole("button", { name: /^login$/i }).click();
await page.waitForTimeout(1500);
await page.goto("https://veronipizza.dk/admin/menu/create", {
  waitUntil: "domcontentloaded",
});
await dismissKnownCookieBanner(page);
await fillInactiveProductCreateForm(page, {
  menuNumber: "2",
  name: "Elia",
  description: "Tomat, ost, skinke",
  basePriceKr: "90",
  categoryDatabaseId: "1",
  variants: [{ name: "Alm.", priceKr: "0" }],
  ingredients: ["Tomat", "ost", "skinke"],
});
await assertActiveUnchecked(page);
const { payload } = await inspectFormSubmission(page, "form:has(#menu_number)");
console.log(JSON.stringify(payload.asObject, null, 2));
await browser.close();
