import { describe, expect, it } from "vitest";
import {
  parseChoiceOptions,
  parseSourceComponents,
  splitDanishFoodList,
} from "../../../src/intelligence/sourceComponentParse.js";
import { completeProductCard } from "../../../src/intelligence/completeProductCard.js";
import type { CanonicalProduct } from "../../../src/domain/schema/canonical.js";

function product(partial: Partial<CanonicalProduct> & Pick<CanonicalProduct, "name">): CanonicalProduct {
  return {
    sourceId: "src:1",
    categorySourceId: "cat:1",
    sourceOrder: 1,
    ingredients: [],
    variants: [
      {
        sourceId: "v0",
        name: "Alm.",
        nameOrigin: "SOURCE",
        surcharge: 0,
        surchargeOrigin: "DERIVED",
        isBase: true,
        sourceTotalPrice: 11000,
      },
    ],
    addOns: [],
    productChoices: [],
    isCombo: true,
    status: "READY",
    issues: [],
    ...partial,
  };
}

describe("source combo component parse", () => {
  it("splits kebab, soda and fries from printed combo line", () => {
    expect(splitDanishFoodList("Kebab, sodavand og pomfritter")).toEqual([
      "Kebab",
      "sodavand",
      "pomfritter",
    ]);
  });

  it("parses el. dressing choice", () => {
    expect(
      parseChoiceOptions("Creme fraiche dressing el. tahin dressing"),
    ).toEqual(["Creme fraiche dressing", "tahin dressing"]);
  });

  it("reads combo contents from evidence rawText, not only first ingredient", () => {
    const parsed = parseSourceComponents({
      name: "Durum menu",
      description: "Kebab",
      rawText: "Durum menu Kr. 110\nKebab, sodavand og pomfritter",
      existingIngredients: ["Kebab"],
    });
    expect(parsed.ingredients.map((i) => i.toLowerCase())).toEqual(
      expect.arrayContaining(["kebab", "sodavand", "pomfritter"]),
    );
  });
});

describe("combo completion does not invent grill burgers", () => {
  it("keeps printed combo contents for durum menu", () => {
    const card = completeProductCard({
      product: product({
        name: "Durum menu",
        isCombo: true,
        ingredients: [{ display: "Kebab", origin: "SOURCE" }],
        description: "Kebab",
        evidence: {
          sourceFile: "x",
          rawText: "Durum menu Kr. 110\nKebab, sodavand og pomfritter",
          pageNumber: 1,
          confidence: 0.9,
          extractorVersion: "1",
          origin: "SOURCE_LAYOUT",
        },
      }),
      categoryName: "Durum",
    });
    expect(card.isCombo).toBe(true);
    expect(card.ingredients.map((i) => i.toLowerCase())).toEqual(
      expect.arrayContaining(["kebab", "sodavand", "pomfritter"]),
    );
    expect(card.additions.map((a) => a.name.toLowerCase())).not.toContain(
      "salatmayonnaise",
    );
  });

  it("does not copy pizza toppings onto a price-only derived Menu product", () => {
    const card = completeProductCard({
      product: product({
        name: "Calzone Menu",
        isCombo: true,
        ingredients: [],
        description: "Menu: Calzone",
        evidence: {
          sourceFile: "x",
          rawText: "Calzone\nTomat, ost og skinke",
          pageNumber: 1,
          confidence: 0.9,
          extractorVersion: "1",
          origin: "SOURCE_LAYOUT",
        },
      }),
      categoryName: "Menuer",
    });
    expect(card.isCombo).toBe(true);
    expect(card.ingredients).toEqual([]);
  });

  it("does not treat og in a dish title as printed combo contents", () => {
    const card = completeProductCard({
      product: product({
        name: "Ufo og log Menu",
        isCombo: true,
        ingredients: [],
        description: "Menu: Ufo og log",
        evidence: {
          sourceFile: "x",
          rawText: "Ufo og log\nTomat, ost og kebab",
          pageNumber: 1,
          confidence: 0.9,
          extractorVersion: "1",
          origin: "SOURCE_LAYOUT",
        },
      }),
      categoryName: "Menuer",
    });
    expect(card.ingredients).toEqual([]);
  });

  it("turns ketchup el. mayo into a product choice on nuggets menu", () => {
    const card = completeProductCard({
      product: product({
        name: "Pomfrit og 6 nuggets menu",
        isCombo: true,
        ingredients: [],
        evidence: {
          sourceFile: "x",
          rawText:
            "Pomfrit og 6 nuggets menu Kr. 55\nKetchup el. salat mayonnaise",
          pageNumber: 1,
          confidence: 0.9,
          extractorVersion: "1",
          origin: "SOURCE_LAYOUT",
        },
      }),
      categoryName: "Menuer",
    });
    expect(card.productChoices[0]?.options.length).toBeGreaterThanOrEqual(2);
    expect(card.ingredients.length + (card.productChoices[0]?.options.length ?? 0)).toBeGreaterThanOrEqual(2);
  });
});

describe("wrap cards keep filling plus bread", () => {
  it("adds durumbrød when durum has a single filling", () => {
    const card = completeProductCard({
      product: product({
        name: "Durum",
        isCombo: false,
        ingredients: [{ display: "Falafel", origin: "SOURCE" }],
      }),
      categoryName: "Durum",
    });
    expect(card.isCombo).toBe(false);
    expect(card.ingredients.map((i) => i.toLowerCase())).toEqual(
      expect.arrayContaining(["falafel", "durumbrød"]),
    );
    expect(card.description.trim().length).toBeGreaterThan(0);
  });

  it("completes durum kebab from the name without emptying the card", () => {
    const card = completeProductCard({
      product: product({
        name: "Durum Kebab",
        isCombo: false,
        ingredients: [],
        description: "",
      }),
      categoryName: "Durum",
    });
    expect(card.ingredients.map((i) => i.toLowerCase())).toEqual(
      expect.arrayContaining(["kebab", "durumbrød"]),
    );
    expect(card.description.trim().length).toBeGreaterThan(0);
  });

  it("adds pitabrød beside a source kebab filling", () => {
    const card = completeProductCard({
      product: product({
        name: "Lille pita brød",
        isCombo: false,
        ingredients: [{ display: "Kebab", origin: "SOURCE" }],
      }),
      categoryName: "Pita",
    });
    expect(card.ingredients.map((i) => i.toLowerCase())).toEqual(
      expect.arrayContaining(["kebab", "pitabrød"]),
    );
  });

  it("does not invent kebab on a falafel pita", () => {
    const card = completeProductCard({
      product: product({
        name: "Falafel pita brød",
        isCombo: false,
        ingredients: [{ display: "Falafel", origin: "SOURCE" }],
      }),
      categoryName: "Pita",
    });
    expect(card.ingredients.map((i) => i.toLowerCase())).toContain("falafel");
    expect(card.ingredients.map((i) => i.toLowerCase())).not.toContain("kebab");
  });
});
