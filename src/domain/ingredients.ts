import type { ValueOrigin } from "./provenance.js";
import type { CanonicalIngredient } from "./schema/canonical.js";
import type { SourceIngredient } from "./schema/source.js";

function comparisonKey(display: string): string {
  return display.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Merge category/common ingredients with product-specific ingredients.
 * Preserves logical/source order. Deduplicates case- and whitespace-insensitively.
 * Keeps the first display string and its provenance.
 * Product choices must never be passed into this function.
 */
export function composeIngredients(
  common: readonly SourceIngredient[],
  productSpecific: readonly SourceIngredient[],
): CanonicalIngredient[] {
  const result: CanonicalIngredient[] = [];
  const seen = new Set<string>();

  for (const ingredient of [...common, ...productSpecific]) {
    const key = comparisonKey(ingredient.display);
    if (key.length === 0) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const item: CanonicalIngredient = {
      display: ingredient.display,
      origin: ingredient.origin as ValueOrigin,
    };
    if (ingredient.evidence !== undefined) {
      item.evidence = ingredient.evidence;
    }
    result.push(item);
  }

  return result;
}
