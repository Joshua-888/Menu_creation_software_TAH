import { describe, expect, it } from "vitest";
import { applySectionGroupPriceInheritance } from "../../src/extraction/pdf/sectionPriceInheritance.js";
import type { SourceCandidate } from "../../src/extraction/pdf/types.js";

function cand(
  partial: Partial<SourceCandidate> & { candidateId: string },
): SourceCandidate {
  return {
    pageNumber: partial.pageNumber ?? 1,
    rawPrices: partial.rawPrices ?? [],
    rawVariantNames: partial.rawVariantNames ?? ["Alm."],
    rawVariantPrices: partial.rawVariantPrices ?? [],
    additions: partial.additions ?? [],
    choiceHints: partial.choiceHints ?? [],
    confidence: partial.confidence ?? 0.8,
    ...partial,
  } as SourceCandidate;
}

describe("applySectionGroupPriceInheritance", () => {
  it("does not alter dishes that already carry their own printed price", () => {
    const out = applySectionGroupPriceInheritance([
      cand({
        candidateId: "c1",
        menuNumber: "1",
        name: "Kyllingesuppe",
        rawPrices: [48],
        sectionHint: "Supper",
        priceMode: "single",
      }),
    ]);
    expect(out[0]!.rawPrices).toEqual([48]);
    expect(out[0]!.priceOrigin).toBeUndefined();
  });

  it("inherits the leading dish price within the same sub-section", () => {
    const out = applySectionGroupPriceInheritance([
      cand({
        candidateId: "c8",
        menuNumber: "8",
        name: "Indbagte tigerrejer",
        rawPrices: [148],
        sectionHint: "Seafood",
        priceMode: "single",
      }),
      cand({
        candidateId: "c9",
        menuNumber: "9",
        name: "Gong bao tigerrejer",
        rawPrices: [],
        sectionHint: "Seafood",
        priceMode: "single",
      }),
      cand({
        candidateId: "c10",
        menuNumber: "10",
        name: "Stegte tigerrejer",
        rawPrices: [],
        sectionHint: "Seafood",
        priceMode: "single",
      }),
    ]);
    expect(out[1]!.rawPrices).toEqual([148]);
    expect(out[1]!.priceOrigin).toBe("DERIVED");
    expect(out[2]!.rawPrices).toEqual([148]);
    expect(out[2]!.priceOrigin).toBe("DERIVED");
  });

  it("stops inheritance at a sub-section boundary", () => {
    const out = applySectionGroupPriceInheritance([
      cand({
        candidateId: "c8",
        menuNumber: "8",
        name: "Seafood lead",
        rawPrices: [148],
        sectionHint: "Seafood",
        priceMode: "single",
      }),
      // Oksekød leads with its own price; no cross-section bleed either way.
      cand({
        candidateId: "c14",
        menuNumber: "14",
        name: "Oksekød lead",
        rawPrices: [138],
        sectionHint: "Oksekød",
        priceMode: "single",
      }),
      cand({
        candidateId: "c15",
        menuNumber: "15",
        name: "Oksekød sibling",
        rawPrices: [],
        sectionHint: "Oksekød",
        priceMode: "single",
      }),
    ]);
    expect(out[2]!.rawPrices).toEqual([138]);
    expect(out[2]!.priceOrigin).toBe("DERIVED");
    // The Oksekød lead was not overwritten with the Seafood price.
    expect(out[1]!.rawPrices).toEqual([138]);
  });

  it("does not fire when there is no preceding priced dish in the section", () => {
    const out = applySectionGroupPriceInheritance([
      cand({
        candidateId: "c22",
        menuNumber: "22",
        name: "Calzone",
        rawPrices: [],
        sectionHint: "Indbagt, ufo og calzone",
        priceMode: "single",
      }),
    ]);
    expect(out[0]!.rawPrices).toEqual([]);
    expect(out[0]!.priceOrigin).toBeUndefined();
  });

  it("does not inherit into an unrecognized (UNKNOWN) section", () => {
    const out = applySectionGroupPriceInheritance([
      cand({
        candidateId: "c1",
        menuNumber: "1",
        name: "A",
        rawPrices: [100],
        sectionHint: "Supper",
        priceMode: "single",
      }),
      cand({
        candidateId: "c2",
        menuNumber: "2",
        name: "B",
        rawPrices: [],
        sectionHint: "UNKNOWN",
        priceMode: "single",
      }),
    ]);
    expect(out[1]!.rawPrices).toEqual([]);
    expect(out[1]!.priceOrigin).toBeUndefined();
  });

  it("does not flatten multi-column (alm_familie) sections", () => {
    const out = applySectionGroupPriceInheritance([
      cand({
        candidateId: "c1",
        menuNumber: "1",
        name: "Pizza",
        rawPrices: [77, 150],
        sectionHint: "PIZZA",
        priceMode: "alm_familie",
      }),
      cand({
        candidateId: "c2",
        menuNumber: "2",
        name: "Pizza 2",
        rawPrices: [],
        sectionHint: "PIZZA",
        priceMode: "alm_familie",
      }),
    ]);
    expect(out[1]!.rawPrices).toEqual([]);
    expect(out[1]!.priceOrigin).toBeUndefined();
  });

  it("does not chain past a dish whose own price is ambiguous (multi-price)", () => {
    const out = applySectionGroupPriceInheritance([
      cand({
        candidateId: "c1",
        menuNumber: "1",
        name: "Lead",
        rawPrices: [100],
        sectionHint: "Supper",
        priceMode: "single",
      }),
      cand({
        candidateId: "c2",
        menuNumber: "2",
        name: "Ambiguous own",
        rawPrices: [80, 160],
        sectionHint: "Supper",
        priceMode: "single",
      }),
      cand({
        candidateId: "c3",
        menuNumber: "3",
        name: "After ambiguous",
        rawPrices: [],
        sectionHint: "Supper",
        priceMode: "single",
      }),
    ]);
    expect(out[2]!.rawPrices).toEqual([]);
    expect(out[2]!.priceOrigin).toBeUndefined();
  });
});
