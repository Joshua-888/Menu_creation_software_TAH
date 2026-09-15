import { describe, expect, it } from "vitest";
import type { PeerMenuSnapshot } from "../../src/learning/peerMenuStructure.js";
import {
  classifyBurgerSubtype,
  distillIngredientLikelihood,
  proposePeerIngredients,
} from "../../src/learning/ingredientLikelihood.js";
import { resolveGrillIngredients } from "../../src/domain/grillCardFill.js";
import { buildQaTargetPayload } from "../../src/planning/qaLiveImprove.js";

function burgerPeers(): PeerMenuSnapshot[] {
  const burger = (name: string, ingredients: string[], description: string) => ({
    menuNumber: name,
    name,
    categoryNames: ["Grill"],
    variants: [{ name: "Alm.", priceOre: 0 }],
    additions: [],
    ingredients,
    description,
  });
  const shared = [
    "Oksekød",
    "Salat",
    "Tomat",
    "Løg",
    "Ketchup",
    "Mayonnaise",
    "Syltet agurk",
  ];
  return [
    {
      host: "peer-a.dk",
      restaurantKey: "peer-a.dk",
      observedAt: "2026-01-01T00:00:00.000Z",
      source: "fixture",
      products: [
        burger("Baconburger", [...shared, "Bacon"], shared.concat("Bacon").join(", ")),
        burger("Cheeseburger", [...shared, "Ost"], shared.concat("Ost").join(", ")),
        burger("Hamburger", shared, shared.join(", ")),
      ],
    },
    {
      host: "peer-b.dk",
      restaurantKey: "peer-b.dk",
      observedAt: "2026-01-01T00:00:00.000Z",
      source: "fixture",
      products: [
        burger("Bacon Burger", [...shared, "Bacon"], "Oksekød, bacon, salat, tomat, ketchup, mayo"),
        burger("Cheese Burger", [...shared, "Ost"], "Oksekød, ost, salat, tomat, ketchup"),
        burger("Classic Burger", shared, "Oksekød, salat, tomat, løg, ketchup, mayonnaise"),
      ],
    },
    {
      host: "peer-c.dk",
      restaurantKey: "peer-c.dk",
      observedAt: "2026-01-01T00:00:00.000Z",
      source: "fixture",
      products: [
        burger("Baconburger Menu", [...shared, "Bacon"], "Oksekød, Bacon, Salat, Tomat, Løg, Ketchup, Mayonnaise"),
        burger("Cheeseburger", [...shared, "Ost"], "Oksekød, Ost, Salat, Tomat, Ketchup, Mayo"),
        burger("Burger", shared, "Oksekød, salat, tomat, ketchup, mayonnaise"),
      ],
    },
  ];
}

describe("ingredientLikelihood", () => {
  it("classifies burger subtypes from names", () => {
    expect(classifyBurgerSubtype("Baconburger")).toBe("baconburger");
    expect(classifyBurgerSubtype("Cheese Burger")).toBe("cheeseburger");
    expect(classifyBurgerSubtype("Cafeteriaburger")).toBe("cafeteriaburger");
    expect(classifyBurgerSubtype("Hamburger")).toBe("burger");
  });

  it("distills ALLOW ingredients for baconburger subtype", () => {
    const policy = distillIngredientLikelihood(burgerPeers());
    expect(policy.bySubtype.baconburger?.nProducts).toBeGreaterThanOrEqual(3);
    const allow = policy.bySubtype.baconburger!.ingredients.filter(
      (i) => i.decision === "ALLOW",
    );
    expect(allow.map((a) => a.displayName.toLowerCase())).toEqual(
      expect.arrayContaining(["oksekød", "bacon", "ketchup"]),
    );
  });

  it("proposes peer ingredients before domain prior", () => {
    const policy = distillIngredientLikelihood(burgerPeers());
    const peer = proposePeerIngredients({
      name: "Baconburger",
      categoryNames: ["Grill"],
      policy,
    });
    expect(peer.source).toBe("PEER_SUBTYPE");
    expect(peer.ingredients.length).toBeGreaterThanOrEqual(4);
    expect(peer.ingredients.join(" ").toLowerCase()).toMatch(/oksekød/);
    expect(peer.ingredients.join(" ").toLowerCase()).toMatch(/bacon/);

    const resolved = resolveGrillIngredients({
      name: "Baconburger",
      categoryName: "Grill",
      ingredientPolicy: policy,
    });
    expect(resolved.source).toBe("PEER_SUBTYPE");
    expect(resolved.ingredients).toEqual(peer.ingredients);
  });

  it("falls back to domain prior when peer policy missing", () => {
    const resolved = resolveGrillIngredients({
      name: "Baconburger",
      categoryName: "Grill",
      ingredientPolicy: null,
    });
    expect(resolved.source).toBe("DOMAIN_PRIOR");
    expect(resolved.ingredients).toEqual(
      expect.arrayContaining(["Oksekød", "Bacon", "Ketchup", "Mayo"]),
    );
  });

  it("QA prefers peer ingredients over thin live card", () => {
    const policy = distillIngredientLikelihood(burgerPeers());
    const target = buildQaTargetPayload({
      live: {
        databaseId: "40",
        menuNumber: "40",
        name: "Baconburger",
        description: "Bacon",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        ingredients: ["Bacon"],
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
        description: "Bacon",
        basePriceOre: 6900,
        categoryIds: ["grill"],
        variants: [
          { name: "Alm.", surchargeOre: 0 },
          { name: "Menu", surchargeOre: 5600 },
        ],
        ingredients: ["Bacon"],
        additions: [],
        intendedHidden: false,
      },
      liveCategoryName: "Grill",
      destinationCategories: [{ databaseId: "grill", name: "Grill" }],
      ingredientLikelihood: policy,
    });
    expect(target.ingredients.length).toBeGreaterThanOrEqual(4);
    expect(target.ingredients.join(" ").toLowerCase()).toMatch(/oksekød/);
    expect(target.ingredients).toEqual(
      expect.arrayContaining(
        proposePeerIngredients({
          name: "Baconburger",
          categoryNames: ["Grill"],
          policy,
        }).ingredients.slice(0, 3),
      ),
    );
  });
});
