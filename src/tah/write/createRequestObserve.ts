import type { Page, Request, Response } from "playwright";
import {
  assertSubmitControlInteractable,
  dismissKnownCookieBanner,
} from "./submitInteractability.js";

export type SanitizedCreateRequestTrace = {
  method: string;
  path: string;
  contentType: string | null;
  postDataUnreadable: boolean;
};

export type SanitizedCreateResponseTrace = {
  status: number;
  url: string;
  finalUrl: string | null;
  redirected: boolean;
};

/**
 * Detect product CREATE mutation: POST /admin/menu (not /admin/menu/{id}).
 * Do not require readable postData (multipart-safe, same lesson as M3G/M3H).
 */
export function isProductCreateRequest(req: Request): boolean {
  if (req.method().toUpperCase() !== "POST") return false;
  let pathname: string;
  try {
    pathname = new URL(req.url()).pathname.replace(/\/$/, "") || "/";
  } catch {
    return false;
  }
  return pathname === "/admin/menu";
}

export function sanitizeCreateRequest(req: Request): SanitizedCreateRequestTrace {
  const raw = req.postData() || "";
  const path = (() => {
    try {
      return new URL(req.url()).pathname;
    } catch {
      return req.url();
    }
  })();
  return {
    method: req.method().toUpperCase(),
    path,
    contentType:
      req.headers()["content-type"] || req.headers()["Content-Type"] || null,
    postDataUnreadable: raw.length === 0,
  };
}

/**
 * One normal Playwright Skab click inside the create form.
 * Verifies interactability (no force-click). Observes POST /admin/menu.
 */
export async function clickSkabAndObserveCreate(input: {
  page: Page;
  timeoutMs?: number;
}): Promise<
  | {
      ok: true;
      request: SanitizedCreateRequestTrace;
      response: SanitizedCreateResponseTrace;
      interactability: { cookieBannerDismissed: boolean };
    }
  | {
      ok: false;
      code:
        | "CREATE_REQUEST_NOT_OBSERVED"
        | "SUBMIT_CONTROL_BLOCKED_BY_OVERLAY"
        | "SUBMIT_CONTROL_NOT_INTERACTABLE";
      detail?: string;
    }
> {
  const { page } = input;
  const timeout = input.timeoutMs ?? 25_000;

  await dismissKnownCookieBanner(page);

  const form = page.locator("form:has(#menu_number)");
  const button = form.getByRole("button", { name: /^Skab$/i });
  const interact = await assertSubmitControlInteractable(page, button);
  if (!interact.ok) {
    return {
      ok: false,
      code: interact.code,
      ...(interact.detail ? { detail: interact.detail } : {}),
    };
  }

  const requestPromise = page
    .waitForRequest((req) => isProductCreateRequest(req), { timeout })
    .catch(() => null);
  const responsePromise = page
    .waitForResponse((res) => isProductCreateRequest(res.request()), {
      timeout,
    })
    .catch(() => null);

  await button.click({ timeout: 10_000 });

  const req = await requestPromise;
  if (!req) {
    return { ok: false, code: "CREATE_REQUEST_NOT_OBSERVED" };
  }
  const res = (await responsePromise) as Response | null;
  return {
    ok: true,
    request: sanitizeCreateRequest(req),
    response: {
      status: res?.status() ?? -1,
      url: res?.url() ?? "",
      finalUrl: page.url(),
      redirected: Boolean(res && res.status() >= 300 && res.status() < 400),
    },
    interactability: {
      cookieBannerDismissed: interact.cookieBannerDismissed,
    },
  };
}
