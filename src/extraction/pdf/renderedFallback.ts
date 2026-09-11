/**
 * Generic rendered-page fallback when flattened OCR is incomplete.
 *
 * Flow: LOW CONFIDENCE → spatial same-row evidence → optional region OCR
 * from the rendered PDF page → REVIEW if still unresolved.
 *
 * Never loads restaurant-specific correction tables at runtime.
 */

import { createWorker } from "tesseract.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";
import type { ClassifiedPdfPage, PdfTextItem, SourceCandidate } from "./types.js";
import {
  pickBaseMenuPair,
  repairOcrPriceText,
  stripMenuNumberFalsePrices,
} from "./priceNormalize.js";
import { parseKronerToken } from "./prices.js";
import { repairScandinavianOcrName } from "./scandinavianRepair.js";

export { repairScandinavianOcrName } from "./scandinavianRepair.js";

function parsePriceItem(str: string): number | null {
  const repaired = repairOcrPriceText(str.trim());
  const m = repaired.match(/(\d{1,4})\s*,-?/);
  if (m) return parseKronerToken(`${m[1]},`);
  return null;
}

/** Reject OCR noise that is not a plausible product title. */
export function looksLikeOcrGarbageName(name: string | undefined): boolean {
  if (!name) return true;
  const t = name.trim();
  if (t.length < 2) return true;
  // Diagnostic evidence suffixes must never become product titles
  if (/^\|\|/.test(t) || /\[(spatial-fallback|region-ocr|col-shift)/i.test(t)) {
    return true;
  }
  if (/=/.test(t)) return true;
  if (/^og\s+/i.test(t) && t.split(/\s+/).length <= 3) return true;
  const letters = t.replace(/[^A-Za-zÆØÅæøå½]/g, "");
  if (letters.length >= 6 && (letters.match(/[A-ZÆØÅ]{3,}/g) ?? []).length >= 2 && !/[a-zæøå]{4,}/.test(t)) {
    return true;
  }
  return false;
}

/** Strip internal pipeline markers before using evidence as a title source. */
export function stripEvidenceDiagnostics(raw: string): string {
  return raw
    .replace(/\s*\|\|\s*\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function needsRenderedFallback(c: SourceCandidate): boolean {
  if (!c.menuNumber) return false;
  if (!c.name || !c.name.trim()) return true;
  if (c.priceMode === "base_menu" && c.rawPrices.length < 2) return true;
  if (c.rawPrices.length === 0) return true;
  if (c.confidence < 0.5) return true;
  return false;
}

function sameRowName(
  items: PdfTextItem[],
  ay: number,
  ax: number,
): string | undefined {
  const nameParts = items
    .filter(
      (it) =>
        Math.abs(it.y - ay) <= 8 &&
        it.x > ax + 8 &&
        /[A-Za-zÆØÅæøå½]/.test(it.str) &&
        !/^\d+\s*,/.test(it.str.trim()),
    )
    .sort((a, b) => a.x - b.x)
    .map((it) => it.str.trim())
    .filter(Boolean);
  if (!nameParts.length) return undefined;
  return repairScandinavianOcrName(nameParts.join(" "));
}

function enrichFromSpatial(
  c: SourceCandidate,
  items: PdfTextItem[],
): SourceCandidate {
  if (!c.menuNumber) return c;
  const anchorRe = new RegExp(
    `^${c.menuNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?,?$`,
    "i",
  );
  const anchors = items.filter((it) => anchorRe.test(it.str.trim()));
  if (!anchors.length) return c;
  const ay = anchors[0]!.y;
  const ax = anchors[0]!.x;

  // Prefer same-row spatial title only when layout name is missing/garbage,
  // or when the spatial title is clearly more complete.
  const rowName = sameRowName(items, ay, ax);
  let name = c.name ? repairScandinavianOcrName(c.name) : undefined;
  if (rowName && !looksLikeOcrGarbageName(rowName)) {
    if (!name || looksLikeOcrGarbageName(name) || rowName.length > name.length + 3) {
      name = rowName;
    }
  }

  let prices = [...c.rawPrices];
  let priceMode = c.priceMode;

  const menuAnchors = items
    .map((it) => {
      const m = it.str.trim().match(/^(\d{1,2}[A-Za-z]?)\.?$/);
      return m ? { menuNumber: m[1]!, y: it.y } : null;
    })
    .filter((a): a is { menuNumber: string; y: number } => !!a);

  const isExclusiveToSelf = (priceY: number): boolean => {
    const distSelf = Math.abs(priceY - ay);
    return !menuAnchors.some(
      (a) =>
        a.menuNumber !== c.menuNumber &&
        Math.abs(a.y - priceY) <= distSelf,
    );
  };

  if (prices.length === 0) {
    const nearbyPrices = items
      .filter(
        (it) =>
          Math.abs(it.y - ay) <= 18 &&
          it.x >= 250 &&
          isExclusiveToSelf(it.y),
      )
      .map((it) => parsePriceItem(it.str))
      .filter((v): v is number => v !== null);
    prices = stripMenuNumberFalsePrices(nearbyPrices, c.menuNumber).slice(0, 2);
  } else if (c.priceMode === "base_menu" && prices.length === 1) {
    const rightCandidates = items
      .filter((it) => Math.abs(it.y - ay) <= 14 && it.x >= 295)
      .map((it) => ({ y: it.y, v: parsePriceItem(it.str) }))
      .filter((p): p is { y: number; v: number } => p.v !== null);

    for (const rc of rightCandidates) {
      if (!isExclusiveToSelf(rc.y)) continue;
      if (rc.v === prices[0]) continue;
      const pair = pickBaseMenuPair([prices[0]!, rc.v]);
      if (pair) {
        prices = pair;
        priceMode = "base_menu";
      }
      break;
    }
  }

  let ingredientText = c.ingredientText;
  if (!ingredientText) {
    const desc = items
      .filter(
        (it) =>
          it.y < ay - 5 &&
          it.y > ay - 35 &&
          it.x < 280 &&
          /[A-Za-zÆØÅæøå]/.test(it.str) &&
          !/^\d+\s*,/.test(it.str.trim()) &&
          // Do not pull the next product's title into this row's ingredients
          !/^\d{1,2}[A-Za-z]?\.?\s*$/.test(it.str.trim()) &&
          !/^(kebabmix|p[øo]lsemix|kebabmenu|nuggets|pommes)/i.test(
            it.str.trim(),
          ),
      )
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((it) => it.str.trim())
      .filter(Boolean);
    const joined = repairScandinavianOcrName(desc.join(" "));
    if (
      joined &&
      !/^(kebabmix|p[øo]lsemix|kebabmenu)\b/i.test(joined) &&
      (/,/.test(joined) ||
        /^klassisk\b/i.test(joined) ||
        /^med\s+/i.test(joined) ||
        /\b(tomat|ost|salat|dressing|pitabr|sodavand|pommes\s+frites|k[øo]dsovs|gr[øo]ntsager|dyppelse)\b/i.test(
          joined,
        ))
    ) {
      ingredientText = joined;
    }
  }

  const confidence =
    name && prices.length > 0
      ? Math.max(c.confidence, 0.8)
      : name
        ? Math.max(c.confidence, 0.65)
        : c.confidence;

  return {
    ...c,
    ...(name ? { name } : {}),
    ...(ingredientText ? { ingredientText } : {}),
    rawPrices: prices,
    rawVariantPrices: prices,
    ...(priceMode ? { priceMode } : {}),
    rawVariantNames:
      priceMode === "base_menu" ? ["BASE", "Menu"] : c.rawVariantNames,
    confidence,
    evidence: {
      ...c.evidence,
      confidence,
      rawText: `${c.evidence.rawText} || [spatial-fallback]`.slice(0, 900),
    },
  };
}

async function ocrPageRegion(input: {
  sourceFile: string;
  pageNumber: number;
  /** PDF user-space bbox around the product row */
  y: number;
  pageHeight: number;
}): Promise<{ text: string; prices: number[] } | null> {
  try {
    const data = new Uint8Array(readFileSync(input.sourceFile));
    const doc = await getDocument({ data, useSystemFonts: true }).promise;
    const page = await doc.getPage(input.pageNumber);
    const viewport = page.getViewport({ scale: 2.5 });
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;

    // PDF y grows up; canvas y grows down
    const cy = viewport.height - input.y * 2.5;
    const bandTop = Math.max(0, cy - 40);
    const bandH = 70;
    const strip = createCanvas(viewport.width, bandH);
    const sctx = strip.getContext("2d");
    sctx.drawImage(
      canvas,
      0,
      bandTop,
      viewport.width,
      bandH,
      0,
      0,
      viewport.width,
      bandH,
    );
    const png = strip.toBuffer("image/png");

    const worker = await createWorker("eng");
    const {
      data: { text },
    } = await worker.recognize(png);
    await worker.terminate();
    try {
      (doc as { destroy?: () => void }).destroy?.();
    } catch {
      /* pdfjs version variance */
    }

    const cleaned = repairScandinavianOcrName(text.replace(/\s+/g, " ").trim());
    const prices: number[] = [];
    for (const m of cleaned.matchAll(/\b(\d{2,3})\s*[,°]?/g)) {
      const v = Number(m[1]);
      if (v >= 10 && v <= 400) prices.push(v);
    }
    return { text: cleaned, prices };
  } catch {
    return null;
  }
}

async function enrichFromRegionOcr(
  c: SourceCandidate,
  page: ClassifiedPdfPage,
): Promise<SourceCandidate> {
  if (!c.menuNumber || !c.evidence.sourceFile) return c;
  const anchor = page.items.find((it) =>
    new RegExp(
      `^${c.menuNumber!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?$`,
    ).test(it.str.trim()),
  );
  if (!anchor) return c;

  const ocr = await ocrPageRegion({
    sourceFile: c.evidence.sourceFile,
    pageNumber: c.pageNumber,
    y: anchor.y,
    pageHeight: page.height,
  });
  if (!ocr) return c;

  let name = c.name;
  if (!name || !name.trim() || looksLikeOcrGarbageName(name)) {
    // Prefer a clean title already present in the line bundle over OCR noise
    const bundle = stripEvidenceDiagnostics(
      `${c.rawLineBundle ?? ""}\n${c.evidence.rawText ?? ""}`,
    );
    const titleHit = bundle
      .split(/\n/)
      .map((l) => l.trim())
      .find(
        (l) =>
          /[A-Za-zÆØÅæøå]{3,}/.test(l) &&
          !/^\d+\s*,/.test(l) &&
          !looksLikeOcrGarbageName(l) &&
          !/^(valgfrit|stegt|stegte|tomat|vælg mellem)/i.test(l),
      );
    if (titleHit) {
      name = repairScandinavianOcrName(
        titleHit
          .replace(/^\d+\S{0,2}\.?\s*/i, "")
          .replace(/\b\d{2,3}\s*,-?/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      if (looksLikeOcrGarbageName(name)) name = c.name;
    }
  }
  if (!name || !name.trim() || looksLikeOcrGarbageName(name)) {
    // Strip leading menu number from OCR line (OCR may garble 65 → 6s etc.)
    let rest = ocr.text
      .replace(/^\s*\d\S{0,2}\.?\s*/i, "")
      .replace(/\b\d{2,3}\s*[,°]?/g, " ")
      .replace(/[|\"']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Short drink token: OCR "ol" / "Øl" (\\b is unsafe before non-ASCII)
    const drinkHint = repairScandinavianOcrName(ocr.text);
    const hasOl =
      /(^|[^A-Za-zÆØÅæøå0-9_])[øØ]l(?=[^A-Za-zÆØÅæøå0-9_]|$)/.test(
        drinkHint,
      ) ||
      /(^|[^A-Za-z0-9_])ol(?=[^A-Za-z0-9_]|$)/i.test(ocr.text);
    if (
      hasOl &&
      !/\b(sodavand|vin|kildevand|cola|fanta|vand)\b/i.test(ocr.text)
    ) {
      name = "Øl";
    } else if (/^[øØ]l\b/i.test(rest) || /^ol\b/i.test(rest)) {
      name = "Øl";
    } else if (
      rest.length >= 2 &&
      /[A-Za-zÆØÅæøåØ]/.test(rest) &&
      !looksLikeOcrGarbageName(rest)
    ) {
      name = repairScandinavianOcrName(rest.split(/\s+/).slice(0, 6).join(" "));
    }
  }

  let prices = [...c.rawPrices];
  let priceMode = c.priceMode;
  if (c.priceMode === "base_menu" && prices.length === 1 && ocr.prices.length) {
    // Only accept an OCR "Menu" price when spatial exclusivity agrees —
    // OCR strips often bleed the previous row's right-column price.
    const other = ocr.prices.find((p) => p !== prices[0]);
    if (other) {
      const menuAnchors = page.items
        .map((it) => {
          const m = it.str.trim().match(/^(\d{1,2}[A-Za-z]?)\.?$/);
          return m ? { menuNumber: m[1]!, y: it.y } : null;
        })
        .filter((a): a is { menuNumber: string; y: number } => !!a);
      const ay = anchor.y;
      const priceItems = page.items.filter((it) => {
        const v = parsePriceItem(it.str);
        return v === other;
      });
      const exclusive = priceItems.some((it) => {
        const distSelf = Math.abs(it.y - ay);
        return !menuAnchors.some(
          (a) =>
            a.menuNumber !== c.menuNumber &&
            Math.abs(a.y - it.y) <= distSelf,
        );
      });
      if (exclusive) {
        const pair = pickBaseMenuPair([prices[0]!, other]);
        if (pair) {
          prices = pair;
          priceMode = "base_menu";
        }
      }
    }
  } else if (prices.length === 0 && ocr.prices.length) {
    // Do not invent prices from OCR strips that often include the next row.
    // Prefer spatial column-shift reassignment for single-price rows.
    const exclusive = ocr.prices.find((p) => p !== Number(c.menuNumber));
    if (exclusive !== undefined && ocr.prices.length === 1) {
      prices = stripMenuNumberFalsePrices([exclusive], c.menuNumber).slice(0, 1);
    }
  }

  return {
    ...c,
    ...(name ? { name } : {}),
    rawPrices: prices,
    rawVariantPrices: prices,
    ...(priceMode ? { priceMode } : {}),
    rawVariantNames:
      priceMode === "base_menu" ? ["BASE", "Menu"] : c.rawVariantNames,
    confidence: Math.max(c.confidence, name && prices.length ? 0.88 : 0.7),
    evidence: {
      ...c.evidence,
      confidence: Math.max(c.confidence, 0.85),
      rawText: `${c.evidence.rawText} || [region-ocr:${ocr.text.slice(0, 120)}]`.slice(
        0,
        900,
      ),
    },
  };
}

/**
 * Sync spatial pass only — used inside layout detection.
 * Does NOT apply restaurant-specific correction tables.
 */
export function applyRenderedPageFallback(
  candidates: SourceCandidate[],
  pages: ClassifiedPdfPage[],
): SourceCandidate[] {
  const byPage = new Map<number, PdfTextItem[]>();
  for (const p of pages) byPage.set(p.pageNumber, p.items);

  const spatial = candidates.map((c) => {
    if (!needsRenderedFallback(c) && c.name) {
      // Still repair Scandinavian OCR in names
      return c.name
        ? { ...c, name: repairScandinavianOcrName(c.name) }
        : c;
    }
    const items = byPage.get(c.pageNumber) ?? [];
    return enrichFromSpatial(c, items);
  });
  return reassignShiftedColumnPrices(
    reassignBaseMenuColumnPrices(spatial, pages),
    pages,
  );
}

/**
 * Re-bind BASE + Menu column prices to the product row they sit above/on.
 * Reading-order look-ahead often steals the next row's pair.
 */
export function reassignBaseMenuColumnPrices(
  candidates: SourceCandidate[],
  pages: ClassifiedPdfPage[],
): SourceCandidate[] {
  const pageItems = new Map(pages.map((p) => [p.pageNumber, p.items]));
  const byPage = new Map<number, SourceCandidate[]>();
  for (const c of candidates) {
    const list = byPage.get(c.pageNumber) ?? [];
    list.push(c);
    byPage.set(c.pageNumber, list);
  }
  const updated = new Map<string, SourceCandidate>();

  for (const [pageNum, group] of byPage) {
    const items = pageItems.get(pageNum) ?? [];
    const menus = group.filter(
      (c) => c.menuNumber && c.priceMode === "base_menu",
    );
    if (menus.length < 2) {
      for (const c of group) updated.set(c.candidateId, c);
      continue;
    }

    const anchors = menus
      .map((c) => {
        const re = new RegExp(
          `^${c.menuNumber!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.*$`,
        );
        const hit = items.find((it) => re.test(it.str.trim()));
        return hit
          ? { menuNumber: c.menuNumber!, y: hit.y, id: c.candidateId }
          : null;
      })
      .filter(
        (a): a is { menuNumber: string; y: number; id: string } => !!a,
      );
    if (anchors.length < 2) {
      for (const c of group) updated.set(c.candidateId, c);
      continue;
    }

    const minY = Math.min(...anchors.map((a) => a.y)) - 40;
    const maxY = Math.max(...anchors.map((a) => a.y)) + 40;
    type Tok = { y: number; x: number; v: number; key: string };
    const tokens: Tok[] = [];
    for (const it of items) {
      if (it.x < 250 || it.y < minY || it.y > maxY) continue;
      const v = parsePriceItem(it.str);
      if (v === null || v < 10 || v > 400) continue;
      const key = `${Math.round(it.y)}:${Math.round(it.x)}:${v}`;
      if (tokens.some((t) => t.key === key)) continue;
      tokens.push({ y: it.y, x: it.x, v, key });
    }

    const ownerOf = (priceY: number): string | null => {
      // Price sits on/just above its product baseline
      let best: { menuNumber: string; dist: number } | null = null;
      for (const a of anchors) {
        if (a.y > priceY + 4) continue;
        const dist = priceY - a.y;
        if (dist > 28) continue;
        if (!best || dist < best.dist) best = { menuNumber: a.menuNumber, dist };
      }
      return best?.menuNumber ?? null;
    };

    const base = new Map<string, number>();
    const menu = new Map<string, number>();
    for (const t of tokens.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const owner = ownerOf(t.y);
      if (!owner) continue;
      if (t.x < 295) {
        if (!base.has(owner)) base.set(owner, t.v);
      } else if (!menu.has(owner)) {
        menu.set(owner, t.v);
      }
    }

    let changed = 0;
    for (const c of menus) {
      const b = base.get(c.menuNumber!);
      const m = menu.get(c.menuNumber!);
      if (b === undefined || m === undefined) continue;
      const pair = pickBaseMenuPair([b, m]);
      if (!pair) continue;
      if (c.rawPrices[0] !== pair[0] || c.rawPrices[1] !== pair[1]) changed += 1;
    }
    if (changed === 0) {
      for (const c of group) updated.set(c.candidateId, c);
      continue;
    }

    for (const c of group) {
      if (c.priceMode !== "base_menu" || !c.menuNumber) {
        updated.set(c.candidateId, c);
        continue;
      }
      const b = base.get(c.menuNumber);
      const m = menu.get(c.menuNumber);
      if (b === undefined || m === undefined) {
        updated.set(c.candidateId, c);
        continue;
      }
      const pair = pickBaseMenuPair([b, m]);
      if (!pair) {
        updated.set(c.candidateId, c);
        continue;
      }
      updated.set(c.candidateId, {
        ...c,
        rawPrices: pair,
        rawVariantPrices: pair,
        priceMode: "base_menu",
        rawVariantNames: ["BASE", "Menu"],
        confidence: Math.max(c.confidence, 0.86),
        evidence: {
          ...c.evidence,
          confidence: Math.max(c.evidence.confidence ?? 0, 0.86),
          rawText: `${c.evidence.rawText} || [base-menu-reassign]`.slice(0, 900),
        },
      });
    }
  }

  return candidates.map((c) => updated.get(c.candidateId) ?? c);
}

/**
 * When the price column is printed / OCR-glued slightly above the next product
 * row, nearest-neighbor binding attaches the next row's price to the previous
 * product. Reassign each right-column price to the nearest menu anchor that is
 * clearly below it (generic; not restaurant-specific).
 *
 * Applies only to single-price products so Alm/Familie and BASE+Menu pairs are
 * left untouched.
 */
export function reassignShiftedColumnPrices(
  candidates: SourceCandidate[],
  pages: ClassifiedPdfPage[],
): SourceCandidate[] {
  const MIN_GAP = 8;
  const pageItems = new Map(pages.map((p) => [p.pageNumber, p.items]));
  const byPage = new Map<number, SourceCandidate[]>();
  for (const c of candidates) {
    const list = byPage.get(c.pageNumber) ?? [];
    list.push(c);
    byPage.set(c.pageNumber, list);
  }

  const updated = new Map<string, SourceCandidate>();

  for (const [pageNum, group] of byPage) {
    const items = pageItems.get(pageNum) ?? [];
    const singles = group.filter(
      (c) =>
        !!c.menuNumber &&
        c.priceMode !== "alm_familie" &&
        c.priceMode !== "base_menu" &&
        c.priceMode !== "lille_stor_next" &&
        !(
          c.rawVariantNames?.includes("Lille") &&
          c.rawVariantNames?.includes("Stor")
        ),
    );
    if (singles.length < 2) {
      for (const c of group) updated.set(c.candidateId, c);
      continue;
    }

    const anchors = singles
      .map((c) => {
        const re = new RegExp(
          `^${c.menuNumber!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.*$`,
        );
        const hit = items.find((it) => re.test(it.str.trim()));
        return hit
          ? { menuNumber: c.menuNumber!, y: hit.y, candidateId: c.candidateId }
          : null;
      })
      .filter(
        (a): a is { menuNumber: string; y: number; candidateId: string } => !!a,
      );
    if (anchors.length < 2) {
      for (const c of group) updated.set(c.candidateId, c);
      continue;
    }

    const minY = Math.min(...anchors.map((a) => a.y)) - 50;
    const maxY = Math.max(...anchors.map((a) => a.y)) + 50;
    const priceTokens: Array<{ y: number; v: number; key: string }> = [];
    for (const it of items) {
      if (it.x < 250) continue;
      if (it.y < minY || it.y > maxY) continue;
      const v = parsePriceItem(it.str);
      if (v === null || v < 10 || v > 400) continue;
      const key = `${Math.round(it.y)}:${v}`;
      if (priceTokens.some((p) => p.key === key)) continue;
      priceTokens.push({ y: it.y, v, key });
    }
    priceTokens.sort((a, b) => b.y - a.y);

    const assigned = new Map<string, number>();
    for (const pt of priceTokens) {
      let best: { menuNumber: string; dist: number } | null = null;
      for (const a of anchors) {
        // Require the product baseline to sit clearly below the price glyph.
        if (a.y >= pt.y - MIN_GAP) continue;
        const dist = pt.y - a.y;
        if (!best || dist < best.dist) {
          best = { menuNumber: a.menuNumber, dist };
        }
      }
      if (!best) continue;
      if (assigned.has(best.menuNumber)) continue;
      assigned.set(best.menuNumber, pt.v);
    }

    // Only commit when reassignment changes at least one binding — avoids
    // churn on pages where nearest-neighbor was already correct.
    let changed = 0;
    for (const c of singles) {
      const next = assigned.get(c.menuNumber!);
      const prev = c.rawPrices[0];
      if (next !== undefined && next !== prev) changed += 1;
    }
    if (changed === 0) {
      for (const c of group) updated.set(c.candidateId, c);
      continue;
    }

    for (const c of group) {
      if (!singles.includes(c)) {
        updated.set(c.candidateId, c);
        continue;
      }
      const v = assigned.get(c.menuNumber!);
      if (v === undefined) {
        updated.set(c.candidateId, c);
        continue;
      }
      updated.set(c.candidateId, {
        ...c,
        rawPrices: [v],
        rawVariantPrices: [v],
        priceMode: "single",
        rawVariantNames: ["Alm."],
        confidence: Math.max(c.confidence, 0.82),
        evidence: {
          ...c.evidence,
          confidence: Math.max(c.evidence.confidence ?? 0, 0.82),
          rawText: `${c.evidence.rawText} || [col-shift-reassign]`.slice(0, 900),
        },
      });
    }
  }

  return candidates.map((c) => updated.get(c.candidateId) ?? c);
}

/**
 * Async pass: region OCR for candidates still missing name or Menu column.
 */
export async function applyRenderedPageFallbackAsync(
  candidates: SourceCandidate[],
  pages: ClassifiedPdfPage[],
): Promise<SourceCandidate[]> {
  const spatial = applyRenderedPageFallback(candidates, pages);
  const pageByNum = new Map(pages.map((p) => [p.pageNumber, p]));

  const out: SourceCandidate[] = [];
  for (const c of spatial) {
    const stillMissingName =
      !c.name ||
      !c.name.trim() ||
      looksLikeOcrGarbageName(c.name);
    const stillMissingMenu =
      c.priceMode === "base_menu" && c.rawPrices.length < 2;
    if (!stillMissingName && !stillMissingMenu) {
      out.push(c);
      continue;
    }
    const page = pageByNum.get(c.pageNumber);
    if (!page) {
      out.push(c);
      continue;
    }
    out.push(await enrichFromRegionOcr(c, page));
  }
  // Re-run after OCR so glued next-row prices are not left on the prior product.
  return reassignShiftedColumnPrices(
    reassignBaseMenuColumnPrices(out, pages),
    pages,
  );
}
