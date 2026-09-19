import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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
const snap = await page.evaluate(`(() => {
  const rows = (sel) =>
    [...document.querySelectorAll(sel)].map((tr) => ({
      id: tr.id,
      className: tr.className,
      inputs: [...tr.querySelectorAll("input")].map((i) => ({
        name: i.name,
        value: i.value,
        className: i.className,
      })),
      buttons: [...tr.querySelectorAll("button, a")].map((b) => ({
        text: (b.textContent || "").trim().slice(0, 40),
        className: b.className,
        id: b.id,
      })),
      html: tr.outerHTML.slice(0, 400),
    }));
  return {
    variants: rows("#variant-list tr"),
    ingredients: rows("#ingredient-list tr"),
    additions: rows("#addition-list tr"),
  };
})()`);
console.log(JSON.stringify(snap, null, 2));
await browser.close();
