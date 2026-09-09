import type { Page, Route } from "playwright";
import { serializeSuccessfulControlsInPage } from "../adapters/v1/pageScripts.mjs";

export type InspectedFormField = {
  name: string;
  value: string;
};

export type InspectedFormPayload = {
  action: string | null;
  method: string | null;
  fields: InspectedFormField[];
  asObject: Record<string, string | string[]>;
};

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function assertPayloadHasNoActiveTrue(
  payload: InspectedFormPayload,
): boolean {
  const active = payload.asObject.active;
  if (active === undefined) return true;
  const values = Array.isArray(active) ? active : [active];
  return !values.some(
    (v) => v === "1" || v.toLowerCase() === "true" || v === "on",
  );
}

/**
 * Inspect effective form payload WITHOUT submitting and WITHOUT HTTP mutations.
 *
 * Preferred M3+ preflight technique (replaces request-abort interception).
 * Abort-after-submit is NOT a persistence guarantee and must not be used for safety.
 *
 * Optional route guard records and aborts any accidental mutation requests;
 * evaluate(FormData) itself performs zero network I/O.
 */
export async function inspectFormSubmission(
  page: Page,
  formSelector: string,
): Promise<{
  payload: InspectedFormPayload;
  mutationRequests: string[];
}> {
  const mutationRequests: string[] = [];
  const handler = async (route: Route) => {
    const method = route.request().method().toUpperCase();
    if (MUTATION_METHODS.has(method)) {
      mutationRequests.push(`${method} ${route.request().url()}`);
      await route.abort("failed");
      return;
    }
    await route.continue();
  };

  await page.route("**/*", handler);
  try {
    const payload = (await page.evaluate(
      serializeSuccessfulControlsInPage,
      formSelector,
    )) as InspectedFormPayload;
    return { payload, mutationRequests };
  } finally {
    await page.unroute("**/*", handler);
  }
}
