/**
 * Validation issue lifecycle — stale issues must not keep products in REVIEW
 * after their underlying condition is resolved.
 */

import { categoryExpectsListedIngredients } from "./ingredients.js";
import type {
  CanonicalMenu,
  CanonicalProduct,
  ValidationIssue,
} from "./schema/canonical.js";
import { aggregateStatus } from "./status.js";

export const ISSUE_LIFECYCLE = [
  "OPEN",
  "RESOLVED_BY_EXTRACTION",
  "RESOLVED_BY_DOMAIN_RULE",
  "RESOLVED_BY_POLICY",
  "RESOLVED_BY_HUMAN",
  "SUPERSEDED",
  "STILL_REVIEW_REQUIRED",
] as const;

export type IssueLifecycle = (typeof ISSUE_LIFECYCLE)[number];

export type IssueResolutionRecord = {
  entityId: string;
  menuNumber: string | null;
  code: string;
  lifecycle: IssueLifecycle;
  reason: string;
};

/**
 * Recompute product issues from current CanonicalMenu state.
 * Clears MISSING_SOURCE_SUPPORTED_INGREDIENTS when ingredients exist or when
 * empty ingredients are valid for the category.
 */
export function revalidateCanonicalIssues(
  menu: CanonicalMenu,
): { menu: CanonicalMenu; resolutions: IssueResolutionRecord[] } {
  const resolutions: IssueResolutionRecord[] = [];

  const categories = menu.categories.map((cat) => ({
    ...cat,
    products: cat.products.map((p) => {
      const next = revalidateProduct(p, cat.name, resolutions);
      return next;
    }),
  }));

  return {
    menu: { ...menu, categories },
    resolutions,
  };
}

function revalidateProduct(
  product: CanonicalProduct,
  categoryName: string,
  resolutions: IssueResolutionRecord[],
): CanonicalProduct {
  const kept: ValidationIssue[] = [];
  for (const iss of product.issues) {
    if (iss.code === "MISSING_SOURCE_SUPPORTED_INGREDIENTS") {
      if (product.ingredients.length > 0) {
        const fromDerived = product.ingredients.every(
          (i) => i.origin === "DERIVED",
        );
        resolutions.push({
          entityId: product.sourceId,
          menuNumber: product.sourceMenuNumber ?? null,
          code: iss.code,
          lifecycle: fromDerived
            ? "RESOLVED_BY_POLICY"
            : "RESOLVED_BY_EXTRACTION",
          reason: fromDerived
            ? "toppings recovered from description (DERIVED); dips excluded"
            : "ingredients present on product after pipeline",
        });
        continue;
      }
      if (!categoryExpectsListedIngredients(categoryName)) {
        resolutions.push({
          entityId: product.sourceId,
          menuNumber: product.sourceMenuNumber ?? null,
          code: iss.code,
          lifecycle: "RESOLVED_BY_DOMAIN_RULE",
          reason:
            "empty ingredients valid source absence for non-topping category",
        });
        continue;
      }
      resolutions.push({
        entityId: product.sourceId,
        menuNumber: product.sourceMenuNumber ?? null,
        code: iss.code,
        lifecycle: "STILL_REVIEW_REQUIRED",
        reason: "pizza-like category still missing source toppings",
      });
      kept.push(iss);
      continue;
    }
    // Stale ambiguous PRODUCT_CHOICE stubs superseded by real choices
    if (
      iss.code === "MALFORMED_PRODUCT_CHOICE" &&
      product.productChoices.some(
        (c) =>
          c.options.length >= 2 &&
          !c.options.some((o) => o.label === "REVIEW"),
      )
    ) {
      resolutions.push({
        entityId: product.sourceId,
        menuNumber: product.sourceMenuNumber ?? null,
        code: iss.code,
        lifecycle: "RESOLVED_BY_HUMAN",
        reason: "ProductChoice resolved; malformed stub superseded",
      });
      continue;
    }
    kept.push(iss);
  }

  const status = aggregateStatus(kept.map((i) => i.severity));
  return { ...product, issues: kept, status };
}
