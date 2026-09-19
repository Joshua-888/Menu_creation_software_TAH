import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";

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
const products = await adapter.listProducts();
const menus = products
  .map((p) => ({
    id: p.databaseId,
    menu: p.menuNumber,
    name: p.name,
    status: p.statusText,
  }))
  .sort((a, b) => String(a.menu).localeCompare(String(b.menu), "da", { numeric: true }));

await page.goto("https://veronipizza.dk/admin/menu", { waitUntil: "domcontentloaded" });
const pageMeta = await page.evaluate(`(() => ({
  url: location.href,
  bodyLen: document.body.innerText.length,
  rowCount: document.querySelectorAll("table tbody tr, table tr").length,
  hasNext: /næste|next|›|»/i.test(document.body.innerText),
  pagination: [...document.querySelectorAll("a,button")].map(a => a.textContent?.trim()).filter(t => t && /\\d+|næste|next|forrige|prev/i.test(t)).slice(0, 30)
}))()`);

console.log(JSON.stringify({ count: products.length, menus, pageMeta }, null, 2));
await browser.close();
