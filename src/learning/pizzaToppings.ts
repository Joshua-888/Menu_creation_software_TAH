/**
 * Recover pizza/calzone toppings from source description → ingredient rows.
 * Mayo/ketchup Tilbehør stays as additions (never ingredients).
 */

import {
  categoryExpectsListedIngredients,
} from "../domain/ingredients.js";
import { formatIngredientDisplay } from "../domain/textNormalize.js";
import { isDipAddition } from "./categoryLikelihood.js";
import { classifyProductKind } from "./categoryLikelihood.js";
import { splitGluedFoodToken, isInvalidFoodComponent } from "../domain/menuCardQuality.js";

export type PizzaToppingProposal = {
  ingredients: string[];
  excludedDips: string[];
  source: "DESCRIPTION_LIST";
  reason: string;
};

const LIST_SPLIT = /\s*(?:,|;|\||\bog\b)\s+/i;

/** Split a Danish-style topping list; drop empties, dips, and junk. */
export function parseToppingListFromDescription(
  description: string,
): { toppings: string[]; excludedDips: string[] } {
  const raw = description.trim();
  if (!raw) return { toppings: [], excludedDips: [] };

  // Prefer the clause that looks like a toppings list (comma-heavy).
  const candidates = [raw, ...raw.split(/[.!?]\s+/)].filter(Boolean);
  let best = raw;
  let bestScore = -1;
  for (const c of candidates) {
    const commas = (c.match(/,/g) ?? []).length;
    if (commas > bestScore) {
      bestScore = commas;
      best = c;
    }
  }
  if (bestScore < 1 && !/\bog\b/i.test(best)) {
    return { toppings: [], excludedDips: [] };
  }

  const parts = best
    .split(LIST_SPLIT)
    .map((p) => p.replace(/^[-–•]+\s*/, "").trim())
    .filter(Boolean);

  const toppings: string[] = [];
  const excludedDips: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (isDipAddition(part)) {
      excludedDips.push(formatIngredientDisplay(part) || part);
      continue;
    }
    // Skip price-only / garbage tokens
    if (/^\d+([.,]\d+)?$/.test(part)) continue;
    if (/^(inkl\.?|med|menu|alm\.?)$/i.test(part)) continue;
    for (const piece of splitGluedFoodToken(part)) {
      const formatted = formatIngredientDisplay(piece);
      if (!formatted || formatted.length < 2) continue;
      if (isInvalidFoodComponent(formatted)) continue;
      const key = formatted.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      toppings.push(formatted);
    }
  }

  return { toppings, excludedDips };
}

export function productLooksPizzaLike(input: {
  name: string;
  categoryName?: string;
}): boolean {
  if (input.categoryName && categoryExpectsListedIngredients(input.categoryName)) {
    return true;
  }
  const kind = classifyProductKind({
    name: input.name,
    ...(input.categoryName ? { categoryNames: [input.categoryName] } : {}),
  });
  return kind === "pizza";
}

/**
 * Propose ingredients when pizza-like product has none but description lists toppings.
 * Never invents — empty description / no list → null.
 */
export function proposePizzaToppingsFromDescription(input: {
  name: string;
  categoryName?: string;
  description?: string | null;
  existingIngredients?: readonly string[];
}): PizzaToppingProposal | null {
  if (
    input.existingIngredients &&
    input.existingIngredients.some((i) => i.trim().length > 0)
  ) {
    return null;
  }
  if (
    !productLooksPizzaLike({
      name: input.name,
      ...(input.categoryName ? { categoryName: input.categoryName } : {}),
    })
  ) {
    return null;
  }
  const desc = (input.description ?? "").trim();
  if (!desc) return null;

  const { toppings, excludedDips } = parseToppingListFromDescription(desc);
  if (toppings.length === 0) return null;

  return {
    ingredients: toppings,
    excludedDips,
    source: "DESCRIPTION_LIST",
    reason: `Recovered ${toppings.length} toppings from description; excluded dips: ${excludedDips.join(", ") || "(none)"}`,
  };
}
