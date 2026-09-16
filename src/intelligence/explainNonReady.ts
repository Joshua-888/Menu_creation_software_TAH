/**
 * Exact non-ready product issue dump for certification.
 * Separates PRODUCT STATUS from QUALITY FINDINGS.
 */

import type { CanonicalMenu } from "../domain/schema/canonical.js";
import type {
  MenuQualityContractResult,
  ProductQualityResult,
  QualityCheckResult,
} from "./types.js";

export type ExactNonReadyIssue = {
  menuNumber: string | null;
  productName: string;
  category: string;
  status: "QUALITY_REVIEW" | "QUALITY_BLOCKED";
  issueCode: string;
  field: string;
  currentValue: string;
  requiredCondition: string;
  sourceEvidence: string;
  policyEvidence: string;
  whyNotAutoResolved: string;
};

const FIELD_BY_CHECK: Record<string, string> = {
  PRODUCT_NAME_VALID: "name",
  CATEGORY_SEMANTIC_FIT: "category",
  DESCRIPTION_PROFESSIONAL: "description",
  INGREDIENTS_COMPLETE: "ingredients",
  INGREDIENTS_VALID: "ingredients",
  NO_META_AS_INGREDIENT: "ingredients",
  NO_PRODUCT_NAME_AS_INGREDIENT: "ingredients",
  NO_GLUED_INGREDIENTS: "ingredients",
  VARIANT_STRUCTURE_VALID: "variants",
  NO_MENU_VARIANT: "variants",
  PRODUCT_CHOICES_VALID: "productChoices",
  COMBO_STRUCTURE_VALID: "isCombo",
  ADDITIONS_VALID: "additions",
  ADDITION_SCOPE_VALID: "additions",
  ADDITION_PRICE_SUPPORTED: "additions.price",
  NO_OCR_GARBAGE: "name",
  GRAMMAR_VALID: "description",
  PROVENANCE_SUFFICIENT: "ingredients.origin",
};

const REQUIRED_BY_CHECK: Record<string, string> = {
  PRODUCT_NAME_VALID: "Valid dish title (not topping/category/garbage)",
  CATEGORY_SEMANTIC_FIT: "Category must match product family semantics",
  DESCRIPTION_PROFESSIONAL:
    "Non-empty professional description without price leakage",
  INGREDIENTS_COMPLETE: "Food products require ≥2 ingredients",
  INGREDIENTS_VALID: "Ingredients must be valid food components",
  NO_META_AS_INGREDIENT: "Meta words (Tilbehør/Menu/Valgfri) not ingredients",
  NO_PRODUCT_NAME_AS_INGREDIENT: "Product name must not appear as ingredient",
  NO_GLUED_INGREDIENTS: "Glued OCR tokens must be split (e.g. Skinkeog ananas)",
  VARIANT_STRUCTURE_VALID: "Variants must be size/choice, never Menu-as-variant",
  NO_MENU_VARIANT: "Menu must be combo/representation, never a size variant",
  PRODUCT_CHOICES_VALID: "Product choices must be well-formed",
  COMBO_STRUCTURE_VALID: "Combo must not use Menu-as-variant",
  ADDITIONS_VALID: "Additions must be valid extras (not meta/OCR junk)",
  ADDITION_SCOPE_VALID: "Drinks must not inherit food dips/extras",
  ADDITION_PRICE_SUPPORTED: "Addition prices must be numeric when present",
  NO_OCR_GARBAGE: "Name must not be OCR garbage",
  GRAMMAR_VALID: "Description grammar must be valid",
  PROVENANCE_SUFFICIENT: "Every ingredient must have provenance origin",
};

function currentValueFor(
  field: string,
  product: CanonicalMenu["categories"][0]["products"][0],
  category: string,
): string {
  switch (field) {
    case "name":
      return product.name ?? "";
    case "category":
      return category;
    case "description":
      return product.description ?? "";
    case "ingredients":
      return product.ingredients.map((i) => i.display).join(" | ") || "(empty)";
    case "ingredients.origin":
      return (
        product.ingredients
          .map((i) => `${i.display}:${i.origin ?? "MISSING"}`)
          .join(" | ") || "(empty)"
      );
    case "variants":
      return product.variants.map((v) => v.name).join(" | ") || "(none)";
    case "additions":
      return product.addOns.map((a) => a.name).join(" | ") || "(none)";
    case "additions.price":
      return (
        product.addOns
          .map((a) => `${a.name}=${a.price ?? "null"}`)
          .join(" | ") || "(none)"
      );
    case "isCombo":
      return String(product.isCombo);
    case "productChoices":
      return JSON.stringify(product.productChoices ?? []);
    default:
      return "";
  }
}

