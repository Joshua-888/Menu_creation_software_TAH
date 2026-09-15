import { describe, expect, it } from "vitest";
import {
  grillTilbehorLooksWrong,
  inferGrillDescription,
  inferGrillIngredients,
  preferGrillDipAdditions,
  productWantsGrillDips,
} from "../../src/domain/grillCardFill.js";
import {
  buildQaTargetPayload,
  fieldQualityScore,
  filterNeverWorseDeltas,
} from "../../src/planning/qaLiveImprove.js";

describe("grillCardFill", () => {
  it("infers pommes ingredients and kebabmenu copy from names", () => {
    expect(
      inferGrillIngredients({
        name: "Fiskefilet m. pommes frites",
        categoryName: "Grill",
      }),
    ).toEqual(["Pommes frites"]);
    expect(
      inferGrillIngredients({
        name: "Kebabmenu",
        categoryName: "Grill",
      }),
    ).toEqual(["Pitabrød", "Pommes frites", "Sodavand"]);
    expect(
      inferGrillDescription({
        name: "Kebabmenu",
        categoryName: "Grill",
        description: "Pommes frites, M. pommes frites",
      }),
    ).toMatch(/pitabrød/i);
  });

  it("wants dips on fries plates and Menu burgers, not plain name-only sides without fries", () => {
    expect(
      productWantsGrillDips({
        name: "Pommes",
        categoryName: "Grill",
        description: "Valgfri dyppelse",
      }),
    ).toBe(true);
    expect(
      productWantsGrillDips({
        name: "Baconburger",
        categoryName: "Grill",
        variants: [{ name: "Alm." }, { name: "Menu" }],
      }),
    ).toBe(true);
    expect(
      productWantsGrillDips({
        name: "Baconburger",
        categoryName: "Grill",
        variants: [{ name: "Alm." }],
      }),
    ).toBe(false);
  });

  it("replaces pizza-dump Tilbehør with restaurant dips", () => {
    const wrong = [
      { name: "Skinke", priceOre: 1000 },
      { name: "Bacon", priceOre: 2000 },
      { name: "Champignon", priceOre: 1000 },
      { name: "Pepperoni", priceOre: 2000 },
      { name: "Kebab", priceOre: 2000 },
      { name: "Ost", priceOre: 1000 },
    ];
    expect(
      grillTilbehorLooksWrong(wrong, {
        name: "Pommes",
        categoryName: "Grill",
      }),
    ).toBe(true);
    const fixed = preferGrillDipAdditions(wrong, {
      name: "Pommes",
      categoryName: "Grill",
    });
    expect(fixed.map((a) => a.name)).toEqual([
      "Salatmayonnaise",
      "Remoulade",
      "Ketchup",
    ]);
  });
});

describe("qaLiveImprove grill", () => {
  it("fills Grill burger Menu cards with dips and name-derived ingredients", () => {
    const target = buildQaTargetPayload({
      live: {
        databaseId: "40",
        menuNumber: "40",
        name: "Baconburger",
        description: "",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        ingredients: [],
        variants: [
          { name: "Alm.", priceOre: 0 },
          { name: "Menu", priceOre: 5600 },
        ],
        additions: [],
      },
      sourcePayload: {
        sourceId: "s40",
        menuNumber: "40",
        name: "Baconburger",
        description: "",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        variants: [
          { name: "Alm.", surchargeOre: 0 },
          { name: "Menu", surchargeOre: 5600 },
        ],
        ingredients: [],
        additions: [],
        intendedHidden: false,
      },
      liveCategoryName: "Grill",
      destinationCategories: [{ databaseId: "grill", name: "Grill" }],
    });
    expect(target.ingredients).toContain("Bacon");
    expect(target.additions.map((a) => a.name)).toEqual([
      "Salatmayonnaise",
      "Remoulade",
      "Ketchup",
    ]);
  });

  it("never-worse allows replacing pizza-dump Tilbehør on Pommes with dips", () => {
    const before = [
      { name: "Skinke", priceOre: 1000 },
      { name: "Bacon", priceOre: 2000 },
      { name: "Champignon", priceOre: 1000 },
      { name: "Pepperoni", priceOre: 2000 },
      { name: "Kebab", priceOre: 2000 },
      { name: "Ost", priceOre: 1000 },
      { name: "Tomat", priceOre: 1000 },
      { name: "Løg", priceOre: 1000 },
    ];
    const after = [
      { name: "Salatmayonnaise", priceOre: 1000 },
      { name: "Remoulade", priceOre: 1000 },
      { name: "Ketchup", priceOre: 1000 },
    ];
    expect(
      fieldQualityScore("additions", after, {
        productName: "Pommes",
        categoryName: "Grill",
      }),
    ).toBeGreaterThan(
      fieldQualityScore("additions", before, {
        productName: "Pommes",
        categoryName: "Grill",
      }),
    );
    const { kept, blocked } = filterNeverWorseDeltas({
      live: {
        databaseId: "48",
        menuNumber: "48",
        name: "Pommes",
        description: "Valgfri dyppelse",
        basePriceOre: 4000,
        categoryIds: ["grill"],
        ingredients: [],
        variants: [{ name: "Alm.", priceOre: 0 }],
        additions: before,
      },
      intended: {
        sourceId: "s48",
        menuNumber: "48",
        name: "Pommes",
        description: "Valgfri dyppelse",
        basePriceOre: 4000,
        categoryIds: ["grill"],
        variants: [{ name: "Alm.", surchargeOre: 0 }],
        ingredients: ["Pommes frites"],
        additions: after,
        intendedHidden: false,
      },
      liveCategoryName: "Grill",
      deltas: [
        {
          field: "additions",
          before,
          after,
          reasons: ["ADDITIONS_MISMATCH"],
        },
      ],
    });
    expect(blocked).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });
});
