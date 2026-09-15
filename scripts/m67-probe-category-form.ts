/**
 * Probe Veroni category create form action (read-only, no submit).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { VERONI_CANARY_TARGET } from "../src/tah/write/types.js";

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
await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, {
  waitUntil: "domcontentloaded",
});
await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
await page.getByRole("button", { name: /^login$/i }).click();
await page.waitForTimeout(1500);
await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/categories/create`, {
  waitUntil: "domcontentloaded",
});
const info = await page.evaluate(() => {
  const forms = [...document.querySelectorAll("form")].map((f) => ({
    action: f.getAttribute("action"),
    method: f.getAttribute("method"),
    hasName: !!f.querySelector("#name, input[name='name']"),
    html: f.outerHTML.slice(0, 500),
  }));
  return { url: location.href, forms };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
