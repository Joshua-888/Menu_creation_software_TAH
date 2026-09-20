/**
 * Typed food semantic classifier — replaces scattered token blacklists as the
 * primary decision driver for quality rules.
 */

import type { ClassifiedPhrase, SemanticEntityType } from "./types.js";

const META_RE =
  /^(tilbehør|tilbehor|ekstra|extras?|valgfri(\s+\w+)?|valgbar(\s+\w+)?|tilvalg|vælg\s+mellem|ingrediens(er)?|beskrivelse|diverse|andet|review)$/i;

const PRICE_RE = /^(\d{1,4}\s*(,-|kr\.?)?|\d{2,5})$/i;

const VARIANT_RE =
  /^(alm\.?|familie|fam\.?|lille|stor|deep\s*pan|glutenfri|fuldkorn|hjemmelavet|hj\.?|normal|standard)$/i;

const CATEGORY_HINT_RE =
  /^(pizza|burgers?|grill|sandwich|durum|dürüm|pita|pasta|salat|drikke|drinks?|sodavand|menuer|indisk|sushi|fingerfood|tilbehør)$/i;

const INGREDIENT_LEXICON = new Set(
  [
    "tomat",
    "ost",
    "skinke",
    "bacon",
    "salat",
    "løg",
    "log",
    "rødløg",
    "ketchup",
    "mayo",
    "mayonnaise",
    "remoulade",
    "oksekød",
    "kylling",
    "kebab",
    "champignon",
    "ananas",
    "pepperoni",
    "agurk",
    "jalapeños",
    "jalapenos",
    "paprika",
    "oliven",
    "dressing",
    "bearnaise",
    "bearnaisesauce",
    "salatmayonnaise",
    "æg",
    "rejer",
    "tun",
    "pølse",
    "mozzarella",
    "gorgonzola",
    "parmesan",
    "basilikum",
    "oregano",
    "majs",
    "spinat",
    "avocado",
    "hummus",
    "falafel",
    "ris",
    "naan",
  ].map((s) => s.toLowerCase()),
);

/**
 * Classic pizza dish titles that also appear in the ingredient lexicon.
 * When layoutRole=product these are PRODUCT_NAME, not topping-as-name.
 */
const PIZZA_DISH_NAME_LEXICON = new Set(
  [
    "pepperoni",
    "hawaii",
    "margarita",
    "margherita",
    "vesuvio",
    "capricciosa",
    "quattro formaggi",
    "quattro stagioni",
    "calzone",
    "prosciutto",
    "diavola",
    "funghi",
    "romana",
    "napoli",
    "venezia",
    "bambino",
  ].map((s) => s.toLowerCase()),
);

const DRINK_RE =
  /\b(soda|sodavand|cola|fanta|sprite|øl|vin|juice|kaffe|\bte\b|vand|kildevand|milkshake)\b/i;

const COMBO_RE = /^(menu|menü|menuer)$/i;

const PRODUCT_NAME_HINT_RE =
  /\b(burger|pizza|pita|dürüm|durum|sandwich|pasta|calzone|salatpizza|kebab|nuggets?|nachos|sushi)\b|(bacon|cheese)?burgers?/i;

function normalizePhrase(raw: string): string {
  return raw
    .trim()
    .replace(/^[-–—•]\s*/, "")
    .replace(/\s+/g, " ");
}

/**
 * Classify a single extracted phrase into a SemanticEntityType.
 * Context (layout role) may refine COMBO_COMPONENT vs PRODUCT_NAME.
 */
