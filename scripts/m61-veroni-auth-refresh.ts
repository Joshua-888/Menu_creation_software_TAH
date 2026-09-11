/**
 * M6.1 — Refresh Veroni Playwright auth + READ-ONLY admin verification.
 * Uses TAH_ADMIN_EMAIL / TAH_ADMIN_PASSWORD from env/.env (never hardcoded).
 * Falls back to headed manual login if credential login fails.
 * Does not create/update/delete/publish.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

function loadEnv(p: string): void {
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

const HOST = "veronipizza.dk";
const BASE_URL = `https://${HOST}`;
const AUTH = resolve("playwright/.auth/tah-admin-veroni.json");
const OUT = resolve("runs/m61-veroni-live");

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

async function dismissCookies(page: Page): Promise<void> {
  const cookie = page.getByRole("button", { name: /allow cookies/i });
  if ((await cookie.count()) > 0) {
    await cookie.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function credentialLogin(page: Page): Promise<boolean> {
  const email = process.env.TAH_ADMIN_EMAIL?.trim();
  const password = process.env.TAH_ADMIN_PASSWORD?.trim();
  if (!email || !password) return false;
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await dismissCookies(page);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);
  return !/\/login/i.test(page.url());
}

async function headedManualLogin(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  console.log(
    "Opening headed browser for manual Veroni admin login. Complete login, then return here.",
  );
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await dismissCookies(page);
  console.log("Waiting up to 5 minutes for navigation away from /login ...");
  await page.waitForURL((url) => !/\/login/i.test(url.pathname), {
    timeout: 5 * 60_000,
  });
  await page.waitForTimeout(1000);
  return { browser, context, page };
}

async function verifyAdminPages(page: Page): Promise<{
  menuOk: boolean;
  categoriesOk: boolean;
  menuUrl: string;
  categoriesUrl: string;
}> {
  await page.goto(`${BASE_URL}/admin/menu`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const menuUrl = page.url();
  const menuOk = /\/admin\/menu/i.test(menuUrl) && !/\/login/i.test(menuUrl);

  await page.goto(`${BASE_URL}/admin/categories`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(800);
  const categoriesUrl = page.url();
  const categoriesOk =
    /\/admin\/categor/i.test(categoriesUrl) && !/\/login/i.test(categoriesUrl);

  return { menuOk, categoriesOk, menuUrl, categoriesUrl };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(dirname(AUTH), { recursive: true });

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let authMethod: "env_credentials" | "headed_manual" | "existing_storage" =
    "existing_storage";
  let authRefreshed = false;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext(
      existsSync(AUTH) ? { storageState: AUTH } : {},
    );
    page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/menu`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    if (/\/login/i.test(page.url())) {
      const ok = await credentialLogin(page);
      if (ok) {
        authMethod = "env_credentials";
        authRefreshed = true;
      } else {
        await browser.close();
        browser = null;
        const headed = await headedManualLogin();
        browser = headed.browser;
        context = headed.context;
        page = headed.page;
        authMethod = "headed_manual";
        authRefreshed = true;
      }
      await context.storageState({ path: AUTH });
    } else {
      // Re-save storage to refresh timestamps / cookies while session still valid
      await context.storageState({ path: AUTH });
      authRefreshed = true;
      authMethod = "existing_storage";
    }

    const pages = await verifyAdminPages(page);
    if (!pages.menuOk || !pages.categoriesOk) {
      // One more credential attempt if verification failed
      const ok = await credentialLogin(page);
      if (ok) {
        authMethod = "env_credentials";
        authRefreshed = true;
        await context.storageState({ path: AUTH });
      } else if (authMethod !== "headed_manual") {
        await browser.close();
        const headed = await headedManualLogin();
        browser = headed.browser;
        context = headed.context;
        page = headed.page;
        authMethod = "headed_manual";
        authRefreshed = true;
        await context.storageState({ path: AUTH });
      }
    }

    const verified = await verifyAdminPages(page!);
    const report = {
      title: "M6.1 AUTH REFRESH",
      host: HOST,
      authPath: AUTH,
      authRefreshed,
      authMethod,
      adminAuthenticated: verified.menuOk && verified.categoriesOk,
      verified,
      readOnly: true,
      mutated: false,
      at: new Date().toISOString(),
    };
    writeJson(resolve(OUT, "auth-refresh.json"), report);
    console.log(JSON.stringify(report, null, 2));

    if (!report.adminAuthenticated) {
      console.error("STOP: admin pages not authenticated after refresh");
      process.exit(2);
    }
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