function whyNotAutoResolved(check: QualityCheckResult): string {
  switch (check.id) {
    case "INGREDIENTS_COMPLETE":
      return "Source did not list ≥2 ingredients; no ACTIVE scoped fact or strong peer completion applied without invention";
    case "DESCRIPTION_PROFESSIONAL":
      return "Description missing or contains price/grammar issues; cannot invent professional copy without source/policy evidence";
    case "PRODUCT_NAME_VALID":
    case "NO_OCR_GARBAGE":
      return "Name fails classifier/garbage rules; cannot rename dish without source evidence";
    case "NO_MENU_VARIANT":
      return "Menu-as-variant forbidden by MenuConstitutionV1; exact combo contents unavailable so cannot invent Menu contents";
    case "CATEGORY_SEMANTIC_FIT":
      return "Category/family mismatch requires explicit remapping evidence not present in source";
    case "ADDITION_SCOPE_VALID":
      return "Food additions on drink violate scope; removal needs confirmation they are not intentional source extras";
    default:
      return (
        check.detail ??
        "Objective auto-resolve path lacked sufficient source, constitution, fact, policy, or peer evidence"
      );
  }
}

export function explainNonReadyProducts(
  menu: CanonicalMenu,
  quality: MenuQualityContractResult,
): ExactNonReadyIssue[] {
  const byId = new Map<string, { product: CanonicalMenu["categories"][0]["products"][0]; category: string }>();
  for (const c of menu.categories) {
    for (const p of c.products) {
      byId.set(p.sourceId, { product: p, category: c.name });
    }
  }

  const out: ExactNonReadyIssue[] = [];
  for (const pq of quality.products) {
    if (pq.status === "QUALITY_READY") continue;
    const hit = byId.get(pq.productSourceId);
    if (!hit) continue;
    const failed = pq.checks.filter((c) => !c.pass);
    for (const check of failed) {
      const field = FIELD_BY_CHECK[check.id] ?? "unknown";
      out.push({
        menuNumber: pq.menuNumber ?? null,
        productName: pq.name,
        category: hit.category,
        status: pq.status as "QUALITY_REVIEW" | "QUALITY_BLOCKED",
        issueCode: check.id,
        field,
        currentValue: currentValueFor(field, hit.product, hit.category),
        requiredCondition: REQUIRED_BY_CHECK[check.id] ?? check.id,
        sourceEvidence: `productSourceId=${pq.productSourceId}; name=${hit.product.name}`,
        policyEvidence: `MenuConstitutionV1 / QualityCheck ${check.id}`,
        whyNotAutoResolved: whyNotAutoResolved(check),
      });
    }
  }
  return out;
}

export function assertStatusAccounting(
  quality: MenuQualityContractResult,
): void {
  const { ready, review, blocked, productCount, reconciles } =
    quality.statusAccounting;
  if (!reconciles || ready + review + blocked !== productCount) {
    throw new Error(
      `Status accounting failed: ready(${ready})+review(${review})+blocked(${blocked})!==productCount(${productCount})`,
    );
  }
  // Ensure each product has exactly one status bucket membership
  const ids = new Set<string>();
  for (const list of [
    quality.readyProductIds,
    quality.reviewProductIds,
    quality.blockedProductIds,
  ]) {
    for (const id of list) {
      if (ids.has(id)) {
        throw new Error(`Product ${id} appears in multiple status buckets`);
      }
      ids.add(id);
    }
  }
  if (ids.size !== productCount) {
    throw new Error(
      `Status bucket coverage ${ids.size} !== productCount ${productCount}`,
    );
  }
  void (null as unknown as ProductQualityResult);
}
