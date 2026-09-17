/**
 * Generic TAH admin login + classified diagnostics.
 * Never logs credentials, cookie values, or authorization headers.
 */

import type { Page, Response } from "playwright";
import { assertSubmitControlInteractable, dismissKnownCookieBanner } from "../tah/write/submitInteractability.js";
import { assertAllowlistedAdminHost } from "../tah/write/targetLock.js";
import { normalizeDestinationHost } from "../tah/write/hostAllowlist.js";

export type LoginClassification =
  | "LOGIN_OK"
  | "CREDENTIALS_REJECTED"
  | "LOGIN_FORM_CONTRACT_CHANGED"
  | "COOKIE_OR_OVERLAY_BLOCKED"
  | "REDIRECT_OR_SESSION_FAILURE"
  | "NETWORK_OR_TLS_FAILURE"
  | "UNKNOWN_LOGIN_FAILURE";

export type LoginFormContract = {
  action: string | null;
  method: string | null;
  hasEmailField: boolean;
  hasPasswordField: boolean;
  hasLoginButton: boolean;
  emailInputType: string | null;
  passwordInputType: string | null;
};

export type LoginDiagnostic = {
  classification: LoginClassification;
  initialUrl: string;
  finalUrl: string;
  pageTitle: string;
  form: LoginFormContract;
  cookieBannerBlocked: boolean;
  passwordInputVisible: boolean;
  adminEvidence: boolean;
  visibleErrorText: string | null;
  cookieNames: string[];
  loginPostStatus: number | null;
  navigation: Array<{
    method: string;
    status: number | null;
    url: string;
  }>;
  redirects: string[];
};

const CREDENTIAL_ERROR_RE =
  /\b(invalid|incorrect|unauthorized|unauthorised|wrong\s+password|invalid\s+email|forkert|ugyldig|adgangskode|credentials?)\b/i;

const ADMIN_EVIDENCE_RE = /\/admin(\/|$)/i;

const EMPTY_FORM: LoginFormContract = {
  action: null,
  method: null,
  hasEmailField: false,
  hasPasswordField: false,
  hasLoginButton: false,
  emailInputType: null,
  passwordInputType: null,
};

export function classifyLoginOutcome(input: {
  finalUrl: string;
  passwordVisible: boolean;
  adminEvidence: boolean;
  visibleError: string | null;
  cookieBlocked: boolean;
  networkFailure: boolean;
  formContractOk: boolean;
  sawAdminNavigation: boolean;
  loginPostStatus?: number | null;
}): LoginClassification {
  const onLogin = /\/login(\/|$|\?)/i.test(input.finalUrl);
  const onAdmin = ADMIN_EVIDENCE_RE.test(input.finalUrl);
  if ((input.adminEvidence || onAdmin) && !input.passwordVisible) {
    return "LOGIN_OK";
  }
  if (input.cookieBlocked) return "COOKIE_OR_OVERLAY_BLOCKED";
  if (input.networkFailure) return "NETWORK_OR_TLS_FAILURE";
  if (!input.formContractOk) return "LOGIN_FORM_CONTRACT_CHANGED";
  if (input.loginPostStatus === 419) return "REDIRECT_OR_SESSION_FAILURE";
  if (
    input.loginPostStatus === 401 ||
    input.loginPostStatus === 403 ||
    input.loginPostStatus === 422
  ) {
    return "CREDENTIALS_REJECTED";
  }
  if (input.visibleError && CREDENTIAL_ERROR_RE.test(input.visibleError)) {
    return "CREDENTIALS_REJECTED";
  }
  if (input.sawAdminNavigation && onLogin && input.passwordVisible) {
    return "REDIRECT_OR_SESSION_FAILURE";
  }
  if (onLogin && input.passwordVisible) {
    return "UNKNOWN_LOGIN_FAILURE";
  }
  if (!onLogin && !onAdmin && !input.passwordVisible) {
    return "REDIRECT_OR_SESSION_FAILURE";
  }
  return "UNKNOWN_LOGIN_FAILURE";
}

export function sanitizeNavUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return raw.split("?")[0] ?? raw;
  }
}

function cookieNamesFromHeader(header: string | undefined): string[] {
  if (!header) return [];
  const names: string[] = [];
  for (const part of header.split(/,(?=[^ ;]+=)/)) {
    const name = part.trim().split("=")[0]?.trim();
    if (name) names.push(name);
  }
  return names;
}

