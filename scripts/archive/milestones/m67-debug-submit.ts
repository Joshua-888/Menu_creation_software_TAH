import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { CANARY_NAMES, VERONI_CANARY_TARGET } from "../src/tah/write/types.js";

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
await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
await page.getByRole("button", { name: /^login$/i }).click();
await page.waitForTimeout(2000);
await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/categories/create`, {
  waitUntil: "domcontentloaded",
});
await dismissKnownCookieBanner(page);

const beforeFill = await page.evaluate(() => {
  const f = document.querySelector('form[action*="/admin/categories"]') as HTMLFormElement;
  return [...f.querySelectorAll("input,select,textarea")].map((el) => {
    const i = el as HTMLInputElement;
    return {
      name: i.name,
      id: i.id,
      type: i.type,
      required: i.required,
      value: i.value,
      validity: i.validity.valid,
      badInput: i.validity.badInput,
      valueMissing: i.validity.valueMissing,
      rangeOverflow: i.validity.rangeOverflow,
      rangeUnderflow: i.validity.rangeUnderflow,
      message: i.validationMessage,
      min: i.min,
      max: i.max,
      outer: i.outerHTML.slice(0, 200),
    };
  });
});
console.log("before", JSON.stringify(beforeFill, null, 2));

await page.locator("#name").fill("Pasta");
await page.locator("#order").fill("10");

const afterFill = await page.evaluate(() => {
  const f = document.querySelector('form[action*="/admin/categories"]') as HTMLFormElement;
  return {
    checkValidity: f.checkValidity(),
    fields: [...f.querySelectorAll("input,select,textarea")].map((el) => {
      const i = el as HTMLInputElement;
      return {
        name: i.name,
        value: i.value,
        validity: i.validity.valid,
        message: i.validationMessage,
        valueMissing: i.validity.valueMissing,
      };
    }),
  };
});
console.log("after", JSON.stringify(afterFill, null, 2));

// try create with simple name via API using fresh token + session
const token = await page.locator('form[action*="/admin/categories"] input[name="_token"]').inputValue();
const res = await page.request.post(`${VERONI_CANARY_TARGET.baseUrl}/admin/categories`, {
  form: { _token: token, name: CANARY_NAMES.categoryCreate, order: "10" },
  headers: { Referer: `${VERONI_CANARY_TARGET.baseUrl}/admin/categories/create` },
  maxRedirects: 5,
});
console.log("api", res.status(), res.url());
const body = await res.text();
console.log("redirectedHasErrors", /error|ugyldig|invalid/i.test(body.slice(0, 2000)));
await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/categories`, { waitUntil: "domcontentloaded" });
console.log("listHasCanary", (await page.locator("body").innerText()).includes(CANARY_NAMES.categoryCreate));
await browser.close();