export function classifyPhrase(
  rawText: string,
  context?: {
    layoutRole?: "heading" | "product" | "price_column" | "ingredient_line" | "unknown";
    parentProductName?: string;
  },
): ClassifiedPhrase {
  const raw = rawText ?? "";
  const normalizedText = normalizePhrase(raw);
  const lower = normalizedText.toLowerCase();

  if (!normalizedText) {
    return {
      rawText: raw,
      normalizedText: "",
      entityType: "UNKNOWN",
      confidence: 0,
      reason: "empty",
    };
  }

  if (PRICE_RE.test(normalizedText) || context?.layoutRole === "price_column") {
    return {
      rawText: raw,
      normalizedText,
      entityType: "PRICE",
      confidence: 0.95,
      reason: "price_pattern",
    };
  }

  if (META_RE.test(normalizedText) || /\bvalgfri\s+dyppelse\b/i.test(normalizedText)) {
    return {
      rawText: raw,
      normalizedText,
      entityType: "META_INSTRUCTION",
      confidence: 0.98,
      reason: "meta_instruction_lexicon",
    };
  }

  if (COMBO_RE.test(normalizedText)) {
    return {
      rawText: raw,
      normalizedText,
      entityType: "COMBO_CONTEXT",
      confidence: 0.97,
      reason: "menu_combo_token",
    };
  }

  if (VARIANT_RE.test(normalizedText)) {
    return {
      rawText: raw,
      normalizedText,
      entityType: "VARIANT",
      confidence: 0.92,
      reason: "variant_lexicon",
    };
  }

  if (
    context?.layoutRole === "heading" ||
    (context?.layoutRole !== "ingredient_line" &&
      CATEGORY_HINT_RE.test(normalizedText) &&
      !PRODUCT_NAME_HINT_RE.test(normalizedText))
  ) {
    return {
      rawText: raw,
      normalizedText,
      entityType: "CATEGORY",
      confidence: context?.layoutRole === "heading" ? 0.9 : 0.75,
      reason: "category_heading",
    };
  }

  if (context?.layoutRole === "ingredient_line") {
    // Ingredient-line context wins over category/product-name ambiguity.
    // Wrap fillings (kebab) and wrap bread are components, not new product titles.
    if (
      INGREDIENT_LEXICON.has(lower) ||
      /^(pasta|ost|bacon|æg|egg|parmesan|kødsovs|kødsauce|ris|naan|skinke|salat|tomat|løg|kebab|falafel)$/i.test(
        normalizedText,
      ) ||
      /\b(pitabrød|pita\s*brød|durumbrød)\b/i.test(normalizedText)
    ) {
      return {
        rawText: raw,
        normalizedText,
        entityType: "INGREDIENT",
        confidence: 0.92,
        reason: "ingredient_line_context",
      };
    }
    if (
      /\b(sodavand|cola|fanta|sprite|pommes|pomfrit+er?|frites|nuggets?)\b/i.test(
        normalizedText,
      )
    ) {
      return {
        rawText: raw,
        normalizedText,
        entityType: context?.parentProductName ? "COMBO_COMPONENT" : "INGREDIENT",
        confidence: 0.9,
        reason: "combo_component_on_ingredient_line",
      };
    }
  }

  // Pizza dish titles that overlap ingredient lexicon (e.g. Pepperoni)
  if (
    context?.layoutRole === "product" &&
    PIZZA_DISH_NAME_LEXICON.has(lower)
  ) {
    return {
      rawText: raw,
      normalizedText,
      entityType: "PRODUCT_NAME",
      confidence: 0.93,
      reason: "pizza_dish_name_lexicon",
    };
  }

  if (INGREDIENT_LEXICON.has(lower)) {
    // Single known ingredient token — never promote to product name
    if (
      !PRODUCT_NAME_HINT_RE.test(normalizedText) &&
      !PIZZA_DISH_NAME_LEXICON.has(lower) &&
      normalizedText.split(/\s+/).length <= 2
    ) {
      return {
        rawText: raw,
        normalizedText,
        entityType: "INGREDIENT",
        confidence: 0.9,
        reason: "ingredient_lexicon",
      };
    }
  }

  if (DRINK_RE.test(normalizedText) && !PRODUCT_NAME_HINT_RE.test(normalizedText)) {
    return {
      rawText: raw,
      normalizedText,
      entityType: "PRODUCT_NAME",
      confidence: 0.7,
      reason: "drink_product_hint",
    };
  }

  if (PRODUCT_NAME_HINT_RE.test(normalizedText) || context?.layoutRole === "product") {
    return {
      rawText: raw,
      normalizedText,
      entityType: "PRODUCT_NAME",
      confidence: 0.85,
      reason: "product_name_pattern",
    };
  }

  // "Pommes frites" — product or combo component depending on structure
  if (/\bpommes(\s*frites)?\b/i.test(normalizedText)) {
    return {
      rawText: raw,
      normalizedText,
      entityType: context?.parentProductName ? "COMBO_COMPONENT" : "PRODUCT_NAME",
      confidence: 0.8,
      reason: "fries_structural",
    };
  }

  if (/^(vælg|choose)\b/i.test(normalizedText)) {
    return {
      rawText: raw,
      normalizedText,
      entityType: "PRODUCT_CHOICE",
      confidence: 0.88,
      reason: "choice_prompt",
    };
  }

  return {
    rawText: raw,
    normalizedText,
    entityType: "UNKNOWN",
    confidence: 0.4,
    reason: "unclassified",
  };
}

