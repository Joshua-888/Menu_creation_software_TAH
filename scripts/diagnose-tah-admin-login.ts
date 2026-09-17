/**
 * READ-ONLY TAH admin login diagnosis.
 * Never prints credentials, cookie values, or authorization headers.
 *
 * Usage: npx tsx scripts/diagnose-tah-admin-login.ts [host]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { loginTahAdmin } from "../src/portal/adminLogin.js";
import { normalizeDestinationHost } from "../src/tah/write/hostAllowlist.js";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(join(process.cwd(), ".env"));

const host = normalizeDestinationHost(process.argv[2] || "bellakebab.dk");
const emailSet = Boolean(process.env.TAH_ADMIN_EMAIL?.trim());
const passwordSet = Boolean(process.env.TAH_ADMIN_PASSWORD?.trim());
if (!emailSet || !passwordSet) {
  console.log(
    JSON.stringify(
      {
        classification: "UNKNOWN_LOGIN_FAILURE",
        error: "TAH_ADMIN_EMAIL / TAH_ADMIN_PASSWORD not set",
        emailConfigured: emailSet,
        passwordConfigured: passwordSet,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const email = process.env.TAH_ADMIN_EMAIL!.trim();
const password = process.env.TAH_ADMIN_PASSWORD!.trim();
const baseUrl = `https://${host}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  const diag = await loginTahAdmin({ page, baseUrl, email, password });
  const report = {
    classification: diag.classification,
    LOGIN_OK: diag.classification === "LOGIN_OK",
    initialUrl: diag.initialUrl,
    finalUrl: diag.finalUrl,
    pageTitle: diag.pageTitle,
    formAction: diag.form.action,
    formMethod: diag.form.method,
    formHasEmail: diag.form.hasEmailField,
    formHasPassword: diag.form.hasPasswordField,
    formHasLoginButton: diag.form.hasLoginButton,
    emailInputType: diag.form.emailInputType,
    cookieBannerBlocked: diag.cookieBannerBlocked,
    passwordInputVisible: diag.passwordInputVisible,
    adminEvidence: diag.adminEvidence,
    visibleErrorText: diag.visibleErrorText,
    cookieNames: diag.cookieNames,
    loginPostStatus: diag.loginPostStatus,
    redirects: diag.redirects,
    navigation: diag.navigation,
    emailConfigured: true,
    passwordConfigured: true,
  };
  console.log(JSON.stringify(report, null, 2));
  if (diag.classification === "CREDENTIALS_REJECTED") {
    console.error("HUMAN_ACTION_REQUIRED = VERIFY_TAH_ADMIN_CREDENTIALS");
    process.exit(2);
  }
  process.exit(diag.classification === "LOGIN_OK" ? 0 : 1);
} finally {
  await browser?.close().catch(() => undefined);
}
