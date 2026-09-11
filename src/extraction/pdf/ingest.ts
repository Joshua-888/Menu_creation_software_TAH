import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { IngestedPdfPage, PdfPageLine, PdfTextItem } from "./types.js";

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

    const lines = rebuildLines(items);
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
