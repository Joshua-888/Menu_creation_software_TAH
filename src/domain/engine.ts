import { composeIngredients } from "./ingredients.js";
import { assignMenuNumbers } from "./numbering.js";
import { priceVariants } from "./pricing.js";
import type {
  CanonicalCategory,
  CanonicalMenu,
  CanonicalProduct,
  ValidationIssue,
  ValidationReport,
} from "./schema/canonical.js";
import { SourceMenuSchema, type SourceMenu } from "./schema/source.js";
import { aggregateStatus } from "./status.js";
import {
  buildValidationReport,
  finalizeProductStatus,
  issue,
  validateProductChoices,
  validateSourceIds,
} from "./validation.js";
import {
  DEFAULT_ALM_VARIANT_NAME,
  selectBaseVariant,
} from "./variants.js";
import { domainVersions, type DomainVersions } from "./versions.js";

export type DomainEngineResult = {
  menu: CanonicalMenu;
  validation: ValidationReport;
  versions: DomainVersions;
};

function deepCloneSourceMenu(menu: SourceMenu): SourceMenu {
  return structuredClone(menu);
}

/**
 * Pure domain engine. Does not mutate the input SourceMenu.
 */
export function runDomainEngine(input: SourceMenu): DomainEngineResult {
  const snapshot = deepCloneSourceMenu(input);
  const source = SourceMenuSchema.parse(snapshot);

  // Purity guard: work only from parsed clone; caller input untouched.
  const menuIssues: ValidationIssue[] = [];
  menuIssues.push(...validateSourceIds(source));

  if (source.categories.length === 0) {
    menuIssues.push(
      issue(
        "MISSING_CATEGORY",
        "Menu has no categories",
        "menu",
        "BLOCKED",
        "categories",
      ),
    );
  }

  const knownProductIds = new Set(
    source.categories.flatMap((c) => c.products.map((p) => p.sourceId)),
  );
  menuIssues.push(...validateProductChoices(source, knownProductIds));

  const numbering = assignMenuNumbers(source);
  const numberingById = new Map(
    numbering.products.map((p) => [p.sourceId, p]),
  );

  const assignedCounts = new Map<string, number>();
  for (const p of numbering.products) {
    assignedCounts.set(
      p.assignedMenuNumber,
      (assignedCounts.get(p.assignedMenuNumber) ?? 0) + 1,
    );
  }

  const sourceDupSet = new Set(numbering.sourceDuplicateNumbers);

  const categories: CanonicalCategory[] = [];

  for (const category of [...source.categories].sort(
    (a, b) => a.sourceOrder - b.sourceOrder,
  )) {
    const products: CanonicalProduct[] = [];

    for (const product of [...category.products].sort(
      (a, b) => a.sourceOrder - b.sourceOrder,
    )) {
      const productIssues: ValidationIssue[] = [];
      const numbered = numberingById.get(product.sourceId);

      if (!product.name.trim()) {
        productIssues.push(
          issue(
            "MISSING_PRODUCT_NAME",
            "Product name is empty",
            product.sourceId,
            "BLOCKED",
            "name",
          ),
        );
      }

      if (!numbered) {
        productIssues.push(
          issue(
            "MISSING_MENU_NUMBER",
            "Numbering failed for product",
            product.sourceId,
            "BLOCKED",
            "assignedMenuNumber",
          ),
        );
      } else {
        const assigned = numbered.assignedMenuNumber;
        const sourceTrimmed = numbered.sourceMenuNumber?.trim();
        const isPreservedSourceDuplicate =
          sourceTrimmed !== undefined &&
          sourceTrimmed.length > 0 &&
          sourceTrimmed === assigned &&
          sourceDupSet.has(sourceTrimmed);

        if (isPreservedSourceDuplicate) {
          // Source-domain policy: review, do not BLOCK (destination uniqueness TBD in M2).
          productIssues.push(
            issue(
              "DUPLICATE_SOURCE_MENU_NUMBER",
              `Source menu number ${sourceTrimmed} appears more than once`,
              product.sourceId,
              "MANUAL_REVIEW_REQUIRED",
              "sourceMenuNumber",
            ),
          );
        } else if ((assignedCounts.get(assigned) ?? 0) > 1) {
          // Domain must never introduce assigned collisions itself.
          productIssues.push(
            issue(
              "DUPLICATE_ASSIGNED_MENU_NUMBER",
              `Domain assigned duplicate menu number ${assigned}`,
              product.sourceId,
              "BLOCKED",
              "assignedMenuNumber",
            ),
          );
        }
      }

      const presentVariants = product.variants.filter(
        (v) => v.name.trim().length > 0,
      );
      // Blank cells excluded — do not invent variants from category columns.

      let baseSelection = selectBaseVariant(product.sourceId, presentVariants);
      let injectedDefault = false;
      if (presentVariants.length === 0) {
        injectedDefault = true;
        baseSelection = {
          ok: true,
          variantSourceId: `${product.sourceId}::system-default-alm`,
          reason: "SYSTEM_DEFAULT_ALM",
        };
      }

      if (!baseSelection.ok) {
        productIssues.push(baseSelection.issue);
      }

      const pricing = priceVariants(
        product.sourceId,
        presentVariants,
        baseSelection.ok
          ? baseSelection.variantSourceId
          : `${product.sourceId}::missing-base`,
        { injectedDefaultAlm: injectedDefault },
      );
      productIssues.push(...pricing.issues);

      if (pricing.variants.length === 0 && !injectedDefault) {
        productIssues.push(
          issue(
            "MISSING_VARIANT",
            "Product has no variants after pricing",
            product.sourceId,
            "BLOCKED",
            "variants",
          ),
        );
      }

      const ingredients = composeIngredients(
        category.commonIngredients,
        product.ingredients,
      );

      const hasSourceIngredients =
        category.commonIngredients.some((i) => i.origin === "SOURCE") ||
        product.ingredients.some((i) => i.origin === "SOURCE");

      if (!hasSourceIngredients || ingredients.length === 0) {
        // Business preference: ingredients wanted, but never fabricate.
        if (ingredients.length === 0) {
          productIssues.push(
            issue(
              "MISSING_SOURCE_SUPPORTED_INGREDIENTS",
              "No source-supported ingredients available",
              product.sourceId,
              "MANUAL_REVIEW_REQUIRED",
              "ingredients",
            ),
          );
        }
      }

      // Ensure default Alm name when injected
      const variants = pricing.variants.map((v) => {
        if (injectedDefault) {
          return {
            ...v,
            name: DEFAULT_ALM_VARIANT_NAME,
            nameOrigin: "SYSTEM_DEFAULT" as const,
          };
        }
        return v;
      });

      const draft: Omit<CanonicalProduct, "status"> = {
        sourceId: product.sourceId,
        categorySourceId: category.sourceId,
        name: product.name,
        sourceOrder: product.sourceOrder,
        ingredients,
        variants: variants.map((v) => {
          const mapped = {
            sourceId: v.sourceId,
            name: v.name,
            nameOrigin: v.nameOrigin,
            surcharge: v.surcharge,
            surchargeOrigin: v.surchargeOrigin,
            isBase: v.isBase,
          };
          return {
            ...mapped,
            ...(v.sourceTotalPrice !== undefined
              ? { sourceTotalPrice: v.sourceTotalPrice }
              : {}),
            ...(v.sourceExplicitSurcharge !== undefined
              ? { sourceExplicitSurcharge: v.sourceExplicitSurcharge }
              : {}),
          };
        }),
        addOns: product.addOns.map((a) => ({
          sourceId: a.sourceId,
          name: a.name,
          origin: "SOURCE" as const,
          ...(a.price !== undefined ? { price: a.price } : {}),
        })),
        productChoices: product.productChoices.map((c) => ({
          sourceId: c.sourceId,
          prompt: c.prompt,
          options: c.options.map((o) => ({
            productSourceId: o.productSourceId,
            ...(o.label !== undefined ? { label: o.label } : {}),
          })),
        })),
        isCombo: product.isCombo,
        issues: productIssues,
        ...(product.description !== undefined
          ? { description: product.description }
          : {}),
        ...(numbered?.sourceMenuNumber !== undefined
          ? { sourceMenuNumber: numbered.sourceMenuNumber }
          : {}),
        ...(numbered
          ? { assignedMenuNumber: numbered.assignedMenuNumber }
          : {}),
        ...(pricing.basePrice !== undefined
          ? { basePrice: pricing.basePrice }
          : {}),
        ...(pricing.basePriceOrigin !== undefined
          ? { basePriceOrigin: pricing.basePriceOrigin }
          : {}),
        ...(product.evidence !== undefined ? { evidence: product.evidence } : {}),
        ...(product.confidence !== undefined
          ? { confidence: product.confidence }
          : {}),
      };

      products.push(finalizeProductStatus(draft));
    }

    categories.push({
      sourceId: category.sourceId,
      name: category.name,
      sourceOrder: category.sourceOrder,
      commonIngredients: composeIngredients(category.commonIngredients, []),
      products,
      ...(category.evidence !== undefined
        ? { evidence: category.evidence }
        : {}),
    });
  }

  // Detect duplicate products by sourceId already handled; soft duplicate names are WARNING only if same category
  for (const category of categories) {
    const nameCounts = new Map<string, string[]>();
    for (const product of category.products) {
      const key = product.name.trim().toLowerCase();
      if (!key) continue;
      const list = nameCounts.get(key) ?? [];
      list.push(product.sourceId);
      nameCounts.set(key, list);
    }
    for (const [, ids] of nameCounts) {
      if (ids.length > 1) {
        for (const id of ids) {
          const product = category.products.find((p) => p.sourceId === id);
          if (!product) continue;
          product.issues.push(
            issue(
              "DUPLICATE_PRODUCT",
              "Duplicate product display name within category (identity remains sourceId)",
              id,
              "WARNING",
              "name",
            ),
          );
          const updated = finalizeProductStatus(product);
          product.status = updated.status;
          product.issues = updated.issues;
        }
      }
    }
  }

  const allProductStatuses = categories.flatMap((c) =>
    c.products.map((p) => p.status),
  );
  const menuStatus = aggregateStatus([
    ...menuIssues.map((i) => i.severity),
    ...allProductStatuses,
  ]);

  const versions = domainVersions();
  const menu: CanonicalMenu = {
    restaurantName: source.restaurantName,
    categories,
    schemaVersion: versions.canonicalMenuSchema,
    domainRulesVersion: versions.domainRuleEngine,
    status: menuStatus,
    issues: menuIssues,
    ...(source.sourceInfo !== undefined
      ? { sourceInfo: source.sourceInfo }
      : {}),
    ...(source.destinationInfo !== undefined
      ? { destinationInfo: source.destinationInfo }
      : {}),
    ...(source.extractionVersion !== undefined
      ? { extractionVersion: source.extractionVersion }
      : {}),
  };

  return {
    menu,
    validation: buildValidationReport(menu),
    versions,
  };
}

/** Structural equality helper for determinism tests. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}
