/**
 * MenuConstitutionV1 — global invariants (not probabilities, not restaurant-specific).
 */

import type { PolicyLifecycleRecord } from "./types.js";

export const MENU_CONSTITUTION_VERSION = "MenuConstitutionV1";

export const MENU_CONSTITUTION = {
  version: MENU_CONSTITUTION_VERSION,
  activatedAt: "2026-09-16",
  invariants: {
    PRODUCT_NAME: {
      id: "PRODUCT_NAME",
      rule: "A product name must represent an actual menu item — never ingredient-only, category heading, price, meta instruction, or OCR garbage.",
      invalidExamples: [
        "Tomat",
        "Tilbehør",
        "Valgfri dyppelse",
        "Vælg mellem",
        "Menu",
      ],
    },
    CATEGORY_QUALIFIED_PRODUCT_NAME: {
      id: "CATEGORY_QUALIFIED_PRODUCT_NAME_V1",
      rule: "GLOBAL: For semantic families SALAD/PITA/DURUM/ROLL/PIZZA_SANDWICH/SANDWICH/BAGEL, filling-only product names must be receipt-qualified as \"<Product type> m. <name>\" so kitchen receipts remain unambiguous without category context. Already self-describing names are preserved. Idempotent. Scope GLOBAL — never merchant-specific.",
      examples: [
        "Salater + Tun → Salat m. Tun",
        "Pita + Kebab → Pita m. Kebab",
        "Græsk Salat → unchanged",
      ],
    },
    CATEGORY: {
      id: "CATEGORY",
      rule: "Category must semantically fit products. Prefer explicit source branding (e.g. Smash Burgers). Do not place burgers under Grill merely from a generic cooking-method mapping when product-family evidence supports Burgers.",
    },
    MENU_IS_COMBO_NOT_VARIANT: {
      id: "MENU_IS_COMBO_NOT_VARIANT",
      rule: '"Menu" / "Menü" is NEVER a size/price variant. A Menu is a COMBO / MENU PRODUCT. Do not invent combo contents. If components unknown → COMBO_SEMANTICS_UNRESOLVED (review), never Menu-as-variant.',
      supersedes: ["MENU_AS_VARIANT"],
    },
    VARIANT: {
      id: "VARIANT",
      rule: "Variants describe true variants (Alm., Familie, Lille, Stor, Deep Pan, Glutenfri, Fuldkorn, sizes). Open-ended — no whitelist. ProductChoice ≠ Variant ≠ Ingredient ≠ Addition.",
    },
    PRODUCT_CHOICE: {
      id: "PRODUCT_CHOICE",
      rule: "ProductChoice is choose-meat / choose-rice-naan / choose-pizza / choose-drink — not a variant, ingredient, or addition.",
    },
    INGREDIENT: {
      id: "INGREDIENT",
      rule: "Every FOOD product must end with a professional ingredient representation. Priority: explicit source → human-approved facts → strong peer subtype → product-family → conservative domain prior. Every inferred ingredient carries provenance.",
      invalidExamples: [
        "Tilbehør",
        "Tilbehor",
        "Menu",
        "Valgfri dyppelse",
        "Skinkeog ananas",
      ],
    },
    DESCRIPTION: {
      id: "DESCRIPTION",
      rule: "For food products, description is generated from the normalized final ingredient representation unless an explicit restaurant formatting policy says otherwise. Professional Danish grammar. No OCR garbage, price leaks, or glued tokens.",
    },
    ADDITIONS: {
      id: "ADDITIONS",
      rule: "An addition must be a real selectable food/add-on. Candidate pool = validated category ingredient union + source-supported + restaurant facts + peer-supported, then semantic filter. Never product titles, category titles, meta labels, pommes-as-generic-addition, or drinks as food additions.",
    },
    DRINKS_NO_FOOD_EXTRAS: {
      id: "DRINKS_NO_FOOD_EXTRAS",
      rule: "Drinks cannot inherit food dips / mayo / ketchup / remoulade / burger extras. This rule MUST NOT depend on whether an optional peer probability artifact was loaded.",
    },
    ADDITION_PRICING: {
      id: "ADDITION_PRICING",
      rule: "Price priority: explicit source → restaurant-approved fact → peer benchmark (same addition + product family) → category/family benchmark. No arbitrary fixed 10 DKK fallback unless explicitly approved as global policy. Peer evidence reports N, median, distribution, restaurants, confidence.",
    },
    FOOD_COMPLETENESS: {
      id: "FOOD_COMPLETENESS",
      rule: "Empty ingredient list on a FOOD product must never silently pass. Attempt source → facts → peer → family → prior; if still insufficient → QUALITY_REVIEW. Do not write incomplete food cards.",
    },
    WRITE_GATE: {
      id: "WRITE_GATE",
      rule: "Only QUALITY_READY products may enter executable CREATE/UPDATE. QUALITY_REVIEW and QUALITY_BLOCKED never write. Prefer BLOCKED with explanation over WRONG live menu.",
    },
  },
} as const;

/** Lifecycle: MENU_AS_VARIANT superseded by constitution combo rule. */
export const MENU_AS_VARIANT_SUPERSESSION: PolicyLifecycleRecord = {
  policyId: "MENU_AS_VARIANT",
  status: "SUPERSEDED",
  replacementPolicyId: "MENU_IS_COMBO_NOT_VARIANT",
  reason:
    "MenuConstitutionV1: Menu/Menü is a combo/menu product concept, never a size/price variant.",
  date: "2026-09-16",
  version: MENU_CONSTITUTION_VERSION,
};

export const ACTIVE_CONSTITUTION_POLICIES = [
  "MENU_IS_COMBO_NOT_VARIANT",
  "DRINKS_NO_FOOD_EXTRAS",
  "FOOD_COMPLETENESS",
  "PRODUCT_NAME_VALID",
  "CATEGORY_QUALIFIED_PRODUCT_NAME_V1",
  "INGREDIENT_PROVENANCE",
] as const;

export function isConstitutionCompatiblePolicy(policyId: string): boolean {
  if (policyId === "MENU_AS_VARIANT") return false;
  return true;
}
