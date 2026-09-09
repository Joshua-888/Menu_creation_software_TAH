/**
 * Deterministic destination money/text normalization.
 * Does not reinterpret surcharge vs absolute — that is contract semantics.
 */
export function parseAdminPriceToOre(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Accept "99", "99.00", "99,00"
  const normalized = trimmed.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const kroner = Number(normalized);
  if (Number.isNaN(kroner)) return null;
  return Math.round(kroner * 100);
}

export function normalizeWhitespace(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.replace(/\s+/g, " ").trim();
}

export function checkboxToBoolean(
  checked: boolean | null | undefined,
): boolean | null {
  if (checked === null || checked === undefined) return null;
  return checked;
}
