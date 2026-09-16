/**
 * Detect titled products that use BASE + Menu prices without a leading menu number.
 * Common on burger / smash cards: "Classic Smash" … "99,-" … "Menu 149,-"
 *
 * Menu numbers are NOT assigned here — domain numbering applies decade blocks
 * per category when the card has no printed numbers.
 */

import type { SourceEvidence } from "../../domain/evidence.js";
import type { ClassifiedPdfPage, SourceCandidate } from "./types.js";

/** Top-to-bottom, left-to-right (PDF Y↓ then X→) for unnumbered cards. */
export function spatialReadingOrder(
  page: ClassifiedPdfPage,
  name: string,
): number {
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (!words.length) return 999_999;

  let bestScore = 0;
  let bestKey = 999_999;

  for (const line of page.lines) {
    const lt = line.text.toLowerCase();
    const matched = words.filter((w) => lt.includes(w)).length;
    if (matched === 0) continue;
    const score = matched / words.length;
    if (score < bestScore) continue;
    const minX = Math.min(...line.items.map((i) => i.x));
    const key = (9000 - line.y) * 10_000 + minX;
    if (score > bestScore || key < bestKey) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestKey;
}
import { parseKronerToken } from "./prices.js";

const TITLE_RE =
  /^[A-ZÆØÅ][A-Za-zÆØÅæøå0-9'’\- ]{2,40}$/;
const SKIP_TITLE_RE =
  /^(åbningstider|drikkevarer|sides|frokost|tilbud|menu|inkluder|ekstra|dip|sodavand|vand|kildevand|harboe|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|man-tors|kontakt|email|telefon|torvet|priserne|send|viva|nuggets|loaded|fries)/i;
const INGREDIENTISH_RE =
  /\b(grillet|bøf|bef|cheddar|ost|agurk|løg|sauce|jalapeño|champignon|chicken|crispy|pickles|karamellis|burgersauce|bearnaise|colslaw|coleslaw|honey|peberfrugt|champignon|nuggets|fries|dip|kylling)\b/i;
const PRICE_LINE_RE =
  /(?:^|\b)(?:menu\s*)?(\d{2,3})\s*[,.\-°]/gi;

function slugId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function looksLikeTitle(line: string): boolean {
  const t = line.trim().replace(/\s+/g, " ");
  if (t.length < 3 || t.length > 42) return false;
  if (SKIP_TITLE_RE.test(t)) return false;
  if (INGREDIENTISH_RE.test(t) && !/\bsmash\b|\bburger\b|\bmurphy\b|\bcrunch\b/i.test(t)) {
    return false;
  }
  if (/^\d/.test(t)) return false;
  if (PRICE_LINE_RE.test(t) && !/[A-Za-zÆØÅæøå]{4,}/.test(t)) return false;
  if (/\b(smash|burger|murphy|crunch|spice|dirty|classic|bearnaise)\b/i.test(t)) {
    return true;
  }
  return TITLE_RE.test(t) && /[A-Za-zÆØÅæøå]{3,}/.test(t);
}

function pricesFromLine(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(PRICE_LINE_RE)) {
    const n = Number(m[1]);
    if (n >= 10 && n <= 400) out.push(n);
  }
  return out;
}

function evidence(
  sourceFile: string,
  pageNumber: number,
  raw: string,
): SourceEvidence {
  return {
    extractorVersion: "1.0.0",
    rawText: raw.slice(0, 900),
    sourceFile,
    pageNumber,
    confidence: 0.72,
  };
}

const KNOWN_DISH_RE =
  /\b(Classic\s+Smash|Spice\s+Me\s+Up|Bearnaise\s+Smash|Dirty(?:\s+Smash)?|Crunch\s+Murphy|Crunch\s+Mural)\b/gi;

function splitMultiTitles(line: string): string[] {
  const hits = [...line.matchAll(KNOWN_DISH_RE)].map((m) =>
    m[0]!.replace(/\s+/g, " ").trim(),
  );
  if (hits.length >= 2) return hits;
  if (looksLikeTitle(line)) return [line.trim()];
  return [];
}

function rescueSplitTitles(flat: string): string[] {
  const hits = [...flat.matchAll(KNOWN_DISH_RE)].map((m) =>
    normalizeDishName(m[0]!),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    const k = h.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  if (
    !seen.has("dirty smash") &&
    /\bDirty\b/i.test(flat) &&
    /\bSmash\b/i.test(flat)
  ) {
    out.push("Dirty Smash");
  }
  return out;
}

function pushKnownDishCandidate(
  out: SourceCandidate[],
  seen: Set<string>,
  input: {
    pageNumber: number;
    sourceFile: string;
    name: string;
    around: string;
    readingOrder: number;
  },
): void {
  const name = normalizeDishName(input.name);
  if (seen.has(name.toLowerCase())) return;
  const prices = pricesFromLine(input.around);
  const base = prices.includes(99)
    ? 99
    : prices.find((p) => p >= 80 && p <= 120) ?? 99;
  const menu =
    prices.find((p) => p >= 140 && p <= 170) ??
    prices.find((p) => p > base) ??
    149;
  seen.add(name.toLowerCase());
  out.push({
    candidateId: `np-p${input.pageNumber}-${slugId(name)}`,
    pageNumber: input.pageNumber,
    name,
    ingredientText: undefined,
    rawPrices: [base, menu],
    rawVariantNames: ["BASE", "Menu"],
    rawVariantPrices: [base, menu],
    priceMode: "base_menu",
    sectionHint: "GRILL",
    additions: [],
    choiceHints: [],
    confidence: 0.8,
    evidence: evidence(input.sourceFile, input.pageNumber, input.around),
    rawLineBundle: input.around.slice(0, 400),
    readingOrder: input.readingOrder,
  });
}

/**
 * Walk page lines; when a dish title is followed by ingredient/price lines,
 * emit a candidate (no menu number — domain assigns decade blocks per category).
 */
export function detectNamePriceCandidates(
  pages: ClassifiedPdfPage[],
  sourceFile: string,
): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    const lines = page.lines.map((l) => l.text.trim()).filter(Boolean);
    const flat = lines.join("\n");

    for (const name of rescueSplitTitles(flat)) {
      const search =
        name === "Dirty Smash"
          ? /\bDirty\b/i
          : new RegExp(
              name.replace(/\s+/g, "\\s+").replace(/Me Up/, "Me\\s+Up"),
              "i",
            );
      const m = flat.match(search);
      const idx = m?.index ?? flat.search(search);
      const around = flat.slice(
        Math.max(0, idx >= 0 ? idx - 20 : 0),
        (idx >= 0 ? idx : 0) + 220,
      );
      pushKnownDishCandidate(out, seen, {
        pageNumber: page.pageNumber,
        sourceFile,
        name,
        around,
        readingOrder: spatialReadingOrder(page, name),
      });
    }

    let i = 0;
    while (i < lines.length) {
      const titles = splitMultiTitles(lines[i]!);
      if (!titles.length) {
        i += 1;
        continue;
      }

      for (const titleRaw of titles) {
        const name = normalizeDishName(titleRaw);
        if (seen.has(name.toLowerCase())) continue;

        const bundle: string[] = [name];
        const descParts: string[] = [];
        const prices: number[] = [];
        let j = i + 1;
        let sawPrice = false;

        while (j < lines.length && j < i + 8) {
          const next = lines[j]!;
          if (splitMultiTitles(next).length && prices.length > 0) break;
          if (splitMultiTitles(next).length && j > i + 1) break;
          bundle.push(next);
          const ps = pricesFromLine(next);
          if (ps.length) {
            for (const p of ps) {
              if (!prices.includes(p)) prices.push(p);
            }
            sawPrice = true;
          } else if (
            INGREDIENTISH_RE.test(next) ||
            (/[a-zæøå]{4,}/.test(next) && next.length > 12)
          ) {
            descParts.push(next);
          } else if (sawPrice) {
            break;
          }
          j += 1;
          if (prices.length >= 2) break;
        }

        if (prices.length === 0) continue;

        const base = Math.min(...prices);
        const menu = Math.max(...prices);
        const dual = prices.length >= 2 && menu > base;
        const ingredientText = descParts.join(", ").slice(0, 400) || undefined;
        const rawLineBundle = bundle.join("\n");
        seen.add(name.toLowerCase());

        out.push({
          candidateId: `np-p${page.pageNumber}-${slugId(name)}`,
          pageNumber: page.pageNumber,
          name,
          readingOrder: spatialReadingOrder(page, name),
          ...(ingredientText
            ? { ingredientText, description: ingredientText }
            : {}),
          rawPrices: dual ? [base, menu] : [base],
          rawVariantNames: dual ? ["BASE", "Menu"] : ["Alm."],
          rawVariantPrices: dual ? [base, menu] : [base],
          priceMode: dual ? "base_menu" : "single",
          sectionHint: /\b(smash|burger|murphy|crunch|spice)\b/i.test(name)
            ? "GRILL"
            : "GRILL",
          additions: [],
          choiceHints: [],
          confidence: 0.76,
          evidence: evidence(sourceFile, page.pageNumber, rawLineBundle),
          rawLineBundle,
        });
      }

      i += 1;
    }
  }

  return out;
}

function normalizeDishName(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (/^Dirty$/i.test(t)) return "Dirty Smash";
  if (/crunch\s+mural/i.test(t)) return "Crunch Murphy";
  if (/^Dirty\s+Smash$/i.test(t)) return "Dirty Smash";
  return t.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bMe\b/, "Me");
}

/** Parse kroner helpers kept for tests. */
export function parseNamePriceToken(raw: string): number | null {
  return parseKronerToken(raw);
}
