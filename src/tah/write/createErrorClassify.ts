/**
 * Classify TAH product CREATE failures from HTTP status + sanitized body.
 * Never logs cookies, CSRF tokens, or credentials.
 */

export type TahCreateErrorClass =
  | "MENU_NUMBER_CREATE_CONFLICT"
  | "DUPLICATE_NAME_CONFLICT"
  | "INVALID_CHARACTER"
  | "INVALID_FIELD_VALUE"
  | "INVALID_CATEGORY_REFERENCE"
  | "INVALID_VARIANT_PAYLOAD"
  | "SESSION_OR_CSRF_FAILURE"
  | "TAH_FORM_CONTRACT_DRIFT"
  | "BACKEND_DATABASE_CONSTRAINT"
  | "TAH_SERVER_EXCEPTION"
  | "TRANSIENT_NETWORK"
  | "UNKNOWN_AFTER_FORENSICS";

export type TahCreateErrorSignature = {
  operation: "CREATE_PRODUCT";
  endpoint: "POST /admin/menu";
  httpStatus: number;
  normalizedBody: string;
  fieldClass: string;
  class: TahCreateErrorClass;
  retryable: boolean;
  signature: string;
};

const SECRETISH = /\b(_token|token|cookie|csrf|authorization|password|session)[=:][^\s&]+/gi;

export function sanitizeCreateErrorBody(raw: string | null | undefined): string {
  const text = String(raw ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(SECRETISH, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return text;
}

export function normalizeCreateErrorBody(raw: string | null | undefined): string {
  const sanitized = sanitizeCreateErrorBody(raw).toLowerCase();
  if (!sanitized) return "empty";
  if (/oops|internal server error|something is wrong/.test(sanitized)) {
    return "oops_internal_server_error";
  }
  if (/sqlstate|duplicate entry|unique constraint|integrity constraint/.test(sanitized)) {
    if (/menu_number|menu number/.test(sanitized)) return "duplicate_menu_number";
    if (/name/.test(sanitized)) return "duplicate_name";
    return "database_constraint";
  }
  if (/page expired|csrf|419/.test(sanitized)) return "csrf_or_page_expired";
  if (/unauthenticated|unauthorized/.test(sanitized)) return "auth_rejected";
  return sanitized.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || "opaque";
}

export function classifyCreateHttpFailure(input: {
  httpStatus: number;
  bodyText?: string | null;
  fieldClass?: string;
}): TahCreateErrorSignature {
  const httpStatus = input.httpStatus;
  const normalizedBody = normalizeCreateErrorBody(input.bodyText);
  let errorClass: TahCreateErrorClass = "UNKNOWN_AFTER_FORENSICS";
  let retryable = false;
  let fieldClass = input.fieldClass ?? "unknown";

  if (httpStatus === 419 || normalizedBody === "csrf_or_page_expired") {
    errorClass = "SESSION_OR_CSRF_FAILURE";
    retryable = true;
    fieldClass = "csrf";
  } else if (httpStatus === 401 || httpStatus === 403) {
    errorClass = "SESSION_OR_CSRF_FAILURE";
    retryable = true;
    fieldClass = "session";
  } else if (httpStatus === 422 || httpStatus === 400) {
    errorClass = "INVALID_FIELD_VALUE";
    fieldClass = fieldClass === "unknown" ? "validation" : fieldClass;
  } else if (httpStatus === 409) {
    errorClass = "BACKEND_DATABASE_CONSTRAINT";
    fieldClass = fieldClass === "unknown" ? "conflict" : fieldClass;
  } else if (httpStatus >= 500) {
    if (normalizedBody === "duplicate_menu_number") {
      errorClass = "MENU_NUMBER_CREATE_CONFLICT";
      fieldClass = "menu_number";
    } else if (normalizedBody === "duplicate_name") {
      errorClass = "DUPLICATE_NAME_CONFLICT";
      fieldClass = "name";
    } else if (normalizedBody === "database_constraint") {
      errorClass = "BACKEND_DATABASE_CONSTRAINT";
    } else {
      errorClass = "TAH_SERVER_EXCEPTION";
    }
  } else if (httpStatus < 0 || httpStatus === 0) {
    errorClass = "TRANSIENT_NETWORK";
    retryable = true;
  }

  const signature = [
    "CREATE_PRODUCT",
    "POST /admin/menu",
    String(httpStatus),
    normalizedBody,
    fieldClass,
  ].join("|");

  return {
    operation: "CREATE_PRODUCT",
    endpoint: "POST /admin/menu",
    httpStatus,
    normalizedBody,
    fieldClass,
    class: errorClass,
    retryable,
    signature,
  };
}

export function isDeterministicCreateRejection(
  classified: TahCreateErrorSignature,
): boolean {
  if (classified.retryable) return false;
  return (
    classified.httpStatus >= 400 ||
    classified.class === "TAH_SERVER_EXCEPTION" ||
    classified.class === "BACKEND_DATABASE_CONSTRAINT" ||
    classified.class === "MENU_NUMBER_CREATE_CONFLICT" ||
    classified.class === "DUPLICATE_NAME_CONFLICT" ||
    classified.class === "INVALID_FIELD_VALUE"
  );
}

const RESPONSE_ERROR = /CREATE_RESPONSE_ERROR status=(\d+)/i;

export function classifyCreateFailureFromMessage(
  message: string | null | undefined,
): TahCreateErrorSignature | null {
  const text = String(message ?? "");
  const match = text.match(RESPONSE_ERROR);
  if (!match?.[1]) return null;
  const status = Number(match[1]);
  const signatureMatch = text.match(/signature=([^\s]+)/i);
  const bodyMatch = text.match(/body=([a-z0-9_]+)/i);
  const fieldFromSignature = signatureMatch?.[1]?.split("|")[4];
  return classifyCreateHttpFailure({
    httpStatus: status,
    bodyText: bodyMatch?.[1] ?? (status >= 500 ? "oops internal server error" : ""),
    ...(fieldFromSignature ? { fieldClass: fieldFromSignature } : {}),
  });
}

export function formatCreateFailureMessage(
  classified: TahCreateErrorSignature,
): string {
  return `CREATE_RESPONSE_ERROR status=${classified.httpStatus} class=${classified.class} body=${classified.normalizedBody} signature=${classified.signature}`;
}
