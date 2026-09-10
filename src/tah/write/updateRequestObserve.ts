import type { Page, Request, Response } from "playwright";
import {
  assertSubmitControlInteractable,
  dismissKnownCookieBanner,
} from "./submitInteractability.js";

export type SanitizedUpdateRequestTrace = {
  method: string;
  path: string;
  /** From postData when readable; null when multipart body unavailable (M3G). */
  hasMethodPut: boolean | null;
  descriptionInPayload: string | null;
  activePresent: boolean | null;
  looksActiveTrue: boolean | null;
  contentType: string | null;
  /** True when postData was empty/null — body not used for request matching. */
  postDataUnreadable: boolean;
};

export type SanitizedUpdateResponseTrace = {
  status: number;
  url: string;
  finalUrl: string | null;
  redirected: boolean;
};

const SENSITIVE_RE = /token|csrf|password|cookie|session|_token/i;

/**
 * Network mutation detector for product update.
 *
 * M3H: match POST + pathname /admin/menu/{id} only.
 * Do NOT require readable postData — multipart FormData often yields null/empty
 * postData in Playwright (M3G false-negative root cause).
 *
 * `_method=put` and semantic values are proven via zero-network FormData
 * inspection BEFORE submit, then confirmed by read-back AFTER.
 */
export function isProductUpdateRequest(
  req: Request,
  databaseId: string,
): boolean {
  if (req.method().toUpperCase() !== "POST") return false;
  let pathname: string;
  try {
    pathname = new URL(req.url()).pathname.replace(/\/$/, "") || "/";
  } catch {
    return false;
  }
  return pathname === `/admin/menu/${databaseId}`;
}

export function sanitizeUpdateRequest(req: Request): SanitizedUpdateRequestTrace {
  const raw = req.postData() || "";
  const postDataUnreadable = raw.length === 0;
  const ct =
    req.headers()["content-type"] || req.headers()["Content-Type"] || null;
  const path = (() => {
    try {
      return new URL(req.url()).pathname;
    } catch {
      return req.url();
    }
  })();

  let descriptionInPayload: string | null = null;
  let activePresent: boolean | null = null;
  let looksActiveTrue: boolean | null = null;
  let hasMethodPut: boolean | null = null;

  if (!postDataUnreadable) {
    const descUrl = /(?:^|&)description=([^&]*)/.exec(raw);
    if (descUrl) {
      descriptionInPayload = decodeURIComponent(
        descUrl[1]!.replace(/\+/g, " "),
      );
    } else {
      const descMp =
        /name="description"\r?\n\r?\n([\s\S]*?)(?:\r?\n------|\r?\n--)/i.exec(
          raw,
        );
      if (descMp) descriptionInPayload = descMp[1]!.trim();
    }

    activePresent =
      /(?:^|&)active=/.test(raw) || /name=["']active["']/i.test(raw);
    looksActiveTrue =
      /(?:^|&)active=(1|true|on)(?:&|$)/i.test(raw) ||
      /name=["']active["'][\s\S]{0,80}\r?\n\r?\n\s*(1|true|on)\s*\r?\n/i.test(
        raw,
      );
    hasMethodPut =
      /_method=put/i.test(raw) ||
      (/name=["']_method["']/i.test(raw) && /put/i.test(raw));
  }

  return {
    method: req.method().toUpperCase(),
    path,
    hasMethodPut,
    descriptionInPayload,
    activePresent,
    looksActiveTrue,
    contentType: ct,
    postDataUnreadable,
  };
}

/** Redact sensitive keys from a field map for logging. */
export function redactSensitiveFields(
  fields: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Click Opdater inside the #menu_number update form while waiting for
 * POST /admin/menu/{id} and its response.
 *
 * Uses verified normal Playwright click (scrollIntoViewIfNeeded) — not
 * requestSubmit(), not form.submit(), not force-click by default.
 */
export async function clickOpdaterAndObserveUpdate(input: {
  page: Page;
  databaseId: string;
  timeoutMs?: number;
}): Promise<
  | {
      ok: true;
      request: SanitizedUpdateRequestTrace;
      response: SanitizedUpdateResponseTrace;
    }
  | {
      ok: false;
      code: "UPDATE_REQUEST_NOT_OBSERVED" | "UPDATE_REQUEST_NOT_SENT";
      detail?: string;
    }
> {
  const { page, databaseId } = input;
  const timeout = input.timeoutMs ?? 20_000;
  const form = page.locator("form:has(#menu_number)");
  const button = form.getByRole("button", { name: /^Opdater$/i });

  await dismissKnownCookieBanner(page);
  const interact = await assertSubmitControlInteractable(page, button);
  if (!interact.ok) {
    return {
      ok: false,
      code: "UPDATE_REQUEST_NOT_OBSERVED",
      detail: `${interact.code}: ${interact.detail ?? ""}`,
    };
  }

  const requestPromise = page
    .waitForRequest((req) => isProductUpdateRequest(req, databaseId), {
      timeout,
    })
    .catch(() => null);

  const responsePromise = page
    .waitForResponse(
      (res) => isProductUpdateRequest(res.request(), databaseId),
      { timeout },
    )
    .catch(() => null);

  await button.click({ timeout: 10_000 });

  const req = await requestPromise;
  if (!req) {
    return { ok: false, code: "UPDATE_REQUEST_NOT_OBSERVED" };
  }
  const res = (await responsePromise) as Response | null;
  const request = sanitizeUpdateRequest(req);
  const response: SanitizedUpdateResponseTrace = {
    status: res?.status() ?? -1,
    url: res?.url() ?? "",
    finalUrl: page.url(),
    redirected: Boolean(res && res.status() >= 300 && res.status() < 400),
  };
  return { ok: true, request, response };
}

export function classifyUpdateOutcome(input: {
  requestObserved: boolean;
  responseStatus: number;
  descriptionExpected: string;
  descriptionActual: string | null;
  validationMessages: string[];
}):
  | { code: "OK" }
  | {
      code:
        | "UPDATE_REQUEST_NOT_SENT"
        | "UPDATE_REQUEST_NOT_OBSERVED"
        | "ADMIN_VALIDATION_ERROR"
        | "UPDATE_RESPONSE_ERROR"
        | "READBACK_MISMATCH";
    } {
  if (!input.requestObserved) return { code: "UPDATE_REQUEST_NOT_OBSERVED" };
  if (input.validationMessages.length > 0) {
    return { code: "ADMIN_VALIDATION_ERROR" };
  }
  if (input.responseStatus >= 400) return { code: "UPDATE_RESPONSE_ERROR" };
  if (input.descriptionActual !== input.descriptionExpected) {
    return { code: "READBACK_MISMATCH" };
  }
  return { code: "OK" };
}
