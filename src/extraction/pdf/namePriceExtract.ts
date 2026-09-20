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
  /\b(grillet|bøf|bef|cheddar|ost|agurk|løg|sauce|jalapeño|jalapenos|champignon|chicken|crispy|pickles|karamellis|burgersauce|bearnaise|colslaw|coleslaw|honey|peberfrugt|nuggets|fries|pomfrit+er?|sodavand|ketchup|mayonnaise|dressing|dip|kylling|syltede?)\b/i;
// Currency suffix/prefix is merchant-agnostic: Danish menus print prices as
// "85,-", "85 kr", "kr 85", or "85 DKK" (case-insensitive). The DKK suffix is
// recognized alongside the legacy comma/period/degree forms.
const PRICE_LINE_RE =
  /(?:^|\b)(?:menu\s*)?(\d{2,3})\s*(?:[,.°]|[-\u00b0]|dkk\b)/gi;
const IMAGE_PRICE_LINE_RE =
  /(?:\bkr\.?\s*(\d{2,3})\b|(?:^|\b)(?:menu\s*)?(\d{2,3})\s*(?:[,.°]|[-\u00b0]|dkk\b))/gi;
const SECTION_HEADER_RE =
  /^(burgers?|grill|pizza|pasta|drikkevarer|sides|tilbehør|menuer|sandwich|durum|pita|forret(?:ter)?|hovedret(?:ter)?|suppe(?:r)?|dessert(?:er)?|børnemenu(?:er)?|oksekød|svinekød|kylling|and|seafood|fisk|vegetar|ris|nudler|all[\s-]*inclusive)\b/i;

/** Variant / price-column headers that legitimately sit above a product row. */
const VARIANT_OR_COLUMN_HEADER_RE =
  /^(alm\.?|familie|lille|stor|ekstra:?|menu)$/i;

/**
 * A short course/protein sub-section divider rather than a product.
 * A line carrying its own price is always a product, never a divider — this
 * preserves real dishes literally named after a protein ("Kylling 89,-").
 */
function isSectionHeaderText(line: string): boolean {
  const t = line.trim().replace(/\s+/g, " ");
  if (!SECTION_HEADER_RE.test(t)) return false;
  if (pricesFromLine(t).length > 0) return false;
  return t.split(/\s+/).length <= 2;
}

/** A row beginning with a printed menu number followed by a dish name. */
function looksLikeNumberedDishLine(line: string | undefined): boolean {
  if (!line) return false;
  const t = line.trim();
  return (
    /^\d{1,3}[a-zA-Z]?\.\s+[A-Za-zÆØÅæøå]/.test(t) ||
    /^\d{1,3}\s+[A-ZÆØÅ]/.test(t)
  );
}

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
  if (isSectionHeaderText(t)) return false;
  if (looksLikeContentsLine(t)) return false;
  if (INGREDIENTISH_RE.test(t) && t.split(/\s+/).length >= 4) {
    return false;
  }
  if (/^\d/.test(t)) return false;
  if (PRICE_LINE_RE.test(t) && !/[A-Za-zÆØÅæøå]{4,}/.test(t)) return false;
  return TITLE_RE.test(t) && /[A-Za-zÆØÅæøå]{3,}/.test(t);
}

function isStrongPricedProductLine(raw: string): boolean {
  const name = cleanTitle(raw, true);
  if (pricesFromLine(raw, true).length === 0 || name.length < 3) return false;
  if (!/[A-Za-zÆØÅæøå]{3,}/.test(name)) return false;
  const kind = classifyProductKind({ name });
  return kind !== "other" && kind !== "drinks";
}

function looksLikeProductLine(raw: string, image: boolean): boolean {
  if (looksLikeContentsLine(raw)) return false;
  const cleaned = cleanTitle(raw, image);
  return (
    looksLikeTitle(raw) ||
    looksLikeTitle(cleaned) ||
    (image && isStrongPricedProductLine(raw))
  );
}

