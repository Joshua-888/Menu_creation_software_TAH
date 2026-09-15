import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
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
await page.goto("https://veronipizza.dk/admin/menu/create", {
  waitUntil: "domcontentloaded",
});
await dismissKnownCookieBanner(page);
const token = await page.locator('input[name="_token"]').inputValue();

for (const trial of [
  { menu_number: "2", name: "Elia", note: "basic" },
  { menu_number: "2", name: "Elia Pizza", note: "rename" },
  { menu_number: "2002", name: "Elia", note: "alt-menu" },
]) {
  const res = await page.request.post("https://veronipizza.dk/admin/menu", {
    multipart: {
      _token: token,
      menu_number: trial.menu_number,
      name: trial.name,
      description: "Tomat, ost, skinke",
      price: "90",
      "variants[0][name]": "Alm.",
      "variants[0][price]": "0",
      "categories[]": "1",
      // active omitted = hidden
    },
    headers: { Referer: "https://veronipizza.dk/admin/menu/create" },
    maxRedirects: 0,
  });
  const text = await res.text();
  console.log(
    JSON.stringify({
      note: trial.note,
      status: res.status(),
      loc: res.headers()["location"] || null,
      bodyHead: text.slice(0, 200).replace(/\s+/g, " "),
    }),
  );
}
await browser.close();
