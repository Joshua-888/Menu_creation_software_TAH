import { describe, expect, it } from "vitest";
import { isBoilerplateFooterLine } from "../../src/extraction/pdf/boilerplate.js";
import { looksLikeBadProductName } from "../../src/extraction/pdf/reconcile.js";
import { detectNamePriceCandidates } from "../../src/extraction/pdf/namePriceExtract.js";
import { detectSourceCandidatesLayout } from "../../src/extraction/pdf/layoutExtract.js";
import type { ClassifiedPdfPage } from "../../src/extraction/pdf/types.js";

/**
 * WP-G regression coverage: generic ingestion cleanliness mechanisms.
 *
 *  (a) page footer/navigation artifacts (print URLs, embedded PDF paths,
 *      call-to-action banners) must never leak into product text.
 *  (b) a descriptive tagline sitting directly under a recognised section
 *      header must not become a product (nor spawn a phantom combo).
 *  (d) a connected dish phrase that legitimately starts with a protein word
 *      must not be rejected as an ingredient fragment.
 */

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

describe("PDF boilerplate/footer detection", () => {
  it("flags web/contact artifacts printed on exported menus", () => {
    for (const line of [
      "(https:/ /restaurantjin.dk)",
      "(/wp-content/uploads/2019/01/menu_ny.pdf#page=7)",
      "https://book.easytablebooking.com/book/?id=1",
      "kontakt@example.dk",
      "Se os på FACEBOOK",
      "Restaurant Jin Åbningstider",
      "SUPPE MENU PDF RING OG BESTIL",
      "FORRETTER MENU PDF RING",
    ]) {
      expect(isBoilerplateFooterLine(line), line).toBe(true);
    }
  });

  it("never flags real dish/ingredient lines", () => {
    for (const line of [
      "33. Kylling på spyd med pommes frites (2 stk.) 48,-",
      "Hjemmelavede tigerrejer på spyd (2 stk.) 48,-",
      "Andesteg med bambusskud og champignon",
      "Stegte ris med grøntsager",
    ]) {
      expect(isBoilerplateFooterLine(line), line).toBe(false);
    }
  });
});

describe("leading-ingredient/protein guard (bad product name)", () => {
  it("accepts a connected dish phrase that starts with a protein word", () => {
    expect(
      looksLikeBadProductName("Kylling på spyd med pommes frites (2 stk.)"),
    ).toBe(false);
    expect(looksLikeBadProductName("Kebab i pita med salat")).toBe(false);
  });

  it("still rejects bare ingredient fragments and list residue", () => {
    for (const bad of [
      "Tomat",
      "Ost",
      "og",
      "Kylling",
      "Tomat, ost, kebab, salat og",
      "Tomat, ost,skinke, salat kebab, salat og og dressing",
    ]) {
      expect(looksLikeBadProductName(bad), bad).toBe(true);
    }
  });
});

describe("section subtitle after a header is not a product", () => {
  it("drops a descriptive tagline directly under a section header", () => {
    const lines = [
      "Børnemenu",
      "Mad til familiens yngste medlemmer",
      "31. Pølser med pommes frites 48,-",
      "32. Frikadeller med pommes frites (4 stk.) 48,-",
      "33. Kylling på spyd med pommes frites (2 stk.) 48,-",
    ];
    const namePrice = detectNamePriceCandidates([page(lines)], "x.pdf");
    const layout = detectSourceCandidatesLayout([page(lines)], "x.pdf");
    // The tagline must never become a product in either extractor...
    for (const c of [...namePrice, ...layout]) {
      expect(/yngste|Mad til/i.test(c.name ?? ""), c.name).toBe(false);
    }
    // ...while the numbered dishes still survive in the layout extractor.
    expect(
      layout.filter((c) => /^\d{2}\s/.test(c.menuNumber?.trim() ?? "") || /\d/.test(c.menuNumber ?? "")).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("footer artifacts never reach name/price candidates", () => {
  it("ignores footer URL and CTA lines", () => {
    const found = detectNamePriceCandidates(
      [
        page([
          "31. Pølser med pommes frites 48,-",
          "BØRNEMENU PDF RING OG BESTIL",
          "(/wp-content/uploads/2019/01/menu_ny.pdf#page=7)",
        ]),
      ],
      "x.pdf",
    );
    expect(found.every((c) => !/PDF RING|wp-content/i.test(c.name ?? ""))).toBe(
      true,
    );
  });
});
