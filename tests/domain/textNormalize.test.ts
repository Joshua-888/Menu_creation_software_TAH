import { describe, expect, it, beforeEach } from "vitest";
import {
  assessLabelQuality,
  capitalizeFirstLetter,
  formatIngredientDisplay,
  labelQualityBlocksWrite,
  looksLikeGarbageName,
  looksLikeIngredientListName,
  stripTrailingPriceNoise,
} from "../../src/domain/textNormalize.js";
import {
  clearLearnedOcrIngredientFixes,
  registerOcrIngredientFix,
} from "../../src/domain/learnedTextFixes.js";

describe("textNormalize hygiene", () => {
  beforeEach(() => {
    clearLearnedOcrIngredientFixes();
  });

  it("capitalizes first letter (Salat not salat)", () => {
    expect(capitalizeFirstLetter("salat")).toBe("Salat");
    expect(formatIngredientDisplay("salat")).toBe("Salat");
  });

  it("strips trailing price bleed like dressing 95", () => {
    expect(stripTrailingPriceNoise("dressing 95")).toBe("dressing");
    expect(formatIngredientDisplay("dressing 95")).toBe("Dressing");
    expect(formatIngredientDisplay("salat 180")).toBe("Salat");
  });

  it("applies OCR ingredient fixes including learned ones", () => {
    expect(formatIngredientDisplay("log")).toBe("Løg");
    expect(formatIngredientDisplay("kodsovs")).toBe("Kødsovs");
    registerOcrIngredientFix("champignom", "champignon");
    expect(formatIngredientDisplay("champignom")).toBe("Champignon");
  });

  it("detects ingredient-list-as-name", () => {
    expect(
      looksLikeIngredientListName("Tomat, ost, kebab, salat og dressing"),
    ).toBe(true);
    expect(looksLikeIngredientListName("Pepperoni")).toBe(false);
  });

  it("detects garbage OCR names", () => {
    expect(looksLikeGarbageName("I15,")).toBe(true);
    expect(looksLikeGarbageName("II5,")).toBe(true);
    expect(looksLikeGarbageName("og")).toBe(true);
    expect(looksLikeGarbageName("Gorgonzola 1")).toBe(false);
  });

  it("assessLabelQuality REPAIR for capitalize-only", () => {
    const a = assessLabelQuality({
      name: "pepperoni",
      ingredients: ["tomat", "ost", "pepperoni"],
    });
    expect(a.severity).toBe("REPAIR");
    expect(a.repaired.name).toBe("Pepperoni");
    // Product title matching the ingredient is dropped from the ingredient list
    expect(a.repaired.ingredients).toEqual(["Tomat", "Ost"]);
    expect(labelQualityBlocksWrite(a)).toBe(false);
  });

  it("assessLabelQuality REVIEW for ingredient-list name", () => {
    const a = assessLabelQuality({
      name: "Tomat, ost, kebab, salat og dressing",
      ingredients: ["Tomat", "ost", "kebab", "salat", "dressing 95"],
    });
    expect(a.severity).toBe("REVIEW");
    expect(
      a.reasons.some(
        (r) =>
          r === "name_looks_like_ingredient_list" ||
          r === "name_looks_like_topping" ||
          r === "name_still_has_ingredient_dump",
      ),
    ).toBe(true);
    expect(a.repaired.ingredients).toContain("Dressing");
    expect(labelQualityBlocksWrite(a)).toBe(true);
  });

  it("assessLabelQuality REVIEW for lone topping name Tomat", () => {
    const a = assessLabelQuality({
      name: "Tomat",
      ingredients: ["Tomat", "Ost", "Kebab", "Salat", "Dressing"],
    });
    expect(a.severity).toBe("REVIEW");
    expect(a.reasons).toContain("name_looks_like_topping");
    expect(labelQualityBlocksWrite(a)).toBe(true);
  });

  it("assessLabelQuality still allows Pepperoni as a dish title", () => {
    const a = assessLabelQuality({
      name: "Pepperoni",
      ingredients: ["Tomat", "Ost", "Pepperoni"],
    });
    expect(a.reasons).not.toContain("name_looks_like_topping");
    expect(labelQualityBlocksWrite(a)).toBe(false);
  });

  it("assessLabelQuality REVIEW for junk names like I15,", () => {
    const a = assessLabelQuality({
      name: "I15,",
      ingredients: ["skinke", "champignon", "løg"],
    });
    expect(a.severity).toBe("REVIEW");
    expect(a.reasons).toContain("garbage_product_name");
    expect(labelQualityBlocksWrite(a)).toBe(true);
  });
});
