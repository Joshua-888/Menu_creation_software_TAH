import type { ActiveDefaultGateResult, BaselineResult } from "./types.js";

/**
 * M3 §4: if create form defaults to ACTIVE/CHECKED, block all product writes.
 * Unchecking is not permitted as a workaround for the first canary pass.
 */
export function evaluateActiveDefaultGate(
  activeDefaultChecked: boolean | null,
): ActiveDefaultGateResult {
  if (activeDefaultChecked === true) {
    return {
      ok: false,
      code: "CANARY_PUBLIC_VISIBILITY_RISK",
      activeDefaultChecked: true,
      message:
        "Create form #active defaults to checked (available). Refusing first canary write to avoid customer-visible items. M3 BLOCKED until inactive-by-default or an approved explicit uncheck protocol exists.",
    };
  }
  if (activeDefaultChecked === false) {
    return { ok: true, activeDefaultChecked: false };
  }
  return {
    ok: false,
    code: "CANARY_PUBLIC_VISIBILITY_RISK",
    activeDefaultChecked: true,
    message:
      "Could not determine #active default on create form; treating as public-visibility risk.",
  };
}

export function evaluateEmptyProductBaseline(input: {
  productCount: number;
  productNames?: string[];
  categoryCount: number;
}): BaselineResult {
  if (input.productCount !== 0) {
    return {
      ok: false,
      code: "CANARY_BASELINE_CHANGED",
      productCount: input.productCount,
      productNames: input.productNames ?? [],
    };
  }
  return {
    ok: true,
    productCount: 0,
    categoryCount: input.categoryCount,
  };
}
