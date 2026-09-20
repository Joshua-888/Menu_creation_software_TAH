/**
 * Semantic Completeness Engine (V1) — authoritative field-requirement matrix.
 *
 * This module is the SOLE authoritative source of "how strongly must field X be
 * present for product family F". Future work packages (sufficiency assessment,
 * completeness wiring, quality gates) MUST read requirement levels from here and
 * MUST NOT re-declare per-family requirement tables elsewhere. Duplicating this
 * matrix is a correctness defect: two sources of truth drift silently.
 *
 * The matrix is deterministic and pure (no I/O, no randomness, no clock). It
 * reuses the existing {@link ProductFamily} taxonomy exported by the peer-cohort
 * module rather than inventing a second family list.
 *
 * Requirement levels are defined by the WP1 taxonomy in `./types.ts`
 * ({@link FieldRequirementLevel}). Levels express structural/semantic
 * expectations — not current value presence. Value presence is judged by
 * `assessIngredientSufficiency` and, later, the completeness engine.
 *
 * Foundation rules baked into the matrix:
 * - `category`, `name`, `basePrice` are REQUIRED for every family (a product is
 *   not addressable/writable without them).
 * - `menuNumber` is EXPECTED for every family: the canonical schema keeps
 *   `sourceMenuNumber` / `assignedMenuNumber` optional, so a missing number is a
 *   completeness gap, never a hard block.
 * - Drinks are non-food: ingredients and priced additions are NOT_APPLICABLE /
 *   FORBIDDEN (Constitution `DRINKS_NO_FOOD_EXTRAS`).
 * - A combo Menu is a combo product: `comboComponents` REQUIRED and `variants`
 *   FORBIDDEN (Constitution `MENU_IS_COMBO_NOT_VARIANT`).
 */

import type { FieldRequirementLevel } from "./types.js";
import type { ProductFamily } from "./peerCohorts.js";

/**
 * Fields governed by the requirement matrix — one entry per canonical product
 * field the completeness engine reasons about.
 */
export type FieldName =
  | "category"
  | "name"
  | "menuNumber"
  | "basePrice"
  | "variants"
  | "ingredients"
  | "description"
  | "additions"
  | "additionPrices"
  | "productChoices"
  | "comboComponents";

/** Ordered list of every governed field (used for exhaustive iteration). */
export const ALL_FIELD_NAMES: readonly FieldName[] = [
  "category",
  "name",
  "menuNumber",
  "basePrice",
  "variants",
  "ingredients",
  "description",
  "additions",
  "additionPrices",
  "productChoices",
  "comboComponents",
];

/**
 * Baseline requirement for every field before family-specific refinement.
 * Chosen so that food families land on the conservative food default and then
 * only explicitly overridden where the taxonomy/Constitution differs.
 */
const DEFAULT_MATRIX: Record<FieldName, FieldRequirementLevel> = {
  category: "REQUIRED",
  name: "REQUIRED",
  menuNumber: "EXPECTED",
  basePrice: "REQUIRED",
  variants: "CONDITIONAL",
  ingredients: "REQUIRED",
  description: "EXPECTED",
  additions: "EXPECTED",
  additionPrices: "CONDITIONAL",
  productChoices: "NOT_APPLICABLE",
  comboComponents: "NOT_APPLICABLE",
};

/**
 * Family-specific refinements layered on top of {@link DEFAULT_MATRIX}.
 *
 * Typed as a full `Record<ProductFamily, …>` so that adding a new family to the
 * taxonomy forces an explicit decision here (compile-time exhaustiveness).
 */
const FAMILY_REQUIREMENT_OVERRIDES: Record<
  ProductFamily,
  Partial<Record<FieldName, FieldRequirementLevel>>
