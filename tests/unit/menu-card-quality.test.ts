import { describe, expect, it } from "vitest";
import {
  cleanDishDisplayName,
  defaultTilbehorPriceOre,
  isInvalidFoodComponent,
  polishDescriptionText,
  repriceTilbehorList,
  sanitizeAdditionList,
  sanitizeIngredientList,
  splitGluedFoodToken,
  TILBEHOR_MEAT_PRICE_ORE,
  TILBEHOR_VEG_PRICE_ORE,
} from "../../src/domain/menuCardQuality.js";
import { buildQaTargetPayload } from "../../src/planning/qaLiveImprove.js";
import type { PlannedProductPayload } from "../../src/runner/writePlan.js";
import type { LiveProductSnapshot } from "../../src/planning/menuReconcile.js";

describe("menuCardQuality policies", () => {
  it("splits glued Skinkeog ananas / pølse into separate foods", () => {
    expect(splitGluedFoodToken("Skinkeog ananas")).toEqual([
      "Skinke",
      "Ananas",
    ]);
    expect(splitGluedFoodToken("Skinkeog pølse")).toEqual([
      "Skinke",
      "Pølse",
    ]);
    expect(
      sanitizeIngredientList(["Skinkeog ananas", "Ost"], "Hawaii"),
    ).toEqual(["Skinke", "Ananas", "Ost"]);
  });

  it("drops product name and Tilbehør meta as ingredients", () => {
    expect(isInvalidFoodComponent("Margarita", "Margarita")).toBe(true);
    expect(isInvalidFoodComponent("Tilbehør", "Fried noodles")).toBe(true);
    expect(isInvalidFoodComponent("Tilbehor", "Fried noodles")).toBe(true);
    expect(isInvalidFoodComponent("Ost", "Margarita")).toBe(false);
    expect(
      sanitizeIngredientList(["Margarita", "Tomat", "Ost"], "Margarita"),
    ).toEqual(["Tomat", "Ost"]);
  });

  it("drops dish-name and junk Tilbehør like Benja / Nordgårds", () => {
    const cleaned = sanitizeAdditionList(
      [
        { name: "Bacon", priceOre: 1000 },
        { name: "Benja", priceOre: 1000 },
        { name: "Margarita", priceOre: 1000 },
        { name: "Nordgårds", priceOre: 1000 },
        { name: "Champignon", priceOre: 1000 },
      ],
      "Margarita",
    );
    expect(cleaned.map((a) => a.name)).toEqual(["Bacon", "Champignon"]);
  });

  it("prices meat Tilbehør at double vegetable baseline", () => {
    expect(defaultTilbehorPriceOre("Bacon")).toBe(TILBEHOR_MEAT_PRICE_ORE);
    expect(defaultTilbehorPriceOre("Champignon")).toBe(TILBEHOR_VEG_PRICE_ORE);
    const priced = repriceTilbehorList([
      { name: "Bacon", priceOre: 1000 },
      { name: "Champignon", priceOre: 1000 },
      { name: "Kebab", priceOre: 1000 },
    ]);
    expect(priced.find((a) => a.name === "Bacon")?.priceOre).toBe(2000);
    expect(priced.find((a) => a.name === "Champignon")?.priceOre).toBe(1000);
    expect(priced.find((a) => a.name === "Kebab")?.priceOre).toBe(2000);
  });

  it("strips ingredient dumps from Ufo Glori style names", () => {
    const out = cleanDishDisplayName(
      "Ufo –Glori kodsovs, spaghetti, syltet paprika og log",
    );
    expect(out.name.toLowerCase()).toMatch(/ufo/);
    expect(out.name.toLowerCase()).toMatch(/glori/);
    expect(out.name.toLowerCase()).not.toMatch(/spaghetti/);
    expect(out.name.toLowerCase()).not.toMatch(/kodsovs|kødsovs/);
  });

  it("fixes Tomat og, ost style descriptions", () => {
    expect(polishDescriptionText("Tomat og, ost", "Margarita")).toBe(
      "Tomat, Ost",
    );
    expect(
      polishDescriptionText("Tomat, Ost, Skinkeog ananas", "Hawaii"),
    ).toBe("Tomat, Ost, Skinke, Ananas");
  });
});