/** Printed combo/wrap contents — not a new dish title. */
export function looksLikeContentsLine(line: string): boolean {
  const s = line.trim().replace(/\s+/g, " ");
  if (!s || /\bmenu\b/i.test(s)) return false;
  if (pricesFromLine(s, true).length > 0 || pricesFromLine(s).length > 0) {
    return false;
  }
  if (
    /\b(og|el\.|eller|,)\b/i.test(s) &&
    /\b(sodavand|pomfrit+er?|pommes|frites|nuggets?|ketchup|mayo|mayonnaise|dressing|kebab|salat|falafel)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  return INGREDIENTISH_RE.test(s) && s.split(/\s+/).length >= 3;
}

function pricesFromLine(line: string, image = false): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(image ? IMAGE_PRICE_LINE_RE : PRICE_LINE_RE)) {
    const n = Number(m[1] ?? m[2]);
    if (n >= 10 && n <= 400) out.push(n);
  }
  return out;
}

function evidence(
  sourceFile: string,
  pageNumber: number,
  raw: string,
  image: boolean,
  region?: SourceEvidence["region"],
): SourceEvidence {
  return {
    extractorVersion: "1.0.0",
    rawText: raw.slice(0, 900),
    sourceFile,
    pageNumber,
    confidence: 0.72,
    ...(image ? { origin: "SOURCE_LAYOUT" as const } : {}),
    ...(region ? { region } : {}),
  };
}

