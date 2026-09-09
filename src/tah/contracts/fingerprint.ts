import { createHash } from "node:crypto";

/**
 * Deterministic read-only admin contract fingerprint.
 * Excludes customer data, IDs, CSRF tokens, and timestamps.
 */
export type FingerprintInput = {
  routes: string[];
  fieldNames: string[];
  elementIds: string[];
  formActions: string[];
  structuralClasses: string[];
};

export function normalizeFingerprintParts(parts: string[]): string[] {
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function buildAdminContractFingerprint(input: FingerprintInput): {
  fingerprint: string;
  canonical: string;
  limitations: string[];
} {
  const canonical = JSON.stringify({
    routes: normalizeFingerprintParts(input.routes),
    fieldNames: normalizeFingerprintParts(input.fieldNames),
    elementIds: normalizeFingerprintParts(input.elementIds),
    formActions: normalizeFingerprintParts(input.formActions),
    structuralClasses: normalizeFingerprintParts(input.structuralClasses),
  });
  const fingerprint = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return {
    fingerprint,
    canonical,
    limitations: [
      "Structural similarity does not prove identical semantic behavior",
      "Does not include runtime JS behavior or server-side persistence rules",
      "Prefer explicit data-admin-contract-version when available",
    ],
  };
}

/** Baseline structural features for TAH admin v1 (create/edit menu). */
export const TAH_V1_STRUCTURE_FINGERPRINT_INPUT: FingerprintInput = {
  routes: [
    "/login",
    "/admin/menu",
    "/admin/menu/create",
    "/admin/menu/{id}/edit",
    "/admin/categories",
  ],
  fieldNames: [
    "menu_number",
    "name",
    "description",
    "price",
    "categories[]",
    "variants[][name]",
    "variants[][price]",
    "ingredients[][name]",
    "additions[][name]",
    "additions[][price]",
    "active",
    "image",
  ],
  elementIds: [
    "menu_number",
    "name",
    "description",
    "price",
    "active",
    "variant-list",
    "ingredient-list",
    "addition-list",
    "add-variant",
    "add-ingredient",
    "add-addition",
  ],
  formActions: ["/admin/menu", "/admin/menu/{id}"],
  structuralClasses: ["variant-form", "ingredient-form", "addition-form"],
};
