import type { Page, Request, Response } from "playwright";
import {
  assertSubmitControlInteractable,
  dismissKnownCookieBanner,
} from "./submitInteractability.js";

export type SanitizedCategoryCreateRequestTrace = {
  method: string;
  path: string;
  contentType: string | null;
  postDataUnreadable: boolean;
};

export type SanitizedCategoryCreateResponseTrace = {
  status: number;
  url: string;
  finalUrl: string | null;
  redirected: boolean;
};

/** Detect category CREATE: POST /admin/categories (not /admin/categories/{id}). */
export function isCategoryCreateRequest(req: Request): boolean {
  if (req.method().toUpperCase() !== "POST") return false;
  let pathname: string;
  try {
    pathname = new URL(req.url()).pathname.replace(/\/$/, "") || "/";
  } catch {
    return false;
  }
  return pathname === "/admin/categories";
}

export function sanitizeCategoryCreateRequest(
  req: Request,
): SanitizedCategoryCreateRequestTrace {
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
 * Fill category create form (#name, optional #order) and click Skab.
 * Observes POST /admin/categories. No force-click.
 */
export async function clickSkabAndObserveCategoryCreate(input: {
  page: Page;
  name: string;
  order?: number;
  timeoutMs?: number;
}): Promise<
  | {
      ok: true;
      request: SanitizedCategoryCreateRequestTrace;
      response: SanitizedCategoryCreateResponseTrace;
      interactability: { cookieBannerDismissed: boolean };
    }
  | {
      ok: false;
      code:
        | "CREATE_REQUEST_NOT_OBSERVED"
        | "SUBMIT_CONTROL_BLOCKED_BY_OVERLAY"
        | "SUBMIT_CONTROL_NOT_INTERACTABLE"
        | "NAME_FIELD_MISSING";
      detail?: string;
    }
> {
  const { page, name } = input;
  const timeout = input.timeoutMs ?? 25_000;

  await dismissKnownCookieBanner(page);
  // Second pass — banner text can remount after navigation
  await dismissKnownCookieBanner(page);

  const nameField = page.locator("#name").first();
  if ((await nameField.count()) === 0) {
    return { ok: false, code: "NAME_FIELD_MISSING" };
  }
  await nameField.fill(name);
  {
    const orderField = page.locator("#order").first();
    if ((await orderField.count()) > 0) {
      // Veroni admin constrains order to min=1 max=500; out-of-range blocks submit.
      const raw = input.order ?? 10;
      const clamped = Math.min(500, Math.max(1, Math.trunc(raw)));
      await orderField.fill(String(clamped));
      // Blur so HTML5 validity updates before submit.
      await orderField.blur().catch(() => undefined);
    }
  }
  await nameField.blur().catch(() => undefined);

  const form = page
    .locator('form[action$="/admin/categories"], form[action*="/admin/categories"]')
    .filter({ has: page.locator("#name") })
    .first();
  const button = form.locator('button[type="submit"], button:has-text("Skab")').first();
  const interact = await assertSubmitControlInteractable(page, button);
  if (!interact.ok) {
    return {
      ok: false,
      code: interact.code,
      ...(interact.detail ? { detail: interact.detail } : {}),
    };
  }

  const seenPosts: string[] = [];
  const onReq = (req: Request) => {
    if (req.method().toUpperCase() === "POST") {
      try {
        seenPosts.push(new URL(req.url()).pathname);
      } catch {
        seenPosts.push(req.url());
      }
    }
  };
  page.on("request", onReq);

  const requestPromise = page
    .waitForRequest((req) => isCategoryCreateRequest(req), { timeout })
    .catch(() => null);
  const responsePromise = page
    .waitForResponse((res) => isCategoryCreateRequest(res.request()), {
      timeout,
    })
    .catch(() => null);

  // Prefer native requestSubmit after overlay check — still not force-click.
  await form.evaluate((el) => {
    const f = el as HTMLFormElement;
    if (typeof f.requestSubmit === "function") f.requestSubmit();
    else f.submit();
  });

  const req = await requestPromise;
  const res = await responsePromise;
  page.off("request", onReq);
  if (!req) {
    return {
      ok: false,
      code: "CREATE_REQUEST_NOT_OBSERVED",
      detail: `posts_seen=${seenPosts.join(",") || "none"}`,
    };
  }

  const response: SanitizedCategoryCreateResponseTrace = {
    status: res?.status() ?? 0,
    url: res?.url() ?? "",
    finalUrl: page.url(),
    redirected: Boolean(res && res.status() >= 300 && res.status() < 400),
  };

  return {
    ok: true,
    request: sanitizeCategoryCreateRequest(req),
    response,
    interactability: {
      cookieBannerDismissed: interact.cookieBannerDismissed ?? false,
    },
  };
}

export function isTahCanaryCategoryName(name: string): boolean {
  return /^__TAH_CANARY_/i.test(name.trim());
}
