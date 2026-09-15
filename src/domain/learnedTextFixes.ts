/**
 * Runtime-learned OCR ingredient substitutions (restaurant/global human rules).
 * Base fixes live in textNormalize; these are appended after human corrections.
 */

export type OcrIngredientFix = [RegExp, string];

const learned: OcrIngredientFix[] = [];

export function getLearnedOcrIngredientFixes(): readonly OcrIngredientFix[] {
  return learned;
}

/** Register a durable OCR→display fix from a human restaurant/global rule. */
export function registerOcrIngredientFix(fromWord: string, to: string): void {
  const word = fromWord.trim();
  const target = to.trim();
  if (!word || !target) return;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "gi");
  // Replace existing learned entry for same pattern source
  const idx = learned.findIndex((f) => f[0].source === re.source);
  if (idx >= 0) learned[idx] = [re, target];
  else learned.push([re, target]);
}

/** Test helper — clear learned fixes between tests. */
export function clearLearnedOcrIngredientFixes(): void {
  learned.length = 0;
}
