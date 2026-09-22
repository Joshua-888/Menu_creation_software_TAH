import { describe, expect, it } from "vitest";
import {
  detectNamePriceCandidates,
  joinTitleFragments,
} from "../../src/extraction/pdf/namePriceExtract.js";
import type { ClassifiedPdfPage } from "../../src/extraction/pdf/types.js";

/**
 * WP-H regression coverage: generic recovery of ALL-CAPS dish titles and the
 * shared global-regex price-scanner state leak.
 *
 * All-caps dish presentation is normal on many menus (Middle Eastern,
 * Mediterranean, Asian). It must be accepted structurally — an all-caps title
 * is credible only when it carries exactly ONE printed price on the same line,
 * which is what distinguishes a real dish from a merged multi-column row or an
 * OCR/header blob. Merely loosening the old all-caps reject flooded the output
 * with markers, wine-section fragments and two-price merged rows, so these
 * tests pin the narrow structural contract.
 *
 * A dish row is followed by a generic ingredient/description line (the same
 * shape every merchant uses) so it clears the ordinary "known kind or ingredient
 * context" product gate; nothing here is merchant-specific.
 */

const DESC = "Serveres med dressing, agurk og løg.";

function page(texts: string[], pageNumber = 3): ClassifiedPdfPage {
  return {
    pageNumber,
    width: 800,
    height: 1000,
    rawText: texts.join("\n"),
    classification: "MENU_CONTENT",
    classificationReason: "test",
    sourceKind: "pdf",
    items: [],
    lines: texts.map((t, y) => ({ y: y * 20, text: t, items: [] })),
  };
}

function names(found: ReturnType<typeof detectNamePriceCandidates>): string[] {
  return found.map((c) => c.name ?? "");
}

describe("WP-H all-caps dish titles with an adjacent price", () => {
  const cases: Array<[string, string]> = [
    ["HUMMUS 85 DKK", "HUMMUS"],
    ["BEEF SHAWARMA 105 DKK", "BEEF SHAWARMA"],
    ["CAULIFLOWER 85 DKK", "CAULIFLOWER"],
    ["BATEEKH WI JIBNEH 85 DKK", "BATEEKH WI JIBNEH"],
  ];

  for (const [line, expected] of cases) {
    it(`recovers '${expected}' from '${line}'`, () => {
      const found = detectNamePriceCandidates(
        [page([line, DESC])],
        "x.pdf",
      );
      expect(names(found)).toContain(expected);
      const hit = found.find((c) => c.name === expected);
      expect(hit?.rawPrices.length).toBe(1);
    });
  }

  it("does not swallow the price token into the title", () => {
    const found = detectNamePriceCandidates(
      [page(["HUMMUS 85 DKK", DESC])],
      "x.pdf",
    );
    const hit = found.find((c) => /hummus/i.test(c.name ?? ""));
    expect(hit?.name).toBe("HUMMUS");
    expect(hit?.name).not.toMatch(/85|DKK/);
  });

  it("strips a leading dietary marker instead of gluing it to the title", () => {
    for (const marker of ["VE", "GL", "V", "VG"]) {
      const found = detectNamePriceCandidates(
        [page([`${marker} HUMMUS 85 DKK`, DESC])],
        "x.pdf",
      );
      expect(names(found)).toContain("HUMMUS");
    }
  });

  it("does not create a product from a bare all-caps marker line", () => {
    const found = detectNamePriceCandidates(
      [page(["VE", "GL", DESC])],
      "x.pdf",
    );
    expect(found).toHaveLength(0);
  });
});

describe("WP-H merged multi-column rows are not force-split", () => {
  it("rejects an all-caps line carrying TWO prices (merged columns)", () => {
    const found = detectNamePriceCandidates(
      [page(["FALAFEL VE 85 DKK FATTOUSH VE GL 95 DKK", DESC])],
      "x.pdf",
    );
    // Two genuine dishes merged into one physical line cannot be safely split
    // (deferred multi-column reconstruction); they must not become a single
    // fabricated product that silently bundles both names.
    expect(found.find((c) => /fattoush/i.test(c.name ?? ""))).toBeUndefined();
    expect(
      found.some((c) => {
        const n = c.name ?? "";
        return n.includes("85") && n.includes("95");
      }),
    ).toBe(false);
  });

  it("still recovers healthy single-price dishes from the same page", () => {
    const found = detectNamePriceCandidates(
      [
        page([
          "FALAFEL VE 85 DKK FATTOUSH VE GL 95 DKK",
          DESC,
          "HUMMUS 85 DKK",
          DESC,
        ]),
      ],
      "x.pdf",
    );
    expect(names(found)).toContain("HUMMUS");
  });
});

describe("WP-H title fragments never absorb dietary markers", () => {
  it("does not join a marker line onto the following cased title", () => {
    expect(joinTitleFragments(["VE", "Pommes"])).toEqual(["VE", "Pommes"]);
  });

  it("does not join a marker token onto a preceding title", () => {
    expect(joinTitleFragments(["Pommes", "GL"])).toEqual(["Pommes", "GL"]);
  });

  it("still joins genuine split two-word titles", () => {
    expect(joinTitleFragments(["Dirty", "Smash"])).toEqual(["Dirty Smash"]);
  });
});

describe("WP-H price scanning is order-independent (global regex lastIndex)", () => {
  it("reads prices regardless of the order mixed lines are scanned", () => {
    // Regression: PRICE_LINE_RE carries the `g` flag; a prior `.test()` used to
    // leave a stale lastIndex that `matchAll` cloned, silently dropping prices
    // depending on call order. Several mixed lines pin determinism.
    const found = detectNamePriceCandidates(
      [
        page([
          "HUMMUS 85 DKK",
          DESC,
          "BEEF SHAWARMA 105 DKK",
          DESC,
          "CAULIFLOWER 85 DKK",
          DESC,
        ]),
      ],
      "x.pdf",
    );
    expect(names(found)).toEqual(["HUMMUS", "BEEF SHAWARMA", "CAULIFLOWER"]);
    // Each dish's own printed price must be read; a page-dominant BASE+Menu
    // heuristic may add a second price, so assert membership, not exact length.
    expect(found.find((c) => c.name === "HUMMUS")?.rawPrices).toContain(85);
    expect(found.find((c) => c.name === "BEEF SHAWARMA")?.rawPrices).toContain(105);
    expect(found.find((c) => c.name === "CAULIFLOWER")?.rawPrices).toContain(85);
  });
});
