/**
 * Deterministic price-structure semantics (no invented amounts).
 */

import { kronerToMinor, reconcileVariantTotals } from "./facts.js";

export type AlmFamilieInterpretation = {
  basePriceMinor: number;
  almSurchargeMinor: number;
  familieSurchargeMinor: number;
  reconciled: boolean;
};

/** Alm. X / Familie Y → base=X, Familie surcharge = Y−X (øre). */
export function interpretAlmFamilieTotals(input: {
  almTotalKroner: number;
  familieTotalKroner: number;
}): AlmFamilieInterpretation {
  const base = kronerToMinor(input.almTotalKroner);
  const familieTotal = kronerToMinor(input.familieTotalKroner);
  const familieSurcharge = familieTotal - base;
  const check = reconcileVariantTotals({
    baseMinor: base,
    surchargeMinor: familieSurcharge,
    sourceTotalMinor: familieTotal,
  });
  return {
    basePriceMinor: base,
    almSurchargeMinor: 0,
    familieSurchargeMinor: familieSurcharge,
    reconciled: check.ok,
  };
}

/** Explicit "+X" surcharge token → addition/surcharge minor units. */
export function interpretExplicitPlusSurcharge(
  text: string,
): { amountMinor: number } | null {
  const m = text.match(/\+\s*(\d{1,4})\b/);
  if (!m) return null;
  return { amountMinor: kronerToMinor(Number(m[1])) };
}

export type PriceCorrectionRecord = {
  menuNumber: string;
  restaurantKey: string;
  originalAmountMinor: number;
  correctedAmountMinor: number;
  humanDecisionId: string;
  scope: "EXACT_PRODUCT" | "EXACT_CASE";
};
