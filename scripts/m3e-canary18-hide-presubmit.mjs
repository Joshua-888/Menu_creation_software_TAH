/**
 * M3E pre-submit ONLY — Veroni canary 18 HIDE payload inspect.
 * Unchecks #active in the browser form and serializes FormData.
 * NEVER clicks Opdater. NEVER POSTs. NEVER mutates persistence.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serializeSuccessfulControlsInPage } from "../src/tah/adapters/v1/pageScripts.mjs";

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

const base = "https://veronipizza.dk";
const authPath = join(root, "playwright", ".auth", "tah-admin-veroni.json");
const outDir = join(root, "runs", "discovery", `m3e-presubmit-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const CANARY = {
  databaseId: "18",
  menuNumber: "99001",
  name: "__TAH_CANARY_PRODUCT_M3__",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: existsSync(authPath) ? authPath : undefined,
});
const page = await context.newPage();

const mutationLog = [];
page.on("request", (req) => {
  const m = req.method().toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(m)) {
    mutationLog.push(`${m} ${req.url()}`);
  }
});

async function ensureAdmin() {
  await page.goto(`${base}/admin/menu`, { waitUntil: "domcontentloaded" });
  if (/\/login/i.test(page.url())) {
    const email = process.env.TAH_ADMIN_EMAIL;
    const password = process.env.TAH_ADMIN_PASSWORD;
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page
      .locator('input[type="email"], input[name="email"]')
      .first()
      .fill(email);
    await page
      .locator('input[type="password"], input[name="password"]')
      .first()
      .fill(password);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
  }
}

await ensureAdmin();
const host = new URL(page.url()).hostname;
if (host !== "veronipizza.dk") {
  throw new Error(`TARGET_LOCK_FAIL host=${host}`);
}

const list = await page.evaluate(() => {
  return [...document.querySelectorAll("table tbody tr")].map((tr) => {
    const cells = [...tr.querySelectorAll("td")];
    const edit =
      tr
        .querySelector("a[href*='/admin/menu/'][href$='/edit']")
        ?.getAttribute("href") || "";
    const id = /\/admin\/menu\/(\d+)/i.exec(edit)?.[1] || null;
    return {
      databaseId: id,
      menuNumber: (cells[0]?.textContent || "").replace(/\s+/g, " ").trim(),
      name: (tr.querySelector("td span")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim(),
      statusText: (cells[5]?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
});

const row = list.find((r) => r.databaseId === CANARY.databaseId);
if (!row || row.name !== CANARY.name || row.menuNumber !== CANARY.menuNumber) {
  throw new Error(`CANARY_IDENTITY_FAIL ${JSON.stringify(row)}`);
}

const pub = await context.newPage();
await pub.goto(base + "/", { waitUntil: "domcontentloaded" });
const publicText = await pub.locator("body").innerText();
const publicHidden =
  !publicText.includes(CANARY.name) &&
  !publicText.includes(CANARY.menuNumber);
await pub.close();
if (!publicHidden) {
  console.error("STOP: canary became publicly visible");
  process.exit(2);
}

await page.goto(`${base}/admin/menu/18/edit`, {
  waitUntil: "domcontentloaded",
});
const before = await page.evaluate(() => {
  const el = document.querySelector("#active");
  return {
    checked: el?.checked ?? null,
    hasCheckedAttr: el?.hasAttribute("checked") ?? null,
    name: document.querySelector("#name")?.value ?? null,
    menuNumber: document.querySelector("#menu_number")?.value ?? null,
  };
});

if (before.name !== CANARY.name || before.menuNumber !== CANARY.menuNumber) {
  throw new Error(`EDIT_IDENTITY_FAIL ${JSON.stringify(before)}`);
}

const active = page.locator("#active");
if (await active.isChecked()) {
  await active.uncheck();
}
const domUnchecked = !(await active.isChecked());
if (!domUnchecked) {
  throw new Error("Failed to uncheck #active in form draft");
}

const mutGuard = [];
await page.route("**/*", async (route) => {
  const method = route.request().method().toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    mutGuard.push(`${method} ${route.request().url()}`);
    await route.abort("failed");
    return;
  }
  await route.continue();
});

const payload = await page.evaluate(
  serializeSuccessfulControlsInPage,
  "form:has(#menu_number)",
);
await page.unroute("**/*");

const activePresent = Object.prototype.hasOwnProperty.call(
  payload.asObject,
  "active",
);
const activeVal = payload.asObject.active;
const looksInactive =
  !activePresent ||
  !(Array.isArray(activeVal) ? activeVal : [activeVal]).some(
    (v) => v === "1" || String(v).toLowerCase() === "true" || v === "on",
  );

const report = {
  milestone: "M3E_PRESUBMIT_HIDE_ONLY",
  host,
  canary: CANARY,
  listStatus: row.statusText,
  publicHidden,
  beforeEditControl: before,
  afterFormDraft: { activeChecked: false, domUnchecked },
  formDataInspect: {
    method: payload.method,
    action: payload.action,
    activePresent,
    activeValue: activeVal ?? null,
    looksInactive,
    name: payload.asObject.name ?? null,
    menu_number: payload.asObject.menu_number ?? null,
    _method: payload.asObject._method ?? null,
  },
  mutationRequestsDuringInspect: mutGuard,
  pageMutationLog: mutationLog,
  opdaterClicked: false,
  persistenceAssumed: false,
  state: "FORM_MODIFIED",
  nextRequiresExplicitApproval: "EXPLICIT_APPROVED_OPDATER_SUBMIT",
  note: "Stopped before Opdater. Form draft unchecked does NOT prove persisted HIDDEN.",
};

writeFileSync(
  join(outDir, "presubmit-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));

if (mutationLog.length > 0 || mutGuard.length > 0) {
  console.error("UNEXPECTED_MUTATION_REQUESTS", { mutationLog, mutGuard });
  process.exit(3);
}

await browser.close();
