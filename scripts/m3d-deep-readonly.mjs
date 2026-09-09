/**
 * M3D READ-ONLY: deepen show-page + list status + public menu payload.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

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

const outDir = join("runs", "discovery", `m3d-deep-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: "playwright/.auth/tah-admin-veroni.json",
});
const page = await ctx.newPage();

await page.goto("https://veronipizza.dk/admin/menu/18", {
  waitUntil: "domcontentloaded",
});
const show = await page.evaluate(() => {
  const bodyHtml = document.body.innerHTML;
  // Find Aktiv section context
  const idx = bodyHtml.search(/Aktiv/i);
  const slice = idx >= 0 ? bodyHtml.slice(Math.max(0, idx - 300), idx + 500) : null;
  // Look for yes/no/checked indicators near active
  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.textContent || "").replace(/\s+/g, " ").trim();
    if (t && /aktiv|skjult|tilgæng|ja|nej|yes|no/i.test(t) && t.length < 60) {
      textNodes.push(t);
    }
  }
  // Check icons / boolean displays
  const nearAktiv = [...document.querySelectorAll("label, dt, th, h3, h4, span, div")]
    .filter((el) => /Aktiv/i.test(el.textContent || "") && (el.textContent || "").length < 40)
    .map((el) => ({
      tag: el.tagName,
      text: (el.textContent || "").replace(/\s+/g, " ").trim(),
      nextText: (el.nextElementSibling?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      parentText: (el.parentElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
    }));
  return { textNodes, nearAktiv, slice };
});

// Compare list statuses if we can find any pattern - only one product
await page.goto("https://veronipizza.dk/admin/menu", {
  waitUntil: "domcontentloaded",
});
const listStatus = await page.evaluate(() => {
  const row = [...document.querySelectorAll("table tbody tr")].find((tr) =>
    /\/admin\/menu\/18\/edit/i.test(
      tr.querySelector("a[href*='/edit']")?.getAttribute("href") || "",
    ),
  );
  const span = row?.querySelector("td span.rounded-full, td span[class*='rose'], td span[class*='emerald']");
  return {
    statusText: span?.textContent?.replace(/\s+/g, " ").trim() || null,
    statusClass: span?.className || null,
    fullStatusCell: row?.querySelectorAll("td")[5]?.innerHTML || null,
  };
});

// Public: look for embedded JSON / alpine / htmx menu data
const pub = await ctx.newPage();
const bodies = [];
pub.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("veronipizza.dk")) return;
  if (/\.(css|js|png|jpg|svg|woff)/i.test(url) && !/menu/i.test(url)) return;
  try {
    const ct = res.headers()["content-type"] || "";
    if (/html|json/i.test(ct) || /menu|product/i.test(url)) {
      const t = await res.text();
      if (t.includes("menu") || t.includes("product") || t.includes("Pizza")) {
        bodies.push({
          url: url.slice(0, 200),
          ct,
          hasCanary: t.includes("__TAH_CANARY") || t.includes("99001"),
          hasId18: /"id"\s*:\s*18\b|menu\/18|"menu_id"\s*:\s*18/.test(t),
          activeFlags: [
            ...t.matchAll(/"(active|is_active|hidden|visible|status)"\s*:\s*("[^"]+"|true|false|\d+)/gi),
          ]
            .slice(0, 20)
            .map((m) => m[0]),
          // Count product-like objects mentioning Pizza category
          pizzaMentions: (t.match(/Pizza/g) || []).length,
        });
      }
    }
  } catch {
    /* ignore */
  }
});
await pub.goto("https://veronipizza.dk/", { waitUntil: "networkidle" });
await pub.waitForTimeout(2000);
const embedded = await pub.evaluate(() => {
  const scripts = [...document.querySelectorAll("script")]
    .map((s) => s.textContent || "")
    .filter((t) => /menu|product|active/i.test(t));
  return {
    inlineScriptCount: scripts.length,
    canaryInDom: document.body.innerHTML.includes("__TAH_CANARY"),
    id18InDom: /menu\/18|"id":18/.test(document.body.innerHTML),
    // Alpine/x-data snippets
    xDataSamples: [...document.querySelectorAll("[x-data]")]
      .slice(0, 5)
      .map((el) => (el.getAttribute("x-data") || "").slice(0, 200)),
  };
});

const report = { show, listStatus, publicBodies: bodies.slice(0, 20), embedded };
writeFileSync(join(outDir, "deep.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outDir, listStatus, nearAktiv: show.nearAktiv, embedded, bodyHits: bodies.map((b) => ({ url: b.url, hasCanary: b.hasCanary, hasId18: b.hasId18, activeFlags: b.activeFlags })) }, null, 2));
await browser.close();
