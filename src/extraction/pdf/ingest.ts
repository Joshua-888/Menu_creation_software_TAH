import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { IngestedPdfPage, PdfPageLine, PdfTextItem } from "./types.js";

/** Spatial epsilon (px) within which two text items are considered co-located. */
const DUPLICATE_POSITION_EPSILON = 2;

/**
 * Rebuild reading-order lines from embedded PDF text items (Y then X).
 * Does not trust OCR blindly — callers should keep page image refs when ambiguous.
 */
export function rebuildLines(items: PdfTextItem[], yBucket = 3): PdfPageLine[] {
  const rows = new Map<number, PdfTextItem[]>();
  for (const it of items) {
    const y = Math.round(it.y / yBucket) * yBucket;
    const list = rows.get(y) ?? [];
    list.push(it);
    rows.set(y, list);
  }
  const ys = [...rows.keys()].sort((a, b) => b - a);
  return ys
    .map((y) => {
      const row = (rows.get(y) ?? []).slice().sort((a, b) => a.x - b.x);
      const text = row
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return { y, text, items: row };
    })
    .filter((l) => l.text.length > 0);
}

/**
 * Collapse near-identical duplicate text runs that PDF producers emit twice
 * (zero-width ghost run + real rendered run, or a genuine double-render).
 *
 * - Empty / whitespace-only items are dropped.
 * - Items with identical trimmed text at the same position (within epsilon) are
 *   collapsed to one: a rendered (`width > 0`) item wins over a zero-width ghost;
 *   otherwise the first occurrence in document-stream order is kept.
 * - Items that merely share a Y-coordinate but have different text are preserved.
 *
 * Context: blind-pilot merchant "Gaza Grill Nordhavn" (a previously-unseen real
 * restaurant PDF) emits every menu label as a duplicated pair of zero-width and
 * rendered runs. Without this, `rebuildLines()` yields doubled, garbled lines
 * such as `FALAFEL FALAFEL VE VE 85 DKK 85 DKK`. De-duplication 340 -> 162 items
 * on that page restores single clean runs, with zero behavioural change on the
 * existing golden fixtures (Veroni / third-merchant / Bella / Smash).
 *
 * NOTE: This is intentionally the ONLY structural fix shipped here. Generic
 * two-column layout reconstruction was attempted and deferred (see below).
 */
export function dedupePdfTextItems(items: PdfTextItem[]): PdfTextItem[] {
  const kept: PdfTextItem[] = [];
  for (const item of items) {
    if (item.str.trim().length === 0) continue;
    const text = item.str.trim();

    let duplicateIndex = -1;
    for (let i = 0; i < kept.length; i++) {
      const prior = kept[i]!;
      if (prior.str.trim() !== text) continue;
      if (
        Math.abs(prior.x - item.x) <= DUPLICATE_POSITION_EPSILON &&
        Math.abs(prior.y - item.y) <= DUPLICATE_POSITION_EPSILON
      ) {
        duplicateIndex = i;
        break;
      }
    }

    if (duplicateIndex === -1) {
      kept.push(item);
      continue;
    }

    const prior = kept[duplicateIndex]!;
    // Prefer a rendered run over a zero-width ghost duplicate. A genuine
    // double-render (both widths equivalent) keeps the first occurrence.
    if (prior.width === 0 && item.width > 0) {
      kept[duplicateIndex] = item;
    }
  }
  return kept;
}

export async function ingestPdf(filePath: string): Promise<{
  sourceFile: string;
  pageCount: number;
  pages: IngestedPdfPage[];
}> {
  const data = new Uint8Array(readFileSync(filePath));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: IngestedPdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTextItem[] = content.items
      .map((raw) => {
        const it = raw as {
          str?: string;
          transform?: number[];
          width?: number;
          height?: number;
        };
        if (typeof it.str !== "string" || !it.transform) return null;
        return {
          str: it.str,
          x: Math.round(it.transform[4] ?? 0),
          y: Math.round(it.transform[5] ?? 0),
          width: Math.round(it.width ?? 0),
          height: Math.round(it.height ?? 0),
        };
      })
      .filter((x): x is PdfTextItem => x !== null);

    // De-duplicate ghost/double text runs before line assembly. `page.items`
    // intentionally retains the RAW items so downstream OCR-hydration item-count
    // thresholds (renderedFallback) keep their existing semantics.
    const deduped = dedupePdfTextItems(items);
    const lines = rebuildLines(deduped);
    const rawText = lines.map((l) => l.text).join("\n");
    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      rawText,
      items,
      lines,
      imageRef: `pdf-page:${filePath}#${pageNumber}`,
    });
  }

  return {
    sourceFile: filePath,
    pageCount: doc.numPages,
    pages,
  };
}