function titleRegion(
  page: ClassifiedPdfPage,
  name: string,
): SourceEvidence["region"] | undefined {
  const key = name.toLowerCase().replace(/[^a-z0-9æøå]+/g, "");
  const line = page.lines.find((candidate) =>
    cleanTitle(candidate.text, true)
      .toLowerCase()
      .replace(/[^a-z0-9æøå]+/g, "")
      .includes(key),
  );
  if (!line?.items.length) return undefined;
  const x0 = Math.min(...line.items.map((item) => item.x));
  const x1 = Math.max(...line.items.map((item) => item.x + item.width));
  const y0 = Math.min(...line.items.map((item) => item.y));
  const y1 = Math.max(...line.items.map((item) => item.y + item.height));
  return {
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
    pageNumber: page.pageNumber,
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
    const aSingle = /^[A-ZÆØÅ][A-Za-zÆØÅæøå'’-]+$/.test(a);
    const bFirst = b?.match(/^([A-ZÆØÅ][A-Za-zÆØÅæøå'’-]+)/)?.[1];
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

function cleanTitle(raw: string, image = false): string {
  return raw
    .replace(image ? IMAGE_PRICE_LINE_RE : /$^/, " ")
    .replace(image ? /\bkr\.?\s*$/i : /$^/, " ")
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
  if (SKIP_TITLE_RE.test(t) || isSectionHeaderText(t)) return false;
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

function dominantImageMenuPair(flat: string): [number, number] | null {
  const menuStart = flat.search(/^menu$/im);
  const scoped = menuStart >= 0 ? flat.slice(menuStart) : flat;
  const counts = new Map<number, number>();
  for (const match of scoped.matchAll(/\b(\d{2,3})\b/g)) {
    const value = Number(match[1]);
    if (value < 40 || value > 350) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (ranked.length < 2) return null;
  const first = ranked[0]![0];
  const second = ranked[1]![0];
  return first < second ? [first, second] : [second, first];
}

function joinImageTitleFragments(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const first = lines[i]!.trim();
    const middle = lines[i + 1]?.trim() ?? "";
    const last = lines[i + 2]?.trim() ?? "";
    if (
      /^[A-ZÆØÅ][A-Za-zÆØÅæøå'’–-]{3,}$/.test(first) &&
      /^[\d\s.,»|]+$/.test(middle) &&
      /^[A-ZÆØÅ][A-Za-zÆØÅæøå'’–-]+(?:\s+(?:sl|si|oy|as))?$/i.test(last)
    ) {
      out.push(`${first} ${last.replace(/\s+(sl|si|oy|as)$/i, "")}`);
      i += 2;
      continue;
    }
    out.push(first);
  }
  return out;
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
    if (looksLikeContentsLine(t)) {
      const cleaned = t.replace(PRICE_LINE_RE, " ").replace(/\s+/g, " ").trim();
      if (cleaned.length >= 4) parts.push(cleaned);
      continue;
    }
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

function strongImageFamilyCategory(name: string): string | undefined {
  if (/\bburger\b/i.test(name)) return "Burgers";
  if (/\b(d[uü]r[uü]m)\b/i.test(name)) return "Durum";
  if (/\bpita\b/i.test(name)) return "Pita";
  if (/\bkebab\b/i.test(name)) return "Kebab";
  if (/\b(menu|nuggets?|pomfrit)\b/i.test(name)) return "Menuer";
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
    const imageSource = page.sourceKind === "image";
    const lines = joinTitleFragments(
      imageSource ? joinImageTitleFragments(rawLines) : rawLines,
    );
    const flat = lines.join("\n");
    const imageHasMenuColumnHeader = rawLines.some((line) =>
      /^menu$/i.test(line.trim()),
    );
    const pagePair =
      !imageSource || imageHasMenuColumnHeader
        ? imageSource
          ? dominantImageMenuPair(flat) ?? dominantBaseMenuPair(flat)
          : dominantBaseMenuPair(flat)
        : null;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      if (!looksLikeProductLine(line, imageSource)) {
        i += 1;
        continue;
      }

      const name = cleanTitle(line, imageSource);
      if (name.length < 3 || seen.has(name.toLowerCase())) {
        i += 1;
        continue;
      }
      const strongPricedLine =
        imageSource && isStrongPricedProductLine(line);
      if (
        (!looksLikeTitle(name) || !isCredibleDishTitle(name)) &&
        !strongPricedLine
      ) {
        i += 1;
        continue;
      }

      // Structural guard: a short unnumbered line without its own price that is
      // immediately followed by numbered dish rows is a course/protein
      // sub-section divider (e.g. "Oksekød", "Svinekød", "Seafood"), not a
      // standalone product. Creating a candidate here would mis-steal the first
      // following dish's price. Lines with their own price, and legitimate
      // variant/column headers (Alm./Familie/Lille/Stor), are exempt.
      const rawT = line.trim().replace(/\s+/g, " ");
      if (
        !VARIANT_OR_COLUMN_HEADER_RE.test(rawT) &&
        SECTION_HEADER_RE.test(rawT) &&
        pricesFromLine(line, imageSource).length === 0 &&
        rawT.split(/\s+/).length <= 3 &&
        Array.from({ length: 3 }, (_, k) => lines[i + 1 + k]).some((next) =>
          looksLikeNumberedDishLine(next),
        )
      ) {
        i += 1;
        continue;
      }
      // Ingredient-line fragments are not product titles
      if (
        INGREDIENTISH_RE.test(name) &&
        !PRODUCT_NOUN_RE.test(name) &&
        !/\b(burger|smash|pizza|durum|pita|sandwich)\b/i.test(name) &&
        !(imageSource && /\b(pomfrit|nuggets?)\b/i.test(name))
      ) {
        i += 1;
        continue;
      }

      const bundle: string[] = [imageSource ? line : name];
      const descParts: string[] = [];
      const prices: number[] = imageSource
        ? pricesFromLine(line, true)
        : [];
      if (
        imageSource &&
        prices.length === 0 &&
        i > 0 &&
        !/[A-Za-zÆØÅæøå]{3,}/.test(lines[i - 1]!)
      ) {
        prices.push(...pricesFromLine(lines[i - 1]!, imageSource));
      }
      let j = i + 1;
      let sawPrice = prices.length > 0;

      while (j < lines.length && j < i + 10) {
        const next = lines[j]!;
        const nextIsTitle = looksLikeContentsLine(next)
          ? false
          : imageSource
            ? looksLikeProductLine(next, true)
            : looksLikeTitle(cleanTitle(next));
        if (nextIsTitle && prices.length > 0) break;
        if (nextIsTitle && j > i + 1) break;
        if (SECTION_HEADER_RE.test(next) && next.split(/\s+/).length <= 2) break;
        bundle.push(next);
        const ps = pricesFromLine(next, imageSource);
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
      const strongImageCategory = imageSource
        ? strongImageFamilyCategory(name)
        : undefined;
      const resolvedSection = strongImageCategory ?? sectionFromCard;
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
        ...(resolvedSection
          ? {
              sectionHint: resolvedSection,
              categoryHint: resolvedSection,
            }
          : {}),
        additions: [],
        choiceHints: [],
        confidence: 0.76,
        evidence: evidence(
          sourceFile,
          page.pageNumber,
          rawLineBundle,
          imageSource,
          imageSource ? titleRegion(page, name) : undefined,
        ),
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
