import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  assertActiveUnchecked,
  fillInactiveProductCreateForm,
} from "../src/tah/write/formFill.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { isProductCreateRequest } from "../src/tah/write/createRequestObserve.js";

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

// Dump all menu pages
const allRows: unknown[] = [];
for (let pnum = 1; pnum <= 6; pnum++) {
  const url =
    pnum === 1
      ? "https://veronipizza.dk/admin/menu"
      : `https://veronipizza.dk/admin/menu?page=${pnum}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const rows = await page.evaluate(`(() => {
    return [...document.querySelectorAll("table tbody tr, table tr")].map(tr => {
      const t = tr.innerText.replace(/\\s+/g, " ").trim();
      const edit = tr.querySelector("a[href*='/admin/menu/'][href$='/edit']");
      return { text: t.slice(0, 120), href: edit ? edit.getAttribute("href") : null };
    }).filter(r => r.text && /\\d/.test(r.text));
  })()`);
  allRows.push({ page: pnum, count: (rows as unknown[]).length, rows });
}
console.log("PAGES", JSON.stringify(allRows, null, 2));

// Capture 500 body for Elia
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

const respPromise = page.waitForResponse(
  (res) => isProductCreateRequest(res.request()),
  { timeout: 30_000 },
);
await page.locator("form:has(#menu_number)").evaluate((el) => {
  const f = el as HTMLFormElement;
  f.requestSubmit();
});
const resp = await respPromise;
const body = await resp.text();
console.log(
  JSON.stringify({
    status: resp.status(),
    url: resp.url(),
    bodyHead: body.slice(0, 1500),
  }, null, 2),
);
await browser.close();