> = {
  // Burgers of every flavour share one build: protein + description + paid
  // extras are expected; a burger is never a combo and never carries choices.
  BURGER: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "NOT_APPLICABLE",
    comboComponents: "NOT_APPLICABLE",
  },
  BACON_BURGER: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "NOT_APPLICABLE",
    comboComponents: "NOT_APPLICABLE",
  },
  CHEESE_BURGER: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "NOT_APPLICABLE",
    comboComponents: "NOT_APPLICABLE",
  },
  SANDWICH: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "NOT_APPLICABLE",
    comboComponents: "NOT_APPLICABLE",
  },
  // Pizza-line products vary by size (Alm./Familie/Deep Pan) → variants EXPECTED.
  PIZZA: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    variants: "EXPECTED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    productChoices: "CONDITIONAL",
    comboComponents: "NOT_APPLICABLE",
  },
  SALATPIZZA: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    variants: "EXPECTED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    productChoices: "CONDITIONAL",
    comboComponents: "NOT_APPLICABLE",
  },
  CALZONE: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    variants: "EXPECTED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    productChoices: "CONDITIONAL",
    comboComponents: "NOT_APPLICABLE",
  },
  // Wraps are filling-qualified (Constitution CATEGORY_QUALIFIED_PRODUCT_NAME)
  // and may offer a choose-meat ProductChoice.
  DURUM: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "CONDITIONAL",
    comboComponents: "NOT_APPLICABLE",
  },
  PITA: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "CONDITIONAL",
    comboComponents: "NOT_APPLICABLE",
  },
  PASTA: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    // WP5 correction (Architect ruling): plated pasta is sold complete as-is in
    // Danish takeaway convention; customer configuration lives in productChoices.
    additions: "OPTIONAL",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "OPTIONAL",
    comboComponents: "NOT_APPLICABLE",
  },
  // Indian mains commonly offer choose-meat / choose-rice+naan (Constitution
  // PRODUCT_CHOICE explicitly names choose-rice-naan).
  INDIAN_MAIN: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    // WP5 correction (Architect ruling): plated curry/wok/pad-thai dishes are
    // sold complete as-is; customer configuration lives in productChoices
    // (protein/starch choice), not a Tilbehør addition list.
    additions: "OPTIONAL",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "CONDITIONAL",
    comboComponents: "NOT_APPLICABLE",
  },
  // Sides: description is helpful but not mandatory; dips are commonly offered.
  FRIES: {
    ingredients: "REQUIRED",
    description: "EXPECTED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "NOT_APPLICABLE",
    comboComponents: "NOT_APPLICABLE",
  },
  NACHOS: {
    ingredients: "REQUIRED",
    description: "EXPECTED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "NOT_APPLICABLE",
    comboComponents: "NOT_APPLICABLE",
  },
  SUSHI: {
    ingredients: "REQUIRED",
    description: "REQUIRED",
    // WP5 correction (Architect ruling): plated sushi sets are sold complete
    // as-is; there is no evidence-generation path for sushi additions, so an
    // EXPECTED requirement would be an unfulfillable gap.
    additions: "OPTIONAL",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "CONDITIONAL",
    comboComponents: "NOT_APPLICABLE",
  },
  // Drinks are non-food: no ingredient representation and no food extras
  // (Constitution DRINKS_NO_FOOD_EXTRAS). Size variants are common but optional.
  DRINK: {
    ingredients: "NOT_APPLICABLE",
    description: "OPTIONAL",
    additions: "FORBIDDEN",
    additionPrices: "NOT_APPLICABLE",
    variants: "CONDITIONAL",
    productChoices: "OPTIONAL",
    comboComponents: "NOT_APPLICABLE",
  },
  // A combo/menu is a product containing other products. Contents live in
  // comboComponents; it is NEVER a size/price variant (MENU_IS_COMBO_NOT_VARIANT).
  COMBO_MENU: {
    ingredients: "OPTIONAL",
    description: "EXPECTED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    // WP5 correction (Architect ruling): MENU_IS_COMBO_NOT_VARIANT forbids a
    // 'Menu'/'Menü' being offered as a variant NAME on another product — it does
    // NOT forbid a combo having legitimate size variants (Alm./Familie). The
    // forbidden-name invariant is enforced separately via
    // `isForbiddenMenuVariantName` in MenuQualityContract, so the requirement
    // level is CONDITIONAL rather than FORBIDDEN. (CONDITIONAL has no trigger
    // evaluator yet; downstream treats it as non-gating — known limitation.)
    variants: "CONDITIONAL",
    productChoices: "CONDITIONAL",
    comboComponents: "REQUIRED",
  },
  OTHER_FOOD: {
    ingredients: "REQUIRED",
    description: "EXPECTED",
    additions: "EXPECTED",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "NOT_APPLICABLE",
    comboComponents: "NOT_APPLICABLE",
  },
  // Unclassifiable product: cannot assert any family-specific requirement.
  // Nothing is FORBIDDEN and nothing is NOT_APPLICABLE beyond the universal
  // fields, so unresolved input escalates to review rather than fabricating.
  UNKNOWN: {
    ingredients: "CONDITIONAL",
    description: "OPTIONAL",
    additions: "CONDITIONAL",
    additionPrices: "CONDITIONAL",
    variants: "CONDITIONAL",
    productChoices: "OPTIONAL",
    comboComponents: "CONDITIONAL",
  },
};

/**
 * Reserved subtype refinements.
 *
 * Intentionally empty in WP2: the authoritative subtype taxonomy is not yet
 * frozen, and the Constitution forbids inventing policy without evidence. The
 * lookup exists so a later WP adds rows here instead of forking the matrix.
 */
const SUBTYPE_REQUIREMENT_OVERRIDES: Readonly<
  Record<string, Partial<Record<FieldName, FieldRequirementLevel>>>
> = {};

function resolveSubtypeOverrides(
  family: ProductFamily,
  subtype: string | undefined,
): Partial<Record<FieldName, FieldRequirementLevel>> {
  const key = `${family}:${(subtype ?? "").trim().toUpperCase()}`;
  return SUBTYPE_REQUIREMENT_OVERRIDES[key] ?? {};
}

/**
 * Resolve the requirement level of every governed field for a product family.
 *
 * Pure and deterministic: the same `(family, subtype)` always yields the same
 * levels, and the returned object is a fresh copy the caller may mutate without
 * corrupting the module-level matrix.
 *
 * @param family  Product family from the single peer-cohort taxonomy.
 * @param subtype Optional subtype refinement; no refinements are defined in WP2.
 * @returns Complete field → requirement mapping (never partial).
 */
export function getFieldRequirements(
  family: ProductFamily,
  subtype?: string,
): Record<FieldName, FieldRequirementLevel> {
  const merged: Record<FieldName, FieldRequirementLevel> = { ...DEFAULT_MATRIX };

  const familyOverrides = FAMILY_REQUIREMENT_OVERRIDES[family];
  for (const field of ALL_FIELD_NAMES) {
    const value = familyOverrides[field];
    if (value !== undefined) merged[field] = value;
  }

  const subtypeOverrides = resolveSubtypeOverrides(family, subtype);
  for (const field of ALL_FIELD_NAMES) {
    const value = subtypeOverrides[field];
    if (value !== undefined) merged[field] = value;
  }

  return merged;
}
