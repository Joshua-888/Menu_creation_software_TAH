import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

function loadEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: "playwright/.auth/tah-admin-veroni.json",
});
const page = await ctx.newPage();
let raw = "";
page.on("response", async (res) => {
  if (/\/admin\/menu\/18\/?$/i.test(new URL(res.url()).pathname) && !/edit/i.test(res.url())) {
    try {
      raw = await res.text();
    } catch {}
  }
});
await page.goto("https://veronipizza.dk/admin/menu/18", {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(500);

// Extract all occurrences of active / Aktiv from raw HTML
const matches = [];
const re = /.{0,120}active.{0,120}|.{0,80}Aktiv.{0,120}/gi;
let m;
while ((m = re.exec(raw)) && matches.length < 40) {
  matches.push(m[0].replace(/\s+/g, " "));
}

const dom = await page.evaluate(() => {
  const h4s = [...document.querySelectorAll("h3,h4,h5,label")].map((el) => ({
    tag: el.tagName,
    text: (el.textContent || "").replace(/\s+/g, " ").trim(),
    html: el.outerHTML.slice(0, 200),
  }));
  const activeInput = document.querySelector("#active,[name=active]");
  return {
    h4s: h4s.filter((h) => /aktiv|variant|ingrediens|pris|kategor/i.test(h.text)),
    activeInput: activeInput
      ? {
          exists: true,
          checked: activeInput.checked,
          outer: activeInput.outerHTML,
          disabled: activeInput.disabled,
          readOnly: activeInput.readOnly,
        }
      : { exists: false },
  };
});

console.log(JSON.stringify({ matches, dom }, null, 2));
writeFileSync(
  "runs/discovery/m3d-show-active.json",
  JSON.stringify({ matches, dom }, null, 2),
);
await browser.close();
