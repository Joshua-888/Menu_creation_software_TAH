/**
 * WP4 corrective — generic Danish transliteration dedup for ingredient lists.
 *
 * The dedup KEY folds æ↔ae, ø↔oe, å↔aa (on top of NFKD accents) so the same
 * ingredient written as ASCII OCR transliteration and Danish diacritic spelling
 * is recognized as one entry. Display/source spelling is preserved (first seen
 * wins); only the uniqueness key changes.
 */

import { describe, expect, it } from "vitest";
import {
  sanitizeIngredientList,
  polishDescriptionText,
} from "../../src/domain/menuCardQuality.js";

describe("ingredient dedup — Danish transliteration equivalence", () => {
  it("(a) 'Kokosmaelk' + 'Kokosmælk' dedupe to one, keeping the source spelling", () => {
    const out = sanitizeIngredientList(["Kokosmaelk", "Kokosmælk"]);
    expect(out).toEqual(["Kokosmaelk"]);
  });

  it("keeps the first-seen spelling when the ASCII form comes second", () => {
    const out = sanitizeIngredientList(["Kokosmælk", "Kokosmaelk"]);
    expect(out).toEqual(["Kokosmælk"]);
  });

  it("(b) 'Hvidløg' + 'Hvidloeg' (ø↔oe) dedupe to one", () => {
    const out = sanitizeIngredientList(["Hvidløg", "Hvidloeg"]);
    expect(out).toEqual(["Hvidløg"]);
  });

  it("polishDescriptionText applies the same fold", () => {
    const out = polishDescriptionText("Kokosmaelk, Kokosmælk");
    expect(out).toBe("Kokosmaelk");
  });

  describe("(c) unrelated words sharing a root/substring do NOT collapse", () => {
    it("'Ris' and 'Risnudler' stay distinct", () => {
      const out = sanitizeIngredientList(["Ris", "Risnudler"]);
      expect(out).toEqual(["Ris", "Risnudler"]);
    });

    it("'Løg' and 'Rødløg' stay distinct", () => {
      const out = sanitizeIngredientList(["Løg", "Rødløg"]);
      expect(out).toEqual(["Løg", "Rødløg"]);
    });

    it("'Kylling' and 'Grillkylling' stay distinct", () => {
      const out = sanitizeIngredientList(["Kylling", "Grillkylling"]);
      expect(out).toEqual(["Kylling", "Grillkylling"]);
    });
  });
});
