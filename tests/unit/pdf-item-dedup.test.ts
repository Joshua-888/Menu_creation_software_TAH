import { describe, expect, it } from "vitest";
import {
  dedupePdfTextItems,
  rebuildLines,
} from "../../src/extraction/pdf/ingest.js";
import type { PdfTextItem } from "../../src/extraction/pdf/types.js";

/** Small helper for terse synthetic item construction. */
function item(
  str: string,
  x: number,
  y: number,
  width: number,
  height = 9,
): PdfTextItem {
  return { str, x, y, width, height };
}

describe("dedupePdfTextItems", () => {
  it("drops empty / whitespace-only items", () => {
    const out = dedupePdfTextItems([
      item("", 10, 10, 0),
      item("   ", 20, 20, 0),
      item("FALAFEL", 26, 587, 43),
    ]);
    expect(out.map((i) => i.str)).toEqual(["FALAFEL"]);
  });

  it("keeps the rendered run and discards a zero-width ghost duplicate", () => {
    const out = dedupePdfTextItems([
      item("FALAFEL", 26, 587, 0, 0),
      item("FALAFEL", 26, 587, 43),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.width).toBe(43);
  });

  it("collapses a genuine identical-width double-render to the first occurrence", () => {
    const first = item("TAHINI SALAD", 23, 481, 68);
    const second = item("TAHINI SALAD", 23, 481, 68);
    const out = dedupePdfTextItems([first, second]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(first);
  });

  it("preserves items that share a Y-coordinate but have different text", () => {
    const out = dedupePdfTextItems([
      item("FALAFEL", 26, 587, 43),
      item("85 DKK", 250, 587, 37),
    ]);
    expect(out).toHaveLength(2);
  });

  it("preserves items with identical text that are spatially far apart", () => {
    const out = dedupePdfTextItems([
      item("85 DKK", 250, 587, 37),
      item("85 DKK", 250, 100, 37),
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps original document-stream ordering of retained items", () => {
    const out = dedupePdfTextItems([
      item("B", 20, 100, 5),
      item("A", 10, 100, 5),
      item("B", 20, 100, 5),
    ]);
    expect(out.map((i) => i.str)).toEqual(["B", "A"]);
  });

  it("collapses a real duplicated-line pattern without touching neighbouring text", () => {
    // Mirrors the Gaza "FALAFEL FALAFEL VE VE 85 DKK 85 DKK" defect at item level.
    const raw: PdfTextItem[] = [
      item("FALAFEL", 26, 588, 0, 0),
      item("FALAFEL", 26, 588, 43),
      item("VE", 120, 588, 0, 0),
      item("VE", 120, 588, 14),
      item("85 DKK", 200, 588, 37),
      item("85 DKK", 200, 588, 37),
    ];
    const out = dedupePdfTextItems(raw);
    expect(out.map((i) => i.str)).toEqual(["FALAFEL", "VE", "85 DKK"]);
  });
});

describe("dedupe-then-rebuild (backward compatibility)", () => {
  it("single-column reconstruction is unchanged from the pre-dedupe reading order", () => {
    // A representative single-column slice of an existing fixture-style page.
    const raw: PdfTextItem[] = [
      item("19.", 5, 674, 13),
      item("Noah", 36, 678, 24),
      item("Tomat,", 36, 662, 32),
      item("ost,", 70, 661, 17),
      item("kebab,", 89, 659, 32),
      item("105,", 264, 648, 22),
    ];

    const deduped = dedupePdfTextItems(raw);
    expect(deduped).toEqual(raw);
    // Reading-order Y-then-X assembly is unchanged by de-duplication.
    const lines = rebuildLines(deduped).map((l) => l.text);
    expect(lines).toEqual(["Noah", "19.", "Tomat,", "ost, kebab,", "105,"]);
  });
});