describe("QA merge applies menu-card policies", () => {
  it("fixes Margarita card defects end-to-end", () => {
    const live: LiveProductSnapshot = {
      databaseId: "1",
      menuNumber: "1",
      name: "Margarita",
      description: "Tomat og, ost",
      basePriceOre: 7700,
      categoryIds: ["pizza"],
      ingredients: ["Margarita", "Tomat", "Ost"],
      variants: [{ name: "Alm.", priceOre: 0 }],
      additions: [
        { name: "Bacon", priceOre: 1000 },
        { name: "Benja", priceOre: 1000 },
        { name: "Margarita", priceOre: 1000 },
        { name: "Champignon", priceOre: 1000 },
      ],
    };
    const source: PlannedProductPayload = {
      sourceId: "s1",
      menuNumber: "1",
      name: "Margarita",
      description: "",
      basePriceOre: 7700,
      categoryIds: ["pizza"],
      variants: [{ name: "Alm.", surchargeOre: 0 }],
      ingredients: [],
      additions: [],
      intendedHidden: false,
    };
    const target = buildQaTargetPayload({
      live,
      sourcePayload: source,
      liveCategoryName: "Pizza",
      destinationCategories: [{ databaseId: "pizza", name: "Pizza" }],
    });
    expect(target.ingredients).toEqual(["Tomat", "Ost"]);
    expect(target.description.toLowerCase()).not.toMatch(/og,/);
    expect(target.additions.map((a) => a.name)).not.toContain("Benja");
    expect(target.additions.map((a) => a.name)).not.toContain("Margarita");
    expect(target.additions.find((a) => a.name === "Bacon")?.priceOre).toBe(
      2000,
    );
  });

  it("splits Hawaii Skinkeog ananas and cleans Ufo name", () => {
    const hawaii = buildQaTargetPayload({
      live: {
        databaseId: "3",
        menuNumber: "3",
        name: "Hawaii",
        description: "Tomat, Ost, Skinkeog ananas",
        basePriceOre: 9500,
        categoryIds: ["pizza"],
        ingredients: ["Tomat", "Ost", "Skinkeog ananas"],
        variants: [{ name: "Alm.", priceOre: 0 }],
        additions: [{ name: "Benja", priceOre: 1000 }],
      },
      sourcePayload: {
        sourceId: "s3",
        menuNumber: "3",
        name: "Hawaii",
        description: "",
        basePriceOre: 9500,
        categoryIds: ["pizza"],
        variants: [{ name: "Alm.", surchargeOre: 0 }],
        ingredients: [],
        additions: [],
        intendedHidden: false,
      },
      liveCategoryName: "Pizza",
      destinationCategories: [{ databaseId: "pizza", name: "Pizza" }],
    });
    expect(hawaii.ingredients).toEqual(["Tomat", "Ost", "Skinke", "Ananas"]);
    expect(hawaii.additions.some((a) => a.name === "Benja")).toBe(false);

    const ufo = buildQaTargetPayload({
      live: {
        databaseId: "26",
        menuNumber: "26",
        name: "Ufo –Glori kodsovs, spaghetti, syltet paprika og log",
        description: "Tomat, Ost, Kødsovs",
        basePriceOre: 10500,
        categoryIds: ["calzone"],
        ingredients: ["Tomat", "Ost", "Kødsovs"],
        variants: [{ name: "Alm.", priceOre: 0 }],
        additions: [{ name: "Tilbehor", priceOre: 1000 }],
      },
      sourcePayload: {
        sourceId: "s26",
        menuNumber: "26",
        name: "Ufo Glori",
        description: "",
        basePriceOre: 10500,
        categoryIds: ["calzone"],
        variants: [{ name: "Alm.", surchargeOre: 0 }],
        ingredients: [],
        additions: [],
        intendedHidden: false,
      },
      liveCategoryName: "Indbagt, Ufo og Calzone",
      destinationCategories: [
        { databaseId: "calzone", name: "Indbagt, Ufo og Calzone" },
      ],
    });
    expect(ufo.name.toLowerCase()).not.toMatch(/spaghetti/);
    expect(ufo.additions.some((a) => /tilbeh/i.test(a.name))).toBe(false);
  });
});
