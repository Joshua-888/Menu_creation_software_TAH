/**
 * Peer cohort evidence — restaurant diversity matters more than raw product count.
 */

import type { PeerConfidenceBand, PeerEvidenceThresholds, ProductFamily } from "./types.js";

/**
 * Single source of truth for the product-family taxonomy.
 *
 * The `ProductFamily` union is defined in `./types.ts` and consumed here; this
 * re-export lets dependent modules (e.g. the field-requirement matrix) import the
 * taxonomy from the peer-cohort module without duplicating it. Adding a family
 * means extending the union in `./types.ts` and this list together.
 */
export type { ProductFamily } from "./types.js";

/** Ordered list of every product family (drives exhaustive matrix coverage). */
export const ALL_PRODUCT_FAMILIES: readonly ProductFamily[] = [
  "BURGER",
  "BACON_BURGER",
  "CHEESE_BURGER",
  "SANDWICH",
  "PIZZA",
  "SALATPIZZA",
  "CALZONE",
  "DURUM",
  "PITA",
  "PASTA",
  "INDIAN_MAIN",
  "FRIES",
  "NACHOS",
  "SUSHI",
  "DRINK",
  "COMBO_MENU",
  "OTHER_FOOD",
  "UNKNOWN",
];

export const DEFAULT_PEER_THRESHOLDS: PeerEvidenceThresholds = {
  highMinRestaurants: 8,
  highMinProbability: 0.7,
  mediumMinRestaurants: 4,
  mediumMinProbability: 0.5,
  lowBelowRestaurants: 3,
};

export type PeerIngredientSupport = {
  name: string;
  probability: number;
  productCount: number;
  restaurantCount: number;
};

export type PeerCohortEvidence = {
  family: ProductFamily;
  subtype?: string;
  restaurants: number;
  products: number;
  ingredients: PeerIngredientSupport[];
};

export function bandPeerEvidence(
  input: {
    restaurantCount: number;
    probability: number;
    contradictionRate?: number;
  },
  thresholds: PeerEvidenceThresholds = DEFAULT_PEER_THRESHOLDS,
): PeerConfidenceBand {
  const contradiction = input.contradictionRate ?? 0;
  if (contradiction > 0.35) return "LOW";
  if (
    input.restaurantCount >= thresholds.highMinRestaurants &&
    input.probability >= thresholds.highMinProbability
  ) {
    return "HIGH";
  }
  if (
    input.restaurantCount >= thresholds.mediumMinRestaurants &&
    input.probability >= thresholds.mediumMinProbability
  ) {
    return "MEDIUM";
  }
  return "LOW";
}

/** 20 samples from 1 restaurant is weaker than 20 from 15. */
export function effectivePeerWeight(input: {
  productCount: number;
  restaurantCount: number;
}): number {
  const diversity = Math.min(1, input.restaurantCount / Math.max(1, input.productCount));
  const restaurantFactor = Math.log2(1 + input.restaurantCount);
  return input.productCount * (0.35 + 0.65 * diversity) * (restaurantFactor / 4);
}

export function inferProductFamily(input: {
  name: string;
  categoryName?: string;
  description?: string;
}): ProductFamily {
  const blob = `${input.name} ${input.categoryName ?? ""} ${input.description ?? ""}`;
  if (
    /\b(soda|sodavand|cola|fanta|sprite|øl|vin|juice|kaffe|\bte\b|iste|thai\s*iste|kildevand|\bvand\b)\b/i.test(
      blob,
    ) ||
    /^(øl|vin|cola|fanta|sprite|vand|kildevand|kaffe|te|juice)$/i.test(
      input.name.trim(),
    )
  ) {
    return "DRINK";
  }
  if (/\bmenu\b/i.test(input.name) || /menu$/i.test(input.name.trim()) || /\bmenuer?\b/i.test(input.name)) {
    // "X Menu" / "Kebabmenu" combo naming
    if (!/\bburger\b/i.test(input.name)) {
      if (/burger|pizza|kebab|pita|durum/i.test(blob)) return "COMBO_MENU";
      return "COMBO_MENU";
    }
  }
  if (/\bbacon\s*burger|baconburger\b/i.test(blob) || /baconburger/i.test(blob)) return "BACON_BURGER";
  if (/\bcheese\s*burger|cheeseburger|osteburger\b/i.test(blob)) {
    return "CHEESE_BURGER";
  }
  if (/burger/i.test(blob)) return "BURGER";
  if (/\bsalatpizza\b/i.test(blob)) return "SALATPIZZA";
  // NOTE: "indbagt" (Danish for battered/deep-fried) is a generic cooking-method
  // word used across cuisines; it is NOT a pizza/calzone signal. Only the
  // product's own calzone naming may classify it. See WP-F.
  if (/\bcalzone\b/i.test(blob)) return "CALZONE";
  if (/\bpizza\b/i.test(blob)) return "PIZZA";
  if (/\bdürüm|durum\b/i.test(blob)) return "DURUM";
  if (/\bpita\b/i.test(blob)) return "PITA";
  if (/\bpasta\b/i.test(blob)) return "PASTA";
  if (/\b(curry|tikka|masala|naan|biryani)\b/i.test(blob)) return "INDIAN_MAIN";
  if (/\b(pommes|frites|fries)\b/i.test(blob)) return "FRIES";
  if (/\bnachos\b/i.test(blob)) return "NACHOS";
  if (/\bsushi\b/i.test(blob)) return "SUSHI";
  if (/\bsandwich\b/i.test(blob)) return "SANDWICH";
  if (/\bmenuer\b/i.test(input.categoryName ?? "")) return "COMBO_MENU";
  return "OTHER_FOOD";
}

export function isFoodFamily(family: ProductFamily): boolean {
  return family !== "DRINK" && family !== "UNKNOWN";
}

export function filterPeerIngredientsByBand(
  ingredients: PeerIngredientSupport[],
  minBand: PeerConfidenceBand = "MEDIUM",
  thresholds: PeerEvidenceThresholds = DEFAULT_PEER_THRESHOLDS,
): PeerIngredientSupport[] {
  const order: PeerConfidenceBand[] = ["LOW", "MEDIUM", "HIGH"];
  const minIdx = order.indexOf(minBand);
  return ingredients.filter((ing) => {
    const band = bandPeerEvidence(
      {
        restaurantCount: ing.restaurantCount,
        probability: ing.probability,
      },
      thresholds,
    );
    return order.indexOf(band) >= minIdx;
  });
}
