import { kronerToOre, type MoneyMinor } from "../../domain/money.js";
import { repairOcrPriceText } from "./priceNormalize.js";

/**
 * Parse source kroner amounts at extraction boundary.
 * Accepts "95", "95,", "95,-", "95.00", "115," OCR forms.
 */
export function parseKronerToken(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, "")
    .replace(/,-$/, "")
    .replace(/-$/, "")
    .replace(/,$/, "")
    .replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseKronerToOre(raw: string): MoneyMinor | null {
  const k = parseKronerToken(raw);
  if (k === null) return null;
  return kronerToOre(k);
}

/** Extract kroner-looking tokens from a text blob, in order. */
export function extractKronerValues(text: string): number[] {
  const repaired = repairOcrPriceText(text);
  const out: number[] = [];
  for (const m of repaired.matchAll(/\b(\d{1,4})\s*,-?(?!\d)/g)) {
    const v = parseKronerToken(m[1]!);
    if (v !== null && v >= 5 && v <= 500) out.push(v);
  }
  // also plain "75" near end of fragments without comma (Indian page)
  for (const m of repaired.matchAll(/(?:^|\s)(\d{2,3})(?=\s|$)/g)) {
    const v = parseKronerToken(m[1]!);
    if (v !== null && v >= 10 && v <= 300 && !out.includes(v)) {
      // only add if no comma-prices already dominate — keep conservative
    }
  }
  return out;
}

export function extractCommaPrices(text: string): number[] {
  const repaired = repairOcrPriceText(text);
  const out: number[] = [];
  for (const m of repaired.matchAll(/\b(\d{1,4})\s*,-?/g)) {
    const v = parseKronerToken(`${m[1]},`);
    if (v !== null && v >= 5 && v <= 500) out.push(v);
  }
  return out;
}
