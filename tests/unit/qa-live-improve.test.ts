import { describe, expect, it } from "vitest";
import {
  buildQaTargetPayload,
  classifyMenuPlacementKind,
  fieldQualityScore,
  filterNeverWorseDeltas,
  polishIngredientList,
} from "../../src/planning/qaLiveImprove.js";
import type { PlannedProductPayload } from "../../src/runner/writePlan.js";
import type { LiveProductSnapshot } from "../../src/planning/menuReconcile.js";

function baseLive(over: Partial<LiveProductSnapshot> = {}): LiveProductSnapshot {
  return {
    databaseId: "1",
    menuNumber: "10",
    name: "Margarita",
    description: "Tomat, ost, basilikum",
    basePriceOre: 7700,
    categoryIds: ["pizza"],
    ingredients: ["Tomat", "Ost", "Basilikum"],
    variants: [{ name: "Alm.", priceOre: 0 }],
    additions: [{ name: "Ekstra ost", priceOre: 1500 }],
    ...over,
  };
}

function baseSource(
  over: Partial<PlannedProductPayload> = {},
): PlannedProductPayload {
  return {
    sourceId: "s1",
    menuNumber: "10",
    name: "Margarita",
    description: "",
    basePriceOre: 7700,
    categoryIds: ["pizza"],
    variants: [{ name: "Alm.", surchargeOre: 0 }],
    ingredients: [],
    additions: [],
    intendedHidden: false,
    ...over,
  };
}

describe("qaLiveImprove merge", () => {
  it("keeps richer live description instead of empty source", () => {
    const live = baseLive();
    const target = buildQaTargetPayload({
      live,
      sourcePayload: baseSource({ description: "" }),
      liveCategoryName: "Pizza",
      destinationCategories: [
        { databaseId: "pizza", name: "Pizza" },
        { databaseId: "dip", name: "Tilbehør" },
      ],
    });
    expect(target.description.toLowerCase()).toContain("tomat");
    expect(target.ingredients.length).toBeGreaterThanOrEqual(2);
    expect(target.additions.some((a) => /ost/i.test(a.name))).toBe(true);
  });

  it("fills empty live ingredients from description / source", () => {
    const live = baseLive({
      ingredients: [],
      description: "Tomat, ost, oregano",
    });
    const target = buildQaTargetPayload({
      live,
      sourcePayload: baseSource({
        ingredients: ["Tomat", "Ost", "Oregano"],
        description: "Tomat, ost, oregano",
      }),
      liveCategoryName: "Pizza",
      destinationCategories: [{ databaseId: "pizza", name: "Pizza" }],
    });
    expect(target.ingredients.length).toBeGreaterThan(0);
    expect(target.description.length).toBeGreaterThan(0);
  });

  it("remaps dip products away from Pizza when Tilbehør exists", () => {
    expect(
      classifyMenuPlacementKind({
        name: "Valgfri dyppelse",
        categoryName: "Pizza",
      }),
    ).toBe("dip");

    const live = baseLive({
      name: "Valgfri dyppelse",
      description: "Mayo",
      ingredients: [],
      categoryIds: ["pizza"],
      additions: [],
    });
    const target = buildQaTargetPayload({
      live,
      sourcePayload: baseSource({
        name: "Valgfri dyppelse",
        categoryIds: ["pizza"],
      }),
      liveCategoryName: "Pizza",
      destinationCategories: [
        { databaseId: "pizza", name: "Pizza" },
        { databaseId: "dip", name: "Tilbehør" },
      ],
    });
    expect(target.categoryIds).toEqual(["dip"]);
  });

  it("drops REVIEW variant stubs and polishes glued ingredients", () => {
    expect(polishIngredientList(["- tomat", "ogæg", "syltet 120"])).toEqual([
      "Tomat",
      "Æg",
      "Syltet",
    ]);

    const live = baseLive({
      variants: [{ name: "REVIEW", priceOre: 0 }],
    });
    const target = buildQaTargetPayload({
      live,
      sourcePayload: baseSource({
        variants: [{ name: "Alm.", surchargeOre: 0 }],
      }),
      liveCategoryName: "Pizza",
      destinationCategories: [{ databaseId: "pizza", name: "Pizza" }],
    });
    expect(target.variants.every((v) => v.name !== "REVIEW")).toBe(true);
  });

  it("blocks worse-than-live description overwrite", () => {
    const live = baseLive();
    const intended = {
      ...baseSource({ description: "" }),
      description: "",
      ingredients: live.ingredients!,
      additions: live.additions!,
    };
    const { kept, blocked } = filterNeverWorseDeltas({
      live,
      intended,
      liveCategoryName: "Pizza",
      deltas: [
        {
          field: "description",
          before: live.description,
          after: "",
          reasons: ["DESC_MISMATCH"],
        },
      ],
    });
    expect(kept).toHaveLength(0);
    expect(blocked[0]?.blockReason).toBe("BLOCKED_WORSE_THAN_LIVE");
    expect(fieldQualityScore("description", live.description)).toBeGreaterThan(
      fieldQualityScore("description", ""),
    );
  });
});