async function readFormContract(page: Page): Promise<LoginFormContract> {
  return page.evaluate(() => {
    const form = document.querySelector("form");
    const labeledEmail = Array.from(document.querySelectorAll("label")).find(
      (l) => /^email$/i.test(l.textContent?.trim() ?? ""),
    );
    const labeledFor = labeledEmail?.getAttribute("for");
    const email =
      document.querySelector<HTMLInputElement>('input[type="email"]') ??
      document.querySelector<HTMLInputElement>('input[name="email"]') ??
      (labeledFor
        ? document.querySelector<HTMLInputElement>(`#${CSS.escape(labeledFor)}`)
        : null) ??
      document.querySelector<HTMLInputElement>(
        'input[autocomplete="username"], input[autocomplete="email"]',
      );
    const password = document.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    const loginBtn =
      form?.querySelector<HTMLButtonElement>(
        'button[type="submit"], input[type="submit"]',
      ) ??
      Array.from(document.querySelectorAll("button")).find((b) =>
        /^(login|log ind)$/i.test(b.textContent?.trim() ?? ""),
      );
    return {
      action: form?.getAttribute("action") ?? null,
      method: (form?.getAttribute("method") ?? "get").toLowerCase(),
      hasEmailField: Boolean(email),
      hasPasswordField: Boolean(password),
      hasLoginButton: Boolean(loginBtn),
      emailInputType: email?.type ?? null,
      passwordInputType: password?.type ?? null,
    };
  });
}

async function visibleLoginError(page: Page): Promise<string | null> {
  const candidates = [
    page.locator(".alert, .error, .invalid-feedback, [role='alert']"),
    page.getByText(
      /invalid|incorrect|unauthorized|forkert|ugyldig|adgangskode/i,
    ),
  ];
  for (const loc of candidates) {
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 6); i += 1) {
      const text = (await loc.nth(i).innerText().catch(() => "")).trim();
      if (text && text.length <= 240) return text.slice(0, 240);
    }
  }
  return null;
}

async function cookieBannerVisible(page: Page): Promise<boolean> {
  return page
    .locator(".js-cookie-consent, .cookie-consent, [class*='cookie-consent']")
    .first()
    .isVisible()
    .catch(() => false);
}

export async function collectAdminEvidence(page: Page): Promise<boolean> {
  const url = page.url();
  if (!ADMIN_EVIDENCE_RE.test(url)) return false;
  const passwordVisible =
    (await page.locator('input[type="password"]').count()) > 0 &&
    (await page
      .locator('input[type="password"]')
      .first()
      .isVisible()
      .catch(() => false));
  if (passwordVisible) return false;
  const adminLink = await page
    .locator(
      'a[href*="/admin/menu"], a[href="/admin"], a[href*="/admin/categories"]',
    )
    .count()
    .catch(() => 0);
  return adminLink > 0 || /\/admin\/menu/i.test(url);
}

