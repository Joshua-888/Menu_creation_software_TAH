/**
 * Detect titled products that use BASE + Menu prices without a leading menu number.
 *
 * Merchant-agnostic: titles and ingredients come from OCR layout only.
 * Category naming / ingredient fill happen later via peer kind policies.
 *
 * Menu numbers are NOT assigned here — domain numbering applies decade blocks
 * per category when the card has no printed numbers.
 */

import type { SourceEvidence } from "../../domain/evidence.js";
import { classifyProductKind } from "../../learning/categoryLikelihood.js";
import { looksLikeOcrGarbageName } from "./renderedFallback.js";
import type { ClassifiedPdfPage, SourceCandidate } from "./types.js";
import { parseKronerToken } from "./prices.js";

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

const TITLE_RE =
  /^[A-ZÆØÅ][A-Za-zÆØÅæøå0-9'’\- ]{2,40}$/;
const SKIP_TITLE_RE =
  /^(åbningstider|drikkevarer|sides|frokost|tilbud|menu|inkluder|ekstra|dip|sodavand|vand|kildevand|harboe|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|man-tors|kontakt|email|telefon|torvet|priserne|send|viva|nuggets|loaded|fries|grill|burgers?)\b/i;
const INGREDIENTISH_RE =
  /\b(grillet|bøf|bef|cheddar|ost|agurk|løg|sauce|jalapeño|jalapenos|champignon|chicken|crispy|pickles|karamellis|burgersauce|bearnaise|colslaw|coleslaw|honey|peberfrugt|nuggets|fries|dip|kylling|syltede?)\b/i;
const PRICE_LINE_RE =
  /(?:^|\b)(?:menu\s*)?(\d{2,3})\s*[,.\-°]/gi;
const SECTION_HEADER_RE =
  /^(burgers?|grill|pizza|pasta|drikkevarer|sides|tilbehør|menuer|sandwich|durum|pita)\b/i;

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
  if (SECTION_HEADER_RE.test(t) && t.split(/\s+/).length <= 2) return false;
  if (INGREDIENTISH_RE.test(t) && t.split(/\s+/).length >= 4) {
    return false;
  }
  if (/^\d/.test(t)) return false;
  if (PRICE_LINE_RE.test(t) && !/[A-Za-zÆØÅæøå]{4,}/.test(t)) return false;
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

const PRODUCT_NOUN_RE =
  /^(smash|burger|pizza|durum|dürüm|pita|sandwich|wrap|menu)$/i;

/**
 * OCR often splits a two-word dish title across lines ("Dirty" / "Smash",
 * "Crunch" / "Murphy Sl"). Join consecutive short Title-Case fragments.
 */
export function joinTitleFragments(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const a = lines[i]!.trim();
    const b = lines[i + 1]?.trim();
    const aSingle = /^[A-ZÆØÅ][A-Za-zÆØÅæøå'’\-]+$/.test(a);
    const bFirst = b?.match(/^([A-ZÆØÅ][A-Za-zÆØÅæøå'’\-]+)/)?.[1];
    if (
      b &&
      aSingle &&
      bFirst &&
      !SKIP_TITLE_RE.test(a) &&
      !SKIP_TITLE_RE.test(bFirst) &&
      !SECTION_HEADER_RE.test(a) &&
      !SECTION_HEADER_RE.test(bFirst) &&
      !INGREDIENTISH_RE.test(a) &&
      !pricesFromLine(a).length
    ) {
      // Prefer adjective + noun ("Dirty Smash") when OCR emits noun first
      const joined =
        PRODUCT_NOUN_RE.test(a) && !PRODUCT_NOUN_RE.test(bFirst)
          ? `${bFirst} ${a}`
          : `${a} ${bFirst}`;
      out.push(joined);
      i += 2;
      continue;
    }
    out.push(a);
    i += 1;
  }
  return out;
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s+\d+\s*$/, "")
    .replace(/\s+(sl|si|oy|as)$/i, "")
    .trim();
}

/** Credible dish title — not OCR noise. Merchant-agnostic. */
export function isCredibleDishTitle(name: string): boolean {
  const t = name.trim();
  if (t.length < 3 || t.length > 42) return false;
  if (looksLikeOcrGarbageName(t)) return false;
  if (SKIP_TITLE_RE.test(t) || SECTION_HEADER_RE.test(t)) return false;
  if (/\b(ritual|ketchup|mayo|remoulade|dip)\b/i.test(t) && !PRODUCT_NOUN_RE.test(t)) {
    return false;
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1 && t.length < 7) return false;
  // Reject all-caps OCR blobs
  if (!/[a-zæøå]/.test(t) && t.replace(/[^A-ZÆØÅ]/g, "").length >= 6) {
    return false;
  }
  if (words.every((w) => /^[A-ZÆØÅ]{3,}$/.test(w)) && words.length <= 2) {
    return false;
  }
  const letters = t.replace(/[^A-Za-zÆØÅæøå]/g, "");
  if (letters.length < 4) return false;
  const vowels = (letters.match(/[aeiouyæøå]/gi) ?? []).length;
  if (vowels / letters.length < 0.2) return false;
  return true;
}

/**
 * Dominant BASE+Menu pair on the page (merchant-agnostic price-column pattern).
 */
export function dominantBaseMenuPair(flat: string): [number, number] | null {
  const all = pricesFromLine(flat.replace(/\n/g, " "));
  if (all.length < 2) return null;
  const counts = new Map<number, number>();
  for (const p of all) {
    if (p < 40 || p > 350) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (ranked.length < 2) return null;
  const a = ranked[0]![0];
  const b = ranked[1]![0];
  if (Math.abs(a - b) < 15) return null;
  return a < b ? [a, b] : [b, a];
}

function pricesNearTitle(flat: string, name: string): number[] {
  const idx = flat.toLowerCase().indexOf(name.toLowerCase());
  if (idx < 0) return [];
  return pricesFromLine(flat.slice(Math.max(0, idx - 40), idx + 280));
}

function titleHasIngredientContext(bundle: string[]): boolean {
  return bundle.some((l) => INGREDIENTISH_RE.test(l));
}

/** OCR-only ingredient capture from lines under a title (no restaurant priors). */
export function ingredientTextFromLines(
  name: string,
  lines: string[],
): string | undefined {
  const nameLower = name.toLowerCase();
  const parts: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.toLowerCase() === nameLower) continue;
    if (looksLikeTitle(t)) continue;
    if (SECTION_HEADER_RE.test(t)) continue;
    if (pricesFromLine(t).length && !INGREDIENTISH_RE.test(t)) continue;
    if (/^menu\b/i.test(t)) continue;
    if (
      INGREDIENTISH_RE.test(t) ||
      (/[a-zæøå]{4,}/.test(t) && t.length > 10 && /,/.test(t))
    ) {
      const cleaned = t
        .replace(PRICE_LINE_RE, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length >= 4) parts.push(cleaned);
    }
  }
  const joined = parts.join(", ").slice(0, 400);
  return joined.length >= 8 ? joined : undefined;
}

function sectionHintFromContext(lines: string[], titleIndex: number): string | undefined {
  for (let k = titleIndex; k >= 0 && k >= titleIndex - 12; k--) {
    const t = lines[k]!.trim();
    if (SECTION_HEADER_RE.test(t) && t.split(/\s+/).length <= 3) {
      const m = t.match(SECTION_HEADER_RE);
      if (!m) continue;
      const raw = m[1]!;
      return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    }
  }
  return undefined;
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
    const rawLines = page.lines.map((l) => l.text.trim()).filter(Boolean);
    const lines = joinTitleFragments(rawLines);
    const flat = lines.join("\n");
    const pagePair = dominantBaseMenuPair(flat);

    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      if (!looksLikeTitle(line) && !looksLikeTitle(cleanTitle(line))) {
        i += 1;
        continue;
      }

      const name = cleanTitle(line);
      if (name.length < 3 || seen.has(name.toLowerCase())) {
        i += 1;
        continue;
      }
      if (!looksLikeTitle(name) || !isCredibleDishTitle(name)) {
        i += 1;
        continue;
      }
      // Ingredient-line fragments are not product titles
      if (
        INGREDIENTISH_RE.test(name) &&
        !PRODUCT_NOUN_RE.test(name) &&
        !/\b(burger|smash|pizza|durum|pita|sandwich)\b/i.test(name)
      ) {
        i += 1;
        continue;
      }

      const bundle: string[] = [name];
      const descParts: string[] = [];
      const prices: number[] = [];
      let j = i + 1;
      let sawPrice = false;

      while (j < lines.length && j < i + 10) {
        const next = lines[j]!;
        const nextTitle = cleanTitle(next);
        if (looksLikeTitle(nextTitle) && prices.length > 0) break;
        if (looksLikeTitle(nextTitle) && j > i + 1) break;
        if (SECTION_HEADER_RE.test(next) && next.split(/\s+/).length <= 2) break;
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

      let resolvedPrices = [...prices];
      if (resolvedPrices.length === 0) {
        resolvedPrices = pricesNearTitle(flat, name);
      }
      const kind = classifyProductKind({ name });
      const knownKind = kind !== "other" && kind !== "drinks";
      // Dual-column BASE+Menu cards: prefer page-dominant pair for known kinds
      if (pagePair && (titleHasIngredientContext(bundle) || knownKind)) {
        resolvedPrices = [...pagePair];
      }
      if (resolvedPrices.length === 0) {
        i += 1;
        continue;
      }
      if (
        !knownKind &&
        !titleHasIngredientContext(bundle) &&
        prices.length === 0
      ) {
        i += 1;
        continue;
      }

      const base = Math.min(...resolvedPrices);
      const menu = Math.max(...resolvedPrices);
      const dual = resolvedPrices.length >= 2 && menu > base;
      const ingredientText =
        ingredientTextFromLines(name, bundle) ??
        (descParts.length
          ? descParts.join(", ").slice(0, 400)
          : undefined);
      const sectionFromCard = sectionHintFromContext(lines, i);
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
        ...(sectionFromCard ? { sectionHint: sectionFromCard } : {}),
        additions: [],
        choiceHints: [],
        confidence: 0.76,
        evidence: evidence(sourceFile, page.pageNumber, rawLineBundle),
        rawLineBundle,
      });

      i += 1;
    }
  }

  return out;
}

/** Parse kroner helpers kept for tests. */
export function parseNamePriceToken(raw: string): number | null {
  return parseKronerToken(raw);
}
