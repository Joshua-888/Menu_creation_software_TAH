import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://veronipizza.dk/", { waitUntil: "networkidle" }).catch(() => {});
await browser.close();

const browser2 = await chromium.launch({ headless: true });
const ctx = await browser2.newContext({
  storageState: "playwright/.auth/tah-admin-veroni.json",
});
const admin = await ctx.newPage();
await admin.goto("https://veronipizza.dk/admin/menu/18/edit", {
  waitUntil: "domcontentloaded",
});
const info = await admin.evaluate(() => {
  const form =
    document.querySelector("form:has(#menu_number)") ||
    document.querySelector("#menu_number")?.closest("form");
  const active = form?.querySelector("#active");
  const statusHints = [...document.querySelectorAll("*")]
    .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
    .filter((t) => /Skjult|Tilgængelig|Aktiv/i.test(t) && t.length < 40)
    .slice(0, 20);
  return {
    activeChecked: active ? active.checked : null,
    activeValue: active ? active.value : null,
    activeOuter: active ? active.outerHTML : null,
    name: form?.querySelector("#name")?.value || null,
    statusHints,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser2.close();
