import { describe, expect, it } from "vitest";
import { classifyPdfPage } from "../../src/extraction/pdf/classify.js";
import type { IngestedPdfPage } from "../../src/extraction/pdf/types.js";

/**
 * Page-classification contract.
 *
 * Cover-page detection must rely on generic restaurant vocabulary/structure
 * (opening hours, phone, address, social/web, ordering, buffet). It must never
 * depend on hardcoded merchant names, street names or city names.
 */
function page(pageNumber: number, rawText: string): IngestedPdfPage {
  const lines = rawText
    .split("\n")
    .filter((t) => t.trim().length > 0)
    .map((t, i) => ({
      y: i,
      text: t,
      items: [{ str: t, x: 0, y: i, width: t.length, height: 10 }],
    }));
  return {
    pageNumber,
    width: 595,
    height: 842,
    rawText,
    items: lines.flatMap((l) => l.items),
    lines,
  };
}

describe("PDF page classification", () => {
  it("classifies a generic cover page (no merchant name) as COVER", () => {
    const cover = page(
      1,
      [
        "ÅBNINGSTIDER: 14:00 - 21:00",
        "Bestilling på telefon 42 71 22 23",
        "Adresse: Hovedgaden 1",
        "Se vores hjemmeside www.eksempel.dk",
        "Følg os på Facebook",
      ].join("\n"),
    );
    const result = classifyPdfPage(cover);
    expect(result.classification).toBe("COVER");
  });

  it("does not classify a phone/address cover signal on a later page as COVER", () => {
    const laterPage = page(
      3,
      ["ÅBNINGSTIDER: 14:00 - 21:00", "Bestilling på telefon 42 71 22 23"].join(
        "\n",
      ),
    );
    expect(classifyPdfPage(laterPage).classification).not.toBe("COVER");
  });

  it("does not classify a numbered price list as COVER", () => {
    const menuPage = page(
      1,
      [
        "1. Forårsruller 45 kr",
        "2. Tom Yam Gung 65 kr",
        "3. Satay Kylling 59 kr",
        "10. Pad Thai Kylling 95 kr",
        "11. Pad Thai Rejer 105 kr",
      ].join("\n"),
    );
    const result = classifyPdfPage(menuPage);
    expect(result.classification).toBe("MENU_CONTENT");
    expect(result.classification).not.toBe("COVER");
  });
});
