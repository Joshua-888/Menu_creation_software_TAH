import { describe, expect, it } from "vitest";
import {
  parseToppingListFromDescription,
  proposePizzaToppingsFromDescription,
  productLooksPizzaLike,
} from "../../src/learning/pizzaToppings.js";
import { stratifiedPeerSample } from "../../src/learning/peerSampling.js";
import { classifyProductKind } from "../../src/learning/categoryLikelihood.js";

describe("pizza topping recovery", () => {
  it("parses Hotchicken-style description and excludes ketchup", () => {
    const { toppings, excludedDips } = parseToppingListFromDescription(
      "Tomat, ost, kylling, ketchup",
    );
    expect(toppings).toEqual(["Tomat", "Ost", "Kylling"]);
    expect(excludedDips.map((d) => d.toLowerCase())).toContain("ketchup");
  });

  it("proposes toppings for pizza with empty ingredients", () => {
    const proposal = proposePizzaToppingsFromDescription({
      name: "Hotchicken",
      categoryName: "Pizza",
      description: "Tomat, ost, kylling",
      existingIngredients: [],
    });
    expect(proposal?.ingredients).toEqual(["Tomat", "Ost", "Kylling"]);
    expect(proposal?.source).toBe("DESCRIPTION_LIST");
  });

  it("does not invent when description has no list", () => {
    expect(
      proposePizzaToppingsFromDescription({
        name: "Hawaii",
        categoryName: "Pizza",
        description: "Vores klassiker",
        existingIngredients: [],
      }),
    ).toBeNull();
  });

  it("does not overwrite existing ingredients", () => {
    expect(
      proposePizzaToppingsFromDescription({
        name: "Hawaii",
        categoryName: "Pizza",
        description: "Tomat, ost, ananas",
        existingIngredients: ["Tomat"],
      }),
    ).toBeNull();
  });

  it("recognizes pizza-like categories", () => {
    expect(
      productLooksPizzaLike({ name: "Josu", categoryName: "Calzone" }),
    ).toBe(true);
    expect(
      productLooksPizzaLike({ name: "Sodavand", categoryName: "Drikkevarer" }),
    ).toBe(false);
  });
});

describe("stratified peer sampling", () => {
  it("includes pizza products even when clustered later in the list", () => {
    const candidates = [
      ...Array.from({ length: 40 }, (_, i) => ({
        name: `Drink ${i}`,
        databaseId: `d${i}`,
      })),
      { name: "Hawaii pizza", databaseId: "p1" },
      { name: "Pepperoni pizza", databaseId: "p2" },
      { name: "Calzone Josu", databaseId: "p3" },
      { name: "Pommes frites", databaseId: "f1" },
    ];
    const sample = stratifiedPeerSample(candidates, { maxSample: 12 });
    const kinds = sample.map((s) => classifyProductKind({ name: s.name }));
    expect(kinds.filter((k) => k === "pizza").length).toBeGreaterThanOrEqual(2);
    expect(kinds).toContain("finger_food");
    expect(sample.length).toBeLessThanOrEqual(12);
  });
});
