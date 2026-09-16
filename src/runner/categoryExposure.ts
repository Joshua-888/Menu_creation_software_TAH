/**
 * Category storefront exposure policy for TAH destinations.
 *
 * Audit (v1 admin): category create form exposes #name + optional #order only.
 * Category edit exposes name/order + Slet (delete). No Aktiv?/hidden/draft control.
 * Product "Aktiv?" exists; category-level visibility does not.
 *
 * Therefore category CREATE is a customer-facing navigation mutation even when
 * all products in that category are Skjult.
 */

/** True when creating a category immediately exposes its name on storefront nav. */
export const CATEGORY_CREATE_IS_PUBLIC_MUTATION = true as const;

/** TAH v1 does not support hidden/inactive/draft categories. */
export const CATEGORY_VISIBILITY_CONTROL_EXISTS = false as const;

export type CategoryExposureCapabilityAudit = {
  hiddenCategory: false;
  inactiveCategory: false;
  availabilityStatus: false;
  categoryVisibility: false;
  draftCategory: false;
  storeMenuGlobalDisable: false;
  CATEGORY_CREATE_IS_PUBLIC_MUTATION: true;
  CATEGORY_VISIBILITY_CONTROL_EXISTS: false;
  evidence: string[];
};

export function auditCategoryExposureCapabilities(): CategoryExposureCapabilityAudit {
  return {
    hiddenCategory: false,
    inactiveCategory: false,
    availabilityStatus: false,
    categoryVisibility: false,
    draftCategory: false,
    storeMenuGlobalDisable: false,
    CATEGORY_CREATE_IS_PUBLIC_MUTATION: true,
    CATEGORY_VISIBILITY_CONTROL_EXISTS: false,
    evidence: [
      "Category create form: #name, optional #order only (no Aktiv?/visibility).",
      "Category edit form: name/order + Slet delete; no hidden/inactive/draft.",
      "Category list rows: name, order, itemCount — no visibility status.",
      "Product Aktiv? is product-scoped; empty categories still appear in storefront nav.",
      "No certified setCategoryHidden / draftCategory capability in adapter evidence.",
    ],
  };
}

export type MinimizedExposureProductRef = {
  sourceId: string;
  categoryName: string;
  /** Structural readiness of the planned product payload. */
  ready: boolean;
};

export type MinimizedExposurePlanStep =
  | {
      kind: "VALIDATE_CATEGORY_PRODUCTS";
      categoryName: string;
      productSourceIds: string[];
    }
  | {
      kind: "CREATE_CATEGORY";
      categoryName: string;
      reason: "dependency_minimizing_public_mutation";
    }
  | {
      kind: "CREATE_HIDDEN_PRODUCT";
      sourceId: string;
      categoryName: string;
    }
  | {
      kind: "VERIFY_HIDDEN_PRODUCT";
      sourceId: string;
      categoryName: string;
    };

/**
 * Dependency-minimizing execution when CATEGORY_CREATE_IS_PUBLIC_MUTATION.
 * Do NOT create all categories upfront.
 * Per category: validate → create category → create+verify all hidden products → next.
 */
export function buildMinimizedCategoryExposureSteps(input: {
  categories: readonly { name: string }[];
  products: readonly MinimizedExposureProductRef[];
}): {
  steps: MinimizedExposurePlanStep[];
  blocked: Array<{ categoryName: string; reason: string }>;
} {
  const steps: MinimizedExposurePlanStep[] = [];
  const blocked: Array<{ categoryName: string; reason: string }> = [];

  for (const cat of input.categories) {
    const deps = input.products.filter(
      (p) =>
        p.categoryName.trim().toLocaleLowerCase("da-DK") ===
        cat.name.trim().toLocaleLowerCase("da-DK"),
    );
    const notReady = deps.filter((p) => !p.ready);
    if (notReady.length > 0) {
      blocked.push({
        categoryName: cat.name,
        reason: `CATEGORY_PRECREATE_VALIDATION_FAILED: ${notReady.length} product(s) not READY`,
      });
      continue;
    }
    if (deps.length === 0) {
      blocked.push({
        categoryName: cat.name,
        reason: "CATEGORY_PRECREATE_VALIDATION_FAILED: no dependent products",
      });
      continue;
    }

    steps.push({
      kind: "VALIDATE_CATEGORY_PRODUCTS",
      categoryName: cat.name,
      productSourceIds: deps.map((p) => p.sourceId),
    });
    steps.push({
      kind: "CREATE_CATEGORY",
      categoryName: cat.name,
      reason: "dependency_minimizing_public_mutation",
    });
    for (const p of deps) {
      steps.push({
        kind: "CREATE_HIDDEN_PRODUCT",
        sourceId: p.sourceId,
        categoryName: cat.name,
      });
      steps.push({
        kind: "VERIFY_HIDDEN_PRODUCT",
        sourceId: p.sourceId,
        categoryName: cat.name,
      });
    }
  }

  return { steps, blocked };
}

/**
 * Propose removal of a newly created empty category after first dependent
 * product failed before any product persisted. Does NOT auto-delete —
 * RecoveryPlan may propose; certified recovery policy must allow execute.
 */
export function proposeEmptyCategoryCompensation(input: {
  categoryDatabaseId: string;
  categoryName: string;
  newlyCreatedInIncident: boolean;
  productCountOnCategory: number;
  anyProductPersisted: boolean;
  certifiedDeleteAllowed: boolean;
}): {
  proposeRemoval: boolean;
  autoDelete: false;
  reason: string;
} {
  if (!input.newlyCreatedInIncident) {
    return {
      proposeRemoval: false,
      autoDelete: false,
      reason: "not a newly-created incident entity",
    };
  }
  if (input.productCountOnCategory !== 0 || input.anyProductPersisted) {
    return {
      proposeRemoval: false,
      autoDelete: false,
      reason: "category is not empty / products already persisted",
    };
  }
  if (!input.certifiedDeleteAllowed) {
    return {
      proposeRemoval: false,
      autoDelete: false,
      reason: "deleteCategory not certified — cannot propose execute",
    };
  }
  return {
    proposeRemoval: true,
    autoDelete: false,
    reason:
      "empty newly-created incident category after first dependent product failed before persistence; RecoveryPlan may propose removal — do not auto-delete",
  };
}

export type MenuCreationMetrics = {
  categoriesCreated: number;
  categoriesVerified: number;
  productsCreated: number;
  productsVerified: number;
  wholeMenuVerified: boolean;
  representationEquivalentFields: number;
  semanticMismatchFields: number;
};

export function emptyMenuCreationMetrics(): MenuCreationMetrics {
  return {
    categoriesCreated: 0,
    categoriesVerified: 0,
    productsCreated: 0,
    productsVerified: 0,
    wholeMenuVerified: false,
    representationEquivalentFields: 0,
    semanticMismatchFields: 0,
  };
}
