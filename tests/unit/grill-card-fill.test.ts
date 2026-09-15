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
    ).toEqual(["Fiskefilet", "Pommes frites"]);
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

  it("builds full baconburger ingredients with meat and sauces", () => {
    const ings = inferGrillIngredients({
      name: "Baconburger",
      categoryName: "Grill",
    });
    expect(ings).toEqual(
      expect.arrayContaining([
        "Oksekød",
        "Bacon",
        "Salat",
        "Tomat",
        "Løg",
        "Ketchup",
        "Mayo",
      ]),
    );
    expect(ings[0]).toMatch(/oksekød/i);
  });

  it("wants dips on fries plates and named combo products, not plain burgers", () => {
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
        variants: [{ name: "Alm." }],
      }),
    ).toBe(false);
    // Menu as variant is forbidden — does not unlock dips on the burger card
    expect(
      productWantsGrillDips({
        name: "Baconburger",
        categoryName: "Grill",
        variants: [{ name: "Alm." }, { name: "Menu" }],
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
  it("fills Grill burger cards with name-derived ingredients and strips Menu variants", () => {
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
    expect(target.ingredients).toEqual(
      expect.arrayContaining([
        "Oksekød",
        "Bacon",
        "Salat",
        "Tomat",
        "Ketchup",
        "Mayo",
      ]),
    );
    expect(target.ingredients.length).toBeGreaterThanOrEqual(6);
    expect(target.variants.map((v) => v.name)).toEqual(["Alm."]);
    expect(target.variants.some((v) => /menu/i.test(v.name))).toBe(false);
  });

  it("strips pommes and valgfri dyppelse from burger Tilbehør", () => {
    const target = buildQaTargetPayload({
      live: {
        databaseId: "40",
        menuNumber: "40",
        name: "Baconburger",
        description: "Bacon",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        ingredients: ["Bacon"],
        variants: [{ name: "Alm.", priceOre: 0 }],
        additions: [
          { name: "M. pommes frites", priceOre: 1000 },
          { name: "Pommes frites", priceOre: 1000 },
          { name: "Valgfri dyppelse", priceOre: 1000 },
          { name: "Salatmayonnaise", priceOre: 1000 },
          { name: "Remoulade", priceOre: 1000 },
          { name: "Ketchup", priceOre: 1000 },
        ],
      },
      sourcePayload: {
        sourceId: "s40",
        menuNumber: "40",
        name: "Baconburger",
        description: "Bacon",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        variants: [{ name: "Alm.", surchargeOre: 0 }],
        ingredients: ["Bacon"],
        additions: [],
        intendedHidden: false,
      },
      liveCategoryName: "Grill",
      destinationCategories: [{ databaseId: "grill", name: "Grill" }],
    });
    expect(target.additions.some((a) => /pommes|dyppelse/i.test(a.name))).toBe(
      false,
    );
    // Plain burgers are sandwich_grill — dips not allowed (only fries plates).
    expect(
      target.additions.some((a) =>
        /mayo|remoulade|ketchup/i.test(a.name),
      ),
    ).toBe(false);
  });

  it("never-worse allows stripping Menu variants", () => {
    const before = [
      { name: "Alm.", priceOre: 0 },
      { name: "Menu", priceOre: 5600 },
    ];
    const after = [{ name: "Alm.", surchargeOre: 0 }];
    const { kept, blocked } = filterNeverWorseDeltas({
      live: {
        databaseId: "40",
        menuNumber: "40",
        name: "Baconburger",
        description: "",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        ingredients: ["Oksekød", "Bacon", "Salat", "Ketchup", "Mayo"],
        variants: before,
        additions: [],
      },
      intended: {
        sourceId: "s40",
        menuNumber: "40",
        name: "Baconburger",
        description: "",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        variants: after,
        ingredients: ["Oksekød", "Bacon", "Salat", "Ketchup", "Mayo"],
        additions: [],
        intendedHidden: false,
      },
      liveCategoryName: "Grill",
      deltas: [
        {
          field: "variants",
          before,
          after,
          reasons: ["VARIANTS_DRIFT"],
        },
      ],
    });
    expect(blocked).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });

  it("upgrades thin Baconburger ingredient list beyond a single token", () => {
    const target = buildQaTargetPayload({
      live: {
        databaseId: "40",
        menuNumber: "40",
        name: "Baconburger",
        description: "Bacon",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        ingredients: ["Bacon"],
        variants: [{ name: "Alm.", priceOre: 0 }],
        additions: [
          { name: "Salatmayonnaise", priceOre: 1000 },
          { name: "Remoulade", priceOre: 1000 },
          { name: "Ketchup", priceOre: 1000 },
        ],
      },
      sourcePayload: {
        sourceId: "s40",
        menuNumber: "40",
        name: "Baconburger",
        description: "Bacon",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        variants: [{ name: "Alm.", surchargeOre: 0 }],
        ingredients: ["Bacon"],
        additions: [],
        intendedHidden: false,
      },
      liveCategoryName: "Grill",
      destinationCategories: [{ databaseId: "grill", name: "Grill" }],
    });
    expect(target.ingredients).toEqual(
      expect.arrayContaining(["Oksekød", "Bacon", "Ketchup", "Mayo"]),
    );
    expect(target.description.toLowerCase()).toContain("oksekød");
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
