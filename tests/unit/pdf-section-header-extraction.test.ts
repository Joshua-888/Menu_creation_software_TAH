import { describe, expect, it } from "vitest";
import {
  detectNamePriceCandidates,
  isCredibleDishTitle,
} from "../../src/extraction/pdf/namePriceExtract.js";
import { detectSourceCandidatesLayout } from "../../src/extraction/pdf/layoutExtract.js";
import type { ClassifiedPdfPage } from "../../src/extraction/pdf/types.js";

/**
 * WP-B regression coverage: short Danish course/protein sub-section dividers
 * (e.g. "Oksekød", "Svinekød", "Seafood") must not become ghost products that
 * steal the price of the first following numbered dish, and the legacy
 * page-number PIZZA prior must not miscategorise non-pizza pages.
 */

function page(
  texts: string[],
  pageNumber = 3,
  sourceKind: "pdf" | "image" = "pdf",
): ClassifiedPdfPage {
  return {
    pageNumber,
    width: 800,
    height: 1000,
    rawText: texts.join("\n"),
    classification: "MENU_CONTENT",
    classificationReason: "test",
    sourceKind,
    items: [],
    lines: texts.map((t, y) => ({ y: y * 20, text: t, items: [] })),
  };
}

const numberedDishes = [
  "14. Stegt oksekød med grøntsager 138,-",
  '15. "Gong bao" oksekød med cashewnødder STÆRK',
  "16. Stegt oksekød med bambusskud og champignon",
  "17. Oksekød i østerssauce",
];

describe("section-header dividers are not ghost products", () => {
  for (const header of ["Oksekød", "Svinekød", "Kylling", "Seafood"]) {
    it(`does not extract '${header}' and does not steal the next dish price`, () => {
      const found = detectNamePriceCandidates(
        [page([header, ...numberedDishes])],
        "x.pdf",
      );
      expect(found).toHaveLength(0);
    });
  }

  it("does not extract a multi-word course divider ('Forretter')", () => {
    const found = detectNamePriceCandidates(
      [page(["Forretter", "1. Forårsruller 45,-", "2. Andet 60,-"])],
      "x.pdf",
    );
    expect(found).toHaveLength(0);
  });

  it("does not extract a two-word course divider ('Forret Hjemmelavet')", () => {
    const found = detectNamePriceCandidates(
      [page(["Forret Hjemmelavet", "1. Forårsruller 45,-", "2. Andet 60,-"])],
      "x.pdf",
    );
    expect(found).toHaveLength(0);
  });

  it("applies the structural divider guard to longer vocabulary headers", () => {
    const found = detectNamePriceCandidates(
      [
        page([
          "Forret Hjemmelavet Ekstra",
          "1. Forårsruller 45,-",
          "2. Andet 60,-",
        ]),
      ],
      "x.pdf",
    );
    expect(found).toHaveLength(0);
  });
});

describe("credibility gate preserves real products but rejects bare dividers", () => {
  it("rejects bare course/protein words", () => {
    for (const bare of ["Kylling", "Oksekød", "Seafood", "Forret Hjemmelavet"]) {
      expect(isCredibleDishTitle(bare)).toBe(false);
    }
  });

  it("keeps a short dish that carries its own price", () => {
    expect(isCredibleDishTitle("Kylling 89,-")).toBe(true);
  });

  it("keeps a real compound dish name containing a protein word", () => {
    expect(isCredibleDishTitle("Andesteg")).toBe(true);
  });
});

describe("WP-D generic Danish course/cuisine section headings", () => {
  const dishes = [
    "1. Forårsruller 45,-",
    "2. Suppe med kylling 55,-",
  ];

  it("does not force INDISK onto generic 'Forretter'/'Hovedretter'", () => {
    for (const header of ["Forretter", "Hovedretter"]) {
      const found = detectSourceCandidatesLayout([page([header, ...dishes])], "x.pdf");
      expect(found.length).toBeGreaterThan(0);
      for (const candidate of found) {
        expect(candidate.sectionHint).toBe(header);
        expect(candidate.sectionHint).not.toContain("INDISK");
      }
    }
  });

  it("recognizes generic Danish protein/course headers", () => {
    for (const header of [
      "Supper",
      "And",
      "Oksekød",
      "Kylling",
      "Svinekød",
      "Ris og nudler",
    ]) {
      const found = detectSourceCandidatesLayout([page([header, ...dishes])], "x.pdf");
      expect(found.length).toBeGreaterThan(0);
      for (const candidate of found) {
        expect(candidate.sectionHint).toBe(header);
      }
    }
  });

  it("composes an explicit cuisine parent with its course dividers (Veroni path)", () => {
    const found = detectSourceCandidatesLayout(
      [page(["INDISK", "Forretter", ...dishes, "Hovedretter", ...dishes])],
      "x.pdf",
    );
    const hints = new Set(found.map((c) => c.sectionHint));
    expect(hints.has("INDISK / Forretter")).toBe(true);
    expect(hints.has("INDISK / Hovedretter")).toBe(true);
  });

  it("does not leak a cuisine parent onto a following generic section", () => {
    const found = detectSourceCandidatesLayout(
      [
        page([
          "INDISK",
          "Forretter",
          ...dishes,
          "DRIKKEVARER",
          "3. Cola 25,-",
        ]),
      ],
      "x.pdf",
    );
    const drink = found.find((c) => c.name === "Cola");
    expect(drink?.sectionHint).toBe("DRIKKEVARER");
  });
});

describe("layout section default no longer assumes PIZZA by page number", () => {
  it("leaves soup rows on an early non-pizza page UNKNOWN", () => {
    const found = detectSourceCandidatesLayout(
      [
        page(
          [
            "10. Kyllingesuppe 55,-",
            "11. Pekingsuppe STÆRK 60,-",
          ],
          4,
        ),
      ],
      "x.pdf",
    );
    expect(found.map((c) => c.name)).toEqual([
      "Kyllingesuppe",
      "Pekingsuppe STÆRK",
    ]);
    for (const candidate of found) {
      expect(candidate.sectionHint).toBe("UNKNOWN");
    }
  });
});
