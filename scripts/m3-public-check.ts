import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://veronipizza.dk/", { waitUntil: "networkidle" });
await page
  .getByRole("button", { name: /allow cookies/i })
  .click({ timeout: 3000 })
  .catch(() => {});
const text = await page.evaluate(() => document.body.innerText || "");
const name = "__TAH_CANARY_PRODUCT_M3__";
console.log(
  JSON.stringify(
    {
      visible: text.includes(name),
      tahMentions: (text.match(/TAH_CANARY/g) || []).length,
      sampleHasPizza: /Pizza/i.test(text),
    },
    null,
    2,
  ),
);
await browser.close();
