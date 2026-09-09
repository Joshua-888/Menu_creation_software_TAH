/**
 * Sanitize and validate intercepted product CREATE form payloads.
 * Supports application/x-www-form-urlencoded and multipart/form-data.
 * Never keep CSRF/tokens/cookies.
 */

export type SanitizedCreatePayload = {
  method: string;
  path: string;
  contentType: string | null;
  fields: Record<string, string | string[]>;
  activeFieldPresent: boolean;
  activeValues: string[];
  looksActiveTrue: boolean;
  hasProductName: boolean;
  hasMenuNumber: boolean;
  hasCategory: boolean;
  variantNames: string[];
  variantPrices: string[];
  ingredientNames: string[];
};

const SENSITIVE_KEY_RE = /token|csrf|password|cookie|session/i;

function setField(
  out: Record<string, string | string[]>,
  key: string,
  value: string,
): void {
  if (SENSITIVE_KEY_RE.test(key)) return;
  const existing = out[key];
  if (existing === undefined) {
    out[key] = value;
    return;
  }
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  out[key] = [existing, value];
}

export function parseFormBody(body: string): Record<string, string | string[]> {
  const params = new URLSearchParams(body);
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    const all = params.getAll(key);
    out[key] = all.length <= 1 ? (all[0] ?? "") : all;
  }
  return out;
}

export function parseMultipartBody(body: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  // Split on boundary lines starting with ------
  const parts = body.split(/------[^\r\n]+/).filter(Boolean);
  for (const part of parts) {
    const nameMatch = /name="([^"]+)"/i.exec(part);
    if (!nameMatch) continue;
    const key = nameMatch[1]!;
    if (SENSITIVE_KEY_RE.test(key)) continue;
    // Skip file content markers without using filename value beyond empty check
    const afterHeaders = part.split(/\r?\n\r?\n/).slice(1).join("\n");
    const value = afterHeaders.replace(/\r?\n--\s*$/, "").replace(/\r?\n$/g, "").trim();
    // Ignore binary image blob if any (empty file uploads are fine)
    if (key === "image" && value.length > 200) continue;
    setField(out, key, value);
  }
  return out;
}

export function sanitizeCreatePayload(input: {
  method: string;
  url: string;
  postData: string | null;
  headers?: Record<string, string>;
}): SanitizedCreatePayload {
  const path = input.url.replace(/^https?:\/\/[^/]+/i, "");
  const contentType =
    input.headers?.["content-type"] ||
    input.headers?.["Content-Type"] ||
    null;
  const raw = input.postData || "";
  const isMultipart =
    /multipart\/form-data/i.test(contentType || "") ||
    raw.includes("Content-Disposition: form-data");
  const fields = isMultipart ? parseMultipartBody(raw) : parseFormBody(raw);

  const activeRaw = fields.active;
  const activeValues = Array.isArray(activeRaw)
    ? activeRaw
    : activeRaw === undefined
      ? []
      : [activeRaw];
  const looksActiveTrue = activeValues.some(
    (v) => v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "on",
  );

  const variantNames = Object.entries(fields)
    .filter(([k]) => /variants\[\d+]\[name]$/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, v]) => (Array.isArray(v) ? v[0] : v) || "");
  const variantPrices = Object.entries(fields)
    .filter(([k]) => /variants\[\d+]\[price]$/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, v]) => (Array.isArray(v) ? v[0] : v) || "");
  const ingredientNames = Object.entries(fields)
    .filter(([k]) => /ingredients\[\d+]\[name]$/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, v]) => (Array.isArray(v) ? v[0] : v) || "");

  const categories = fields["categories[]"];
  const hasCategory = Array.isArray(categories)
    ? categories.length > 0
    : Boolean(categories);

  return {
    method: input.method,
    path,
    contentType,
    fields,
    activeFieldPresent: "active" in fields,
    activeValues,
    looksActiveTrue,
    hasProductName: Boolean(fields.name),
    hasMenuNumber: Boolean(fields.menu_number),
    hasCategory,
    variantNames,
    variantPrices,
    ingredientNames,
  };
}

export function assertInactiveCreatePayloadSafe(
  payload: SanitizedCreatePayload,
  expected: {
    name: string;
    menuNumber: string;
    categoryDatabaseId: string;
    basePriceKr: string;
  },
): { ok: true } | { ok: false; reason: string } {
  if (payload.method.toUpperCase() !== "POST") {
    return { ok: false, reason: `unexpected_method:${payload.method}` };
  }
  if (!/\/admin\/menu\/?$/i.test(payload.path)) {
    return { ok: false, reason: `unexpected_path:${payload.path}` };
  }
  if (payload.looksActiveTrue) {
    return { ok: false, reason: "active_true_in_payload" };
  }
  if (String(payload.fields.name ?? "") !== expected.name) {
    return { ok: false, reason: "name_mismatch" };
  }
  if (String(payload.fields.menu_number ?? "") !== expected.menuNumber) {
    return { ok: false, reason: "menu_number_mismatch" };
  }
  if (String(payload.fields.price ?? "") !== expected.basePriceKr) {
    return { ok: false, reason: "price_mismatch" };
  }
  const cats = payload.fields["categories[]"];
  const catList = Array.isArray(cats) ? cats : cats ? [cats] : [];
  if (!catList.includes(expected.categoryDatabaseId)) {
    return { ok: false, reason: "category_missing" };
  }
  return { ok: true };
}
