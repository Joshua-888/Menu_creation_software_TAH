/**
 * Read-only diagnose why description Opdater did not persist.
 * NO Opdater click.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(path) {
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
const context = await browser.newContext({
  storageState: existsSync(join(root, "playwright/.auth/tah-admin-veroni.json"))
    ? join(root, "playwright/.auth/tah-admin-veroni.json")
    : undefined,
});
const page = await context.newPage();
await page.goto("https://veronipizza.dk/admin/menu/18/edit", {
  waitUntil: "domcontentloaded",
});
if (/login/i.test(page.url())) {
  await page.goto("https://veronipizza.dk/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
  await page.goto("https://veronipizza.dk/admin/menu/18/edit", {
    waitUntil: "domcontentloaded",
  });
}

const info = await page.evaluate(() => {
  const forms = [...document.querySelectorAll("form")].map((f, idx) => ({
    idx,
    action: f.getAttribute("action"),
    method: f.getAttribute("method"),
    hasMenuNumber: !!f.querySelector("#menu_number"),
    hasDescription: !!f.querySelector("#description"),
    descriptionName: f.querySelector("#description")?.getAttribute("name"),
    descriptionValue: f.querySelector("#description")?.value,
    opdaterButtons: [...f.querySelectorAll("button, input[type=submit]")].map(
      (b) => ({
        tag: b.tagName,
        type: b.getAttribute("type"),
        text: (b.textContent || b.getAttribute("value") || "").trim(),
      }),
    ),
  }));
  const allOpdater = [...document.querySelectorAll("button, input[type=submit]")]
    .filter((b) => /opdater/i.test(b.textContent || b.getAttribute("value") || ""))
    .map((b) => ({
      text: (b.textContent || b.value || "").trim(),
      type: b.getAttribute("type"),
      formAction: b.closest("form")?.getAttribute("action"),
      formHasMenu: !!b.closest("form")?.querySelector("#menu_number"),
    }));
  return {
    url: location.pathname,
    descriptionGlobal: document.querySelector("#description")?.value,
    name: document.querySelector("#name")?.value,
    forms,
    allOpdater,
  };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
