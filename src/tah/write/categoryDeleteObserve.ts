/**
 * Observe / execute category DELETE via admin edit form.
 * Contract: POST /admin/categories/{databaseId} with _method=delete + CSRF.
 * Success is NEVER assumed from HTTP alone — caller must listCategories read-back.
 */
import type { Page } from "playwright";
import { dismissKnownCookieBanner } from "./submitInteractability.js";

export type CategoryDeleteFormInfo = {
  actionUrl: string;
  requestPath: string;
  methodOverride: string;
  tokenPresent: boolean;
  sletPresent: boolean;
};

export type CategoryDeleteRequestResult = {
  status: number;
  finalUrl: string;
  requestPath: string;
  methodOverride: string;
};

export function isCategoryDeletePath(
  pathname: string,
  databaseId: string,
): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  return p === `/admin/categories/${databaseId}`;
}

/**
 * Read delete form fields from /admin/categories/{id}/edit (no submit).
 */
export async function observeCategoryDeleteForm(input: {
  page: Page;
  baseUrl: string;
  databaseId: string;
}): Promise<CategoryDeleteFormInfo | null> {
  const { page, baseUrl, databaseId } = input;
  const editUrl = new URL(
    `/admin/categories/${databaseId}/edit`,
    baseUrl,
  ).toString();
  await page.goto(editUrl, { waitUntil: "domcontentloaded" });
  await dismissKnownCookieBanner(page);

  const info = await page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const del = forms.find((f) => {
      const method = (
        f.querySelector('input[name="_method"]') as HTMLInputElement | null
      )?.value;
      const hasSlet = [...f.querySelectorAll("button")].some((b) =>
        /^slet$/i.test((b.textContent || "").trim()),
      );
      return /^delete$/i.test(method || "") && hasSlet;
    });
    if (!del) return null;
    const token = (
      del.querySelector('input[name="_token"]') as HTMLInputElement | null
    )?.value;
    const method = (
      del.querySelector('input[name="_method"]') as HTMLInputElement | null
    )?.value;
    const action = del.getAttribute("action") || "";
    return {
      action,
      method: method || "delete",
      tokenPresent: Boolean(token),
      token: token || "",
      sletPresent: true,
    };
  });

  if (!info) return null;
  const actionUrl = info.action.startsWith("http")
    ? info.action
    : new URL(info.action, baseUrl).toString();
  let requestPath = "";
  try {
    requestPath = new URL(actionUrl).pathname;
  } catch {
    requestPath = info.action;
  }
  return {
    actionUrl,
    requestPath,
    methodOverride: info.method,
    tokenPresent: info.tokenPresent,
    sletPresent: info.sletPresent,
  };
}

/**
 * Submit category delete using CSRF token from the delete form.
 * Does not interpret success — caller must read-back listCategories.
 */
export async function postCategoryDelete(input: {
  page: Page;
  baseUrl: string;
  databaseId: string;
}): Promise<CategoryDeleteRequestResult> {
  const { page, baseUrl, databaseId } = input;
  const editUrl = new URL(
    `/admin/categories/${databaseId}/edit`,
    baseUrl,
  ).toString();
  await page.goto(editUrl, { waitUntil: "domcontentloaded" });
  await dismissKnownCookieBanner(page);

  const formInfo = await page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const del = forms.find((f) => {
      const method = (
        f.querySelector('input[name="_method"]') as HTMLInputElement | null
      )?.value;
      const hasSlet = [...f.querySelectorAll("button")].some((b) =>
        /^slet$/i.test((b.textContent || "").trim()),
      );
      return /^delete$/i.test(method || "") && hasSlet;
    });
    if (!del) return null;
    return {
      token: (
        del.querySelector('input[name="_token"]') as HTMLInputElement | null
      )?.value,
      method: (
        del.querySelector('input[name="_method"]') as HTMLInputElement | null
      )?.value,
      action: del.getAttribute("action") || "",
    };
  });

  if (!formInfo?.token || !formInfo.action) {
    throw new Error("ADMIN_WRITE_BLOCKED: category delete form fields missing");
  }

  const actionUrl = formInfo.action.startsWith("http")
    ? formInfo.action
    : new URL(formInfo.action, baseUrl).toString();

  const res = await page.request.post(actionUrl, {
    form: {
      _token: formInfo.token,
      _method: formInfo.method || "delete",
    },
    headers: { Referer: editUrl },
    maxRedirects: 5,
  });

  let requestPath = "";
  try {
    requestPath = new URL(actionUrl).pathname;
  } catch {
    requestPath = formInfo.action;
  }

  return {
    status: res.status(),
    finalUrl: res.url(),
    requestPath,
    methodOverride: formInfo.method || "delete",
  };
}

/**
 * Idempotent delete outcome from read-back (never blind-retry).
 */
export function interpretCategoryDeleteReadBack(input: {
  databaseId: string;
  categoriesAfter: Array<{ databaseId: string }>;
  responseStatus: number;
}): "VERIFIED_DELETED" | "DELETE_FAILED" | "AMBIGUOUS" {
  const absent = !input.categoriesAfter.some(
    (c) => c.databaseId === input.databaseId,
  );
  if (absent) return "VERIFIED_DELETED";
  if (input.responseStatus >= 400) return "AMBIGUOUS";
  return "DELETE_FAILED";
}
