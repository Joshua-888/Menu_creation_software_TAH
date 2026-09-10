import type { ValidationIssue } from "./schema/canonical.js";
import type { SourceVariant } from "./schema/source.js";
import type { ValidationStatus } from "./status.js";

const BASE_ALIASES = new Set([
  "alm",
  "almindelig",
  "standard",
  "normal",
  "regular",
]);

const SIZE_RANK: Record<string, number> = {
  lille: 1,
  mellem: 2,
  stor: 3,
};

/**
 * Deterministic normalize: trim, lowercase, strip harmless punctuation.
 * Does not use fuzzy/LLM matching.
 */
export function normalizeVariantKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.·•]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBaseVariantAlias(name: string): boolean {
  return BASE_ALIASES.has(normalizeVariantKey(name));
}

function parseCmSize(name: string): number | null {
  const key = normalizeVariantKey(name);
  const match = /^(\d+)\s*cm$/.exec(key);
  if (!match?.[1]) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

export type BaseVariantSelection =
  | { ok: true; variantSourceId: string; reason: string }
  | {
      ok: false;
      status: Extract<ValidationStatus, "MANUAL_REVIEW_REQUIRED">;
      issue: ValidationIssue;
    };

/**
 * Select base variant deterministically for pricing only.
 * BASE_ALIASES / SIZE_RANK / cm patterns are NOT an allowlist of variant names.
 * Variant names are open-ended source data; unfamiliar sets → MANUAL_REVIEW_REQUIRED
 * without renaming or rejecting rows.
 *
 * 1) Explicit aliases (Alm., Standard, …)
 * 2) Size hierarchy Lille < Mellem < Stor
 * 3) Numeric cm (smallest)
 * Else AMBIGUOUS_BASE_VARIANT.
 */
export function selectBaseVariant(
  productSourceId: string,
  variants: readonly SourceVariant[],
): BaseVariantSelection {
  if (variants.length === 0) {
    return {
      ok: true,
      variantSourceId: `${productSourceId}::system-default-alm`,
      reason: "SYSTEM_DEFAULT_ALM",
    };
  }

  if (variants.length === 1) {
    const only = variants[0];
    if (!only) {
      return ambiguous(productSourceId, "empty variant list after length check");
    }
    return {
      ok: true,
      variantSourceId: only.sourceId,
      reason: "SINGLE_VARIANT",
    };
  }

  const aliasMatches = variants.filter((v) => isBaseVariantAlias(v.name));
  if (aliasMatches.length === 1 && aliasMatches[0]) {
    return {
      ok: true,
      variantSourceId: aliasMatches[0].sourceId,
      reason: "BASE_ALIAS",
    };
  }
  if (aliasMatches.length > 1) {
    return ambiguous(
      productSourceId,
      "Multiple base-variant aliases present",
    );
  }

  const sizeNamed = variants
    .map((v) => {
      const rank = SIZE_RANK[normalizeVariantKey(v.name)];
      return rank === undefined ? null : { variant: v, rank };
    })
    .filter((x): x is { variant: SourceVariant; rank: number } => x !== null);

  if (sizeNamed.length === variants.length && sizeNamed.length > 0) {
    sizeNamed.sort((a, b) => a.rank - b.rank);
    const smallest = sizeNamed[0];
    if (smallest) {
      return {
        ok: true,
        variantSourceId: smallest.variant.sourceId,
        reason: "SIZE_HIERARCHY",
      };
    }
  }

  const cmSized = variants
    .map((v) => {
      const cm = parseCmSize(v.name);
      return cm === null ? null : { variant: v, cm };
    })
    .filter((x): x is { variant: SourceVariant; cm: number } => x !== null);

  if (cmSized.length === variants.length && cmSized.length > 0) {
    cmSized.sort((a, b) => a.cm - b.cm);
    const smallest = cmSized[0];
    if (smallest) {
      return {
        ok: true,
        variantSourceId: smallest.variant.sourceId,
        reason: "CM_HIERARCHY",
      };
    }
  }

  return ambiguous(productSourceId, "No deterministic base-variant rule matched");
}

function ambiguous(
  productSourceId: string,
  message: string,
): BaseVariantSelection {
  return {
    ok: false,
    status: "MANUAL_REVIEW_REQUIRED",
    issue: {
      code: "AMBIGUOUS_BASE_VARIANT",
      message,
      entityId: productSourceId,
      field: "variants",
      severity: "MANUAL_REVIEW_REQUIRED",
    },
  };
}

export const DEFAULT_ALM_VARIANT_NAME = "Alm.";
