/**
 * M3 preflight READ-ONLY on Veroni: target lock, baseline, active default.
 * Never submits forms.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
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

const EXPECTED_HOST = "veronipizza.dk";
const base = `https://${EXPECTED_HOST}`;
const authPath = join(root, "playwright", ".auth", "tah-admin-veroni.json");
const outDir = join(root, "runs", "discovery", `m3-preflight-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
let context = existsSync(authPath)
  ? await browser.newContext({ storageState: authPath })
  : await browser.newContext();
let page = await context.newPage();

await page.goto(`${base}/admin/menu`, { waitUntil: "domcontentloaded" });
if (/\/login/i.test(page.url())) {
  await context.close();
  const email = process.env.TAH_ADMIN_EMAIL;
  const password = process.env.TAH_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Missing credentials");
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
  if (/\/login/i.test(page.url())) throw new Error("Login failed");
  mkdirSync(dirname(authPath), { recursive: true });
  await context.storageState({ path: authPath });
}

const host = new URL(page.url()).host;
const targetLock = {
  expectedHost: EXPECTED_HOST,
  actualHost: host,
  pass: host.toLowerCase() === EXPECTED_HOST,
};

await page.goto(`${base}/admin/menu`, { waitUntil: "domcontentloaded" });
const products = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("table tbody tr")];
  return {
    rowCount: rows.length,
    names: rows.map((tr) => {
      const span = tr.querySelector("td span");
      return (span?.textContent || tr.querySelectorAll("td")[2]?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
    }),
  };
});

await page.goto(`${base}/admin/categories`, { waitUntil: "domcontentloaded" });
const categories = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("table tbody tr")];
  return {
    rowCount: rows.length,
    names: rows.map((tr) =>
      (tr.querySelectorAll("td")[0]?.textContent || "").replace(/\s+/g, " ").trim(),
    ),
  };
});

// CREATE form — active default (READ-ONLY, no submit)
await page.goto(`${base}/admin/menu/create`, { waitUntil: "domcontentloaded" });
const createForm = await page.evaluate(() => {
  const active = document.querySelector("#active");
  return {
    url: location.pathname,
    host: location.host,
    activeExists: !!active,
    activeChecked: active ? active.checked : null,
    activeValue: active ? active.value : null,
    hasSkab: [...document.querySelectorAll("button,input[type=submit]")].some(
      (b) => /Skab/i.test(b.textContent || b.value || ""),
    ),
  };
});

// Category create form if reachable
await page.goto(`${base}/admin/categories/create`, { waitUntil: "domcontentloaded" });
const categoryCreate = await page.evaluate(() => {
  return {
    url: location.pathname,
    statusOk: !/404|not found/i.test(document.body.innerText || ""),
    fields: [...document.querySelectorAll("input,select,textarea")].map((el) => ({
      name: el.name || null,
      id: el.id || null,
      type: el.type || el.tagName,
      checked: el.type === "checkbox" ? el.checked : undefined,
    })),
    submitTexts: [...document.querySelectorAll("button,input[type=submit]")]
      .map((b) => (b.textContent || b.value || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  };
});

const publicVisibilityRisk =
  createForm.activeChecked === true
    ? "CANARY_PUBLIC_VISIBILITY_RISK"
    : null;

const report = {
  targetLock,
  baseline: {
    productCount: products.rowCount,
    productNames: products.names,
    categoryCount: categories.rowCount,
    categoryNames: categories.names,
    emptyProducts: products.rowCount === 0,
    baselineChanged: products.rowCount !== 0,
  },
  createFormActiveDefault: createForm,
  categoryCreate,
  publicVisibilityRisk,
  decision:
    !targetLock.pass
      ? "BLOCKED_WRONG_HOST"
      : products.rowCount !== 0
        ? "CANARY_BASELINE_CHANGED"
        : createForm.activeChecked === true
          ? "CANARY_PUBLIC_VISIBILITY_RISK_STOP_BEFORE_WRITE"
          : "SAFE_TO_CONTINUE_INACTIVE_DEFAULT",
};

writeFileSync(join(outDir, "preflight.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outDir, ...report }, null, 2));
await context.close();
await browser.close();
