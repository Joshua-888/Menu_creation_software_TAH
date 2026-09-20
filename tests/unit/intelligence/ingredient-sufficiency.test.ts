/**
 * WP2 — ingredient sufficiency assessor.
 *
 * Isolated unit coverage for `assessIngredientSufficiency`: verifies structural,
 * per-family judgement replaces the naive `length >= 2` heuristic, and that
 * unknown inputs stay UNRESOLVED rather than being fabricated. Nothing here
 * wires the assessor into runtime — that is a later WP.
 */

import { describe, expect, it } from "vitest";
import { assessIngredientSufficiency } from "../../../src/intelligence/ingredientSufficiency.js";

const BURGER_NAME = "Baconburger";

function burger(ingredients: string[]): ReturnType<typeof assessIngredientSufficiency> {
  return assessIngredientSufficiency("BURGER", undefined, ingredients, BURGER_NAME);
}

describe("WP2 ingredient sufficiency", () => {
  describe("burger-like families", () => {
    it("Baconburger with only ['Bacon'] is INSUFFICIENT", () => {
      expect(burger(["Bacon"])).toBe("INSUFFICIENT");
    });

    it("tags-only burger list is INSUFFICIENT", () => {
      expect(burger(["Løg", "Tomat"])).toBe("INSUFFICIENT");
    });

    it("complete burger build is SUFFICIENT", () => {
      expect(
        burger(["Oksekød", "Bacon", "Salat", "Tomat", "Løg", "Ketchup", "Mayo"]),
      ).toBe("SUFFICIENT");
    });

    it("meat without sauce/greens is INSUFFICIENT", () => {
      expect(burger(["Oksekød"])).toBe("INSUFFICIENT");
    });

    it("empty list is UNRESOLVED (no evidence, not a below-bar failure)", () => {
      expect(burger([])).toBe("UNRESOLVED");
    });

    it("vegetarian burger is not forced to satisfy the meat rule", () => {
      // Two structural tokens (patty + bun) are enough for a vegetarian line.
      expect(
        assessIngredientSufficiency(
          "BURGER",
          undefined,
          ["Vegetarbøf", "Burgerbolle"],
          "Veggieburger",
        ),
      ).toBe("SUFFICIENT");
    });

    it("BACON_BURGER and CHEESE_BURGER use the same structural bar", () => {
      expect(assessIngredientSufficiency("BACON_BURGER", undefined, ["Bacon"], BURGER_NAME)).toBe(
        "INSUFFICIENT",
      );
      expect(assessIngredientSufficiency("CHEESE_BURGER", undefined, ["Ost"], "Cheeseburger")).toBe(
        "INSUFFICIENT",
      );
    });
  });

  describe("pizza-like families", () => {
    it("pizza with only ['Tomat','Løg'] lacks a substantive topping → PARTIAL", () => {
      // Reasoning: a pizza base (tomat/bund) is present but no cheese/protein
      // topping exists. Evidence exists, so not UNRESOLVED; the product is not a
      // complete pizza, so not SUFFICIENT. Therefore PARTIAL.
      expect(assessIngredientSufficiency("PIZZA", undefined, ["Tomat", "Løg"], "Margherita")).toBe(
        "PARTIAL",
      );
    });

    it("complete pizza (base + cheese/protein) is SUFFICIENT", () => {
      expect(
        assessIngredientSufficiency("PIZZA", undefined, ["Tomat", "Ost", "Skinke"], "Vesuvio"),
      ).toBe("SUFFICIENT");
    });

    it("topping without any base is PARTIAL", () => {
      expect(assessIngredientSufficiency("PIZZA", undefined, ["Skinke"], "Vesuvio")).toBe(
        "PARTIAL",
      );
    });

    it("unrecognised pizza tokens are INSUFFICIENT", () => {
      expect(assessIngredientSufficiency("PIZZA", undefined, ["Xyz"], "Pizza")).toBe(
        "INSUFFICIENT",
      );
    });

    it("empty pizza list is UNRESOLVED", () => {
      expect(assessIngredientSufficiency("PIZZA", undefined, [], "Pizza")).toBe("UNRESOLVED");
    });
  });

  describe("non-food families", () => {
    it("drink always returns NOT_APPLICABLE", () => {
      expect(assessIngredientSufficiency("DRINK", undefined, [], "Cola")).toBe("NOT_APPLICABLE");
      expect(assessIngredientSufficiency("DRINK", undefined, ["Vand"], "Cola")).toBe(
        "NOT_APPLICABLE",
      );
    });

    it("combo menu returns NOT_APPLICABLE (contents live in comboComponents)", () => {
      expect(assessIngredientSufficiency("COMBO_MENU", undefined, ["Pommes"], "Kebabmenu")).toBe(
        "NOT_APPLICABLE",
      );
    });
  });

  describe("other structural families", () => {
    it("pasta needs base + sauce", () => {
      expect(assessIngredientSufficiency("PASTA", undefined, ["Spaghetti", "Carbonara"], "Pasta Carbonara")).toBe(
        "SUFFICIENT",
      );
      expect(assessIngredientSufficiency("PASTA", undefined, ["Spaghetti"], "Pasta")).toBe(
        "PARTIAL",
      );
    });

    it("recognises Danish compound sauces (Kødsovs, Flødesovs) as the sauce slot", () => {
      // WP2 correction (found during WP5 integration): the SAUCE_RE token set
      // used a leading word boundary before "sovs", which never fires on Danish
      // compound nouns because the boundary sits before the modifier, not the
      // head noun "sovs". A structurally complete pasta was therefore falsely
      // PARTIAL. The matcher now also accepts any word ending in "sovs".
      expect(
        assessIngredientSufficiency("PASTA", undefined, ["Spaghetti", "Kødsovs"], "Spaghetti Bolognese"),
      ).toBe("SUFFICIENT");
      expect(
        assessIngredientSufficiency("PASTA", undefined, ["Penne", "Flødesovs"], "Pasta med fløde"),
      ).toBe("SUFFICIENT");
    });

    it("does not overcorrect: a base with no sauce stays PARTIAL", () => {
      expect(assessIngredientSufficiency("PASTA", undefined, ["Spaghetti"], "Pasta")).toBe(
        "PARTIAL",
      );
      expect(assessIngredientSufficiency("PASTA", undefined, ["Kartofler"], "Pasta")).toBe(
        "INSUFFICIENT",
      );
    });

    it("durum needs bread + filling", () => {
      expect(
        assessIngredientSufficiency("DURUM", undefined, ["Durumbrød", "Kebab"], "Durum Kebab"),
      ).toBe("SUFFICIENT");
    });

    it("fries only need a recognizable potato/protein token", () => {
      expect(assessIngredientSufficiency("FRIES", undefined, ["Pommes frites"], "Pommes")).toBe(
        "SUFFICIENT",
      );
    });
  });

  describe("unknown / unclassifiable food", () => {
    it("one vague ingredient → UNRESOLVED (route to review, do not fabricate)", () => {
      expect(assessIngredientSufficiency("UNKNOWN", undefined, ["Ting"], "Special")).toBe(
        "UNRESOLVED",
      );
    });

    it("OTHER_FOOD with a single vague ingredient → UNRESOLVED", () => {
      expect(assessIngredientSufficiency("OTHER_FOOD", undefined, ["Blandet"], "Blandet ret")).toBe(
        "UNRESOLVED",
      );
    });

    it("unknown food with two ingredients is SUFFICIENT", () => {
      expect(assessIngredientSufficiency("UNKNOWN", undefined, ["A", "B"], "Special")).toBe(
        "SUFFICIENT",
      );
    });
  });

  it("is pure: repeated calls with equal inputs return equal statuses", () => {
    const inputs: string[] = ["Oksekød", "Salat", "Mayo"];
    const before = [...inputs];
    const first = burger(inputs);
    const second = burger(inputs);
    expect(first).toBe(second);
    expect(inputs).toEqual(before);
  });

  it("ignores blank/whitespace ingredient tokens", () => {
    expect(burger(["  ", ""])).toBe("UNRESOLVED");
  });
});