export function isInvalidProductNameEntity(entityType: SemanticEntityType): boolean {
  return (
    entityType === "INGREDIENT" ||
    entityType === "META_INSTRUCTION" ||
    entityType === "PRICE" ||
    entityType === "CATEGORY" ||
    entityType === "COMBO_CONTEXT"
  );
}

export function isInvalidIngredientEntity(entityType: SemanticEntityType): boolean {
  return (
    entityType === "META_INSTRUCTION" ||
    entityType === "PRODUCT_NAME" ||
    entityType === "CATEGORY" ||
    entityType === "PRICE" ||
    entityType === "COMBO_CONTEXT" ||
    entityType === "VARIANT"
  );
}

export function isInvalidAdditionEntity(entityType: SemanticEntityType): boolean {
  return (
    entityType === "META_INSTRUCTION" ||
    entityType === "CATEGORY" ||
    entityType === "PRICE" ||
    entityType === "COMBO_CONTEXT" ||
    entityType === "PRODUCT_CHOICE"
  );
}

/** Classify many phrases (e.g. OCR lines). */
export function classifyPhrases(
  phrases: string[],
  context?: Parameters<typeof classifyPhrase>[1],
): ClassifiedPhrase[] {
  return phrases.map((p) => classifyPhrase(p, context));
}

/* =========================================================================
 * Unified classification surface for Semantic Completeness Engine (WP1)
 * -------------------------------------------------------------------------
 * This section is intentionally ADDITIVE and behavior-preserving. It does
 * not change, rename, or remove any existing export or predicate logic.
 *
 * WP2+ will consume one cohesive `EntityClassifier` namespace instead of
 * re-deriving the same entity-validity concepts across modules. Each member
 * is a direct reference to the existing predicate/classifier function, so
 * behavior is identical to calling the underlying function directly.
 * ========================================================================= */

/**
 * Unified classification surface for the Semantic Completeness Engine.
 *
 * Every member is the exact existing function, re-exposed under one object so
 * later work packages have a single classification entry point. This is not a
 * new implementation and must not diverge from the functions it references.
 */
export const EntityClassifier = {
  /** Classify one phrase into a SemanticEntityType (see {@link classifyPhrase}). */
  classifyPhrase,
  /** Classify many phrases (see {@link classifyPhrases}). */
  classifyPhrases,
  /** True when the entity type cannot be a product name. */
  isInvalidProductName: isInvalidProductNameEntity,
  /** True when the entity type cannot be an ingredient. */
  isInvalidIngredient: isInvalidIngredientEntity,
  /** True when the entity type cannot be an addition. */
  isInvalidAddition: isInvalidAdditionEntity,
} as const;

export type EntityClassifierSurface = typeof EntityClassifier;
