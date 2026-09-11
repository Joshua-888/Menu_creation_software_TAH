/**
 * Strict menu-number parsing for scanned menus.
 * Period anchors ≈ menu numbers; comma tokens ≈ prices.
 * Reject OCR price garbage (II5, I15) as menu numbers.
 */

const PRICE_OCR_GARBAGE = /^(?:I{2,}|Il|I)\d+$/i;
const ROMANISH_ELEVEN = /^(?:II|Il)$/i;

export function isPriceCommaToken(token: string): boolean {
  return /^\d{1,4},-?$/.test(token.trim());
}

export function parseMenuNumberFromAnchor(raw: string): string | null {
  const trimmed = raw.trim();
  if (isPriceCommaToken(trimmed)) return null;

  let s = trimmed.replace(/[.,:]+$/g, "");
  if (PRICE_OCR_GARBAGE.test(s)) return null;

  if (ROMANISH_ELEVEN.test(s)) return "11";
  if (/^I2$/i.test(s)) return "12";

  // OCR "2.2" / "2.2.." → 22
  const dotted = trimmed.replace(/\.+$/, "");
  if (/^\d\.\d+$/.test(dotted)) {
    const collapsed = dotted.replace(/\./g, "");
    if (/^\d{2,3}$/.test(collapsed)) {
      const n = Number(collapsed);
      if (n >= 1 && n <= 99) return String(n);
    }
  }

  const m = s.match(/^(\d{1,3})([A-Za-z])?$/);
  if (!m) return null;
  const digits = m[1]!;
  const letter = m[2];
  const n = Number(digits);
  if (!letter && n >= 100) return null;
  if (letter) {
    // Preserve source case for 32b vs 32C
    return `${digits}${letter}`;
  }
  return digits;
}

export function extractMenuNumberFromLine(line: string): {
  menuNumber: string;
  rest: string;
} | null {
  // Explicit OCR forms for 11/12 before generic patterns
  const i2 = line.match(/^\s*I2\s*\.+\s*(.*)$/i);
  if (i2) return { menuNumber: "12", rest: i2[1] ?? "" };
  const il = line.match(/^\s*Il\s*\.+\s*(.*)$/i);
  if (il) return { menuNumber: "11", rest: il[1] ?? "" };
  const ii = line.match(/^\s*II\s*\.+\s*(.*)$/i);
  if (ii) return { menuNumber: "11", rest: ii[1] ?? "" };

  // Try dotted compound (2.2 → 22) BEFORE plain digit
  const dotted = line.match(/^\s*(\d\.\d+)\.+\s*(.*)$/);
  if (dotted) {
    const parsed = parseMenuNumberFromAnchor(dotted[1]!);
    if (parsed) return { menuNumber: parsed, rest: dotted[2] ?? "" };
  }

  const period = line.match(
    /^\s*[|¦]?\s*(\d{1,2}[A-Za-z]?)\s*\.{1,2}\s*(.*)$/,
  );
  if (period) {
    const parsed = parseMenuNumberFromAnchor(period[1]!);
    if (parsed) return { menuNumber: parsed, rest: period[2] ?? "" };
  }
  // Alphanumeric with OCR comma: "32C," / "32b,"
  const alphaComma = line.match(/^\s*(\d{1,2}[A-Za-z])\s*,\s*(.*)$/);
  if (alphaComma) {
    const parsed = parseMenuNumberFromAnchor(alphaComma[1]!);
    if (parsed) return { menuNumber: parsed, rest: alphaComma[2] ?? "" };
  }
  return null;
}

function looksLikeWeakTitle(t: string): boolean {
  if (/^\d+\s*,/.test(t)) return true;
  if (/^(alm\.?|familie|lille|stor|menu|ekstra)/i.test(t)) return true;
  if (
    /tomat|ost,|salat|dressing|mayonnaise|guacamole|creme/i.test(t) &&
    !/sandwich|burger|pizza|dürüm|durum|nachos/i.test(t)
  ) {
    return true;
  }
  // Single short fragment (e.g. "frites") is not a product title
  if (t.split(/\s+/).filter(Boolean).length < 2 && t.length < 14) return true;
  return !/[A-Za-zÆØÅæøå]{3,}/.test(t);
}

/**
 * OCR sometimes writes menu numbers as "51," alone.
 * Accept when an adjacent line is a real product title (prev or next).
 */
export function extractAloneCommaMenuNumber(
  line: string,
  nextLine: string | undefined,
  prevLine?: string | undefined,
): { menuNumber: string; rest: string; nameFromPrev?: string } | null {
  const aloneComma = line.match(/^\s*(\d{1,2})\s*,\s*$/);
  if (!aloneComma) return null;
  const n = Number(aloneComma[1]);
  if (n < 1 || n > 70) return null;

  if (nextLine && !looksLikeWeakTitle(nextLine.trim())) {
    return { menuNumber: String(n), rest: "" };
  }
  if (prevLine && !looksLikeWeakTitle(prevLine.trim())) {
    return {
      menuNumber: String(n),
      rest: "",
      nameFromPrev: prevLine.trim(),
    };
  }
  return null;
}