export async function loginTahAdmin(input: {
  page: Page;
  baseUrl: string;
  email: string;
  password: string;
}): Promise<LoginDiagnostic> {
  const expectedHost = normalizeDestinationHost(input.baseUrl);
  const loginUrl = `${input.baseUrl.replace(/\/$/, "")}/login`;
  const navigation: LoginDiagnostic["navigation"] = [];
  const redirects: string[] = [];
  const setCookieNames = new Set<string>();
  let networkFailure = false;
  let sawAdminNavigation = false;
  let loginPostStatus: number | null = null;

  const onResponse = (res: Response) => {
    const url = sanitizeNavUrl(res.url());
    const method = res.request().method();
    const type = res.request().resourceType();
    if (
      type === "document" ||
      type === "xhr" ||
      type === "fetch" ||
      /\/login|\/admin/i.test(url)
    ) {
      navigation.push({ method, status: res.status(), url });
    }
    if (method === "POST" && /\/login(\/|$|\?)/i.test(url)) {
      loginPostStatus = res.status();
    }
    if (ADMIN_EVIDENCE_RE.test(url)) sawAdminNavigation = true;
    if (res.status() >= 300 && res.status() < 400) {
      const loc = res.headers()["location"];
      if (loc) redirects.push(sanitizeNavUrl(loc));
    }
    for (const name of cookieNamesFromHeader(res.headers()["set-cookie"])) {
      setCookieNames.add(name);
    }
  };
  input.page.on("response", onResponse);

  const finish = async (
    partial: Omit<
      LoginDiagnostic,
      "cookieNames" | "navigation" | "redirects" | "loginPostStatus"
    >,
  ): Promise<LoginDiagnostic> => {
    const contextCookieNames = (
      await input.page.context().cookies().catch(() => [])
    )
      .map((c) => c.name)
      .filter(Boolean);
    return {
      ...partial,
      loginPostStatus,
      cookieNames: [...new Set([...setCookieNames, ...contextCookieNames])],
      navigation: navigation.slice(-24),
      redirects,
    };
  };

  try {
    try {
      await input.page.goto(loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    } catch (err) {
      networkFailure = true;
      const msg = err instanceof Error ? err.message : String(err);
      if (/ERR_|TLS|net::/i.test(msg)) {
        return finish({
          classification: "NETWORK_OR_TLS_FAILURE",
          initialUrl: loginUrl,
          finalUrl: input.page.url(),
          pageTitle: "",
          form: EMPTY_FORM,
          cookieBannerBlocked: false,
          passwordInputVisible: false,
          adminEvidence: false,
          visibleErrorText: null,
        });
      }
      throw err;
    }

    const initialUrl = input.page.url();
    await dismissKnownCookieBanner(input.page);
    const cookieBlocked = await cookieBannerVisible(input.page);
    const form = await readFormContract(input.page);
    const formContractOk =
      form.hasEmailField && form.hasPasswordField && form.hasLoginButton;

    if (cookieBlocked) {
      return finish({
        classification: "COOKIE_OR_OVERLAY_BLOCKED",
        initialUrl,
        finalUrl: input.page.url(),
        pageTitle: await input.page.title().catch(() => ""),
        form,
        cookieBannerBlocked: true,
        passwordInputVisible: true,
        adminEvidence: false,
        visibleErrorText: null,
      });
    }

    if (!formContractOk) {
      return finish({
        classification: "LOGIN_FORM_CONTRACT_CHANGED",
        initialUrl,
        finalUrl: input.page.url(),
        pageTitle: await input.page.title().catch(() => ""),
        form,
        cookieBannerBlocked: false,
        passwordInputVisible: form.hasPasswordField,
        adminEvidence: false,
        visibleErrorText: null,
      });
    }

    await input.page
      .locator('input[name="_token"], input[name="csrf_token"]')
      .first()
      .waitFor({ state: "attached", timeout: 5_000 })
      .catch(() => undefined);

    const emailField = input.page.getByLabel(/^email$/i).first();
    if ((await emailField.count()) > 0) {
      await emailField.fill(input.email, { timeout: 30_000 });
    } else {
      await input.page
        .locator(
          'input[type="email"], input[name="email"], input[autocomplete="username"]',
        )
        .first()
        .fill(input.email, { timeout: 30_000 });
    }
    await input.page
      .locator('input[type="password"]')
      .first()
      .fill(input.password, { timeout: 30_000 });
    await dismissKnownCookieBanner(input.page);

    const loginButton = input.page
      .locator("form")
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Log ind")',
      )
      .first();
    const loginByRole = input.page.getByRole("button", {
      name: /^(login|log ind)$/i,
    });
    const submit = (await loginButton.count()) > 0 ? loginButton : loginByRole;
    const interactable = await assertSubmitControlInteractable(
      input.page,
      submit,
    );
    if (!interactable.ok) {
      return finish({
        classification: "COOKIE_OR_OVERLAY_BLOCKED",
        initialUrl,
        finalUrl: input.page.url(),
        pageTitle: await input.page.title().catch(() => ""),
        form,
        cookieBannerBlocked: true,
        passwordInputVisible: true,
        adminEvidence: false,
        visibleErrorText: interactable.code,
      });
    }

    const postWait = input.page
      .waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          /\/login(\/|$|\?)/i.test(res.url()),
        { timeout: 45_000 },
      )
      .catch(() => null);
    await submit.click();
    const post = await postWait;
    if (post) loginPostStatus = post.status();

    await Promise.race([
      input.page.waitForURL(ADMIN_EVIDENCE_RE, { timeout: 45_000 }),
      input.page
        .locator('input[type="password"]')
        .first()
        .waitFor({ state: "hidden", timeout: 45_000 }),
    ]).catch(() => undefined);
    await dismissKnownCookieBanner(input.page);

    const finalUrl = input.page.url();
    const passwordInputVisible =
      (await input.page.locator('input[type="password"]').count()) > 0 &&
      (await input.page
        .locator('input[type="password"]')
        .first()
        .isVisible()
        .catch(() => false));
    const adminEvidence = await collectAdminEvidence(input.page);
    const visibleErrorText = await visibleLoginError(input.page);
    const classification = classifyLoginOutcome({
      finalUrl,
      passwordVisible: passwordInputVisible,
      adminEvidence,
      visibleError: visibleErrorText,
      cookieBlocked: false,
      networkFailure,
      formContractOk,
      sawAdminNavigation,
      loginPostStatus,
    });

    if (classification === "LOGIN_OK") {
      const lock = assertAllowlistedAdminHost({
        pageUrl: finalUrl,
        expectedHost,
      });
      if (!lock.ok) {
        throw new Error(
          `DESTINATION_HOST_MISMATCH: expected ${expectedHost} (${lock.reason})`,
        );
      }
    }

    return finish({
      classification,
      initialUrl,
      finalUrl,
      pageTitle: await input.page.title().catch(() => ""),
      form,
      cookieBannerBlocked: false,
      passwordInputVisible,
      adminEvidence,
      visibleErrorText,
    });
  } finally {
    input.page.off("response", onResponse);
  }
}

export function loginDiagnosticError(diag: LoginDiagnostic): string {
  return `admin login ${diag.classification} host=${sanitizeNavUrl(diag.finalUrl)} passwordVisible=${diag.passwordInputVisible} adminEvidence=${diag.adminEvidence} error=${diag.visibleErrorText ?? "none"}`;
}
