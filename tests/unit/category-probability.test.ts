import { describe, expect, it } from "vitest";
import {
  classifyProductKind,
  distillProbabilityPolicy,
  filterAdditionsForProduct,
  estimateKindProbabilities,
} from "../../src/learning/categoryLikelihood.js";
import type { PeerMenuSnapshot } from "../../src/learning/peerMenuStructure.js";

function snap(
  host: string,
  products: Array<{
    name: string;
    additions: string[];
    categoryNames?: string[];
  }>,
): PeerMenuSnapshot {
  return {
    host,
    restaurantKey: host,
    observedAt: "2026-01-01T00:00:00.000Z",
    source: "fixture",
    products: products.map((p, i) => ({
      menuNumber: String(i + 1),
      name: p.name,
      ...(p.categoryNames ? { categoryNames: p.categoryNames } : {}),
      variants: [{ name: "Alm.", priceOre: 0 }],
      additions: p.additions.map((name) => ({ name, priceOre: 1000 })),
    })),
  };
}

describe("category probability learning", () => {
  it("classifies finger food vs pizza vs drinks", () => {
    expect(classifyProductKind({ name: "Pommes frites" })).toBe("finger_food");
    expect(classifyProductKind({ name: "Nuggets (10stk.)" })).toBe("finger_food");
    expect(classifyProductKind({ name: "Nachos med kylling" })).toBe("nachos");
    expect(classifyProductKind({ name: "Hawaii" })).toBe("pizza");
    expect(classifyProductKind({ name: "Pepperoni pizza" })).toBe("pizza");
    expect(classifyProductKind({ name: "Sodavand" })).toBe("drinks");
  });

  it("estimates high P(dip|finger_food) and low P(dip|pizza) from peers", () => {
    const peers = [
      snap("a.dk", [
        { name: "Pommes frites", additions: ["Ketchup", "Remoulade"] },
        { name: "Nuggets", additions: ["Ketchup", "Salatmayonnaise"] },
        { name: "Pommes frites stor", additions: ["Ketchup"] },
        { name: "Pizza Vesuvio", additions: ["Extra ost", "Champignon"] },
        { name: "Pizza Hawaii", additions: ["Ananas", "Skinke"] },
        { name: "Pizza Pepperoni", additions: ["Pepperoni ekstra"] },
        { name: "Sodavand", additions: [] },
        { name: "Cola", additions: [] },
      ]),
      snap("b.dk", [
        { name: "Pommes frites", additions: ["Remoulade", "Ketchup"] },
        { name: "Nuggets m. pommes", additions: ["Ketchup"] },
        { name: "Calzone", additions: ["Champignon"] },
        { name: "Pizza Margherita", additions: ["Extra ost"] },
        { name: "Kildevand", additions: [] },
      ]),
    ];
    const rows = estimateKindProbabilities(peers);
    const finger = rows.find((r) => r.kind === "finger_food")!;
    const pizza = rows.find((r) => r.kind === "pizza")!;
    const drinks = rows.find((r) => r.kind === "drinks")!;
    expect(finger.features.dip.pHat).toBeGreaterThan(0.8);
    expect(pizza.features.dip.pHat).toBeLessThan(0.2);
    expect(drinks.features.any_addition.pHat).toBe(0);
    expect(finger.features.dip.decision).toBe("ALLOW");
  });

  it("policy allows dips only on finger/menu; strips dips from pizza/nachos/drinks; no meat on vegetarian", () => {
    const peers = [
      snap("a.dk", [
        { name: "Pommes frites", additions: ["Ketchup", "Remoulade"] },
        { name: "Nuggets", additions: ["Ketchup"] },
        { name: "Kebabmenu", additions: ["Ketchup", "Remoulade"] },
        { name: "Pizza Hawaii", additions: ["Ketchup", "Extra ost"] }, // noisy peer
        { name: "Nachos med kylling", additions: ["Ketchup"] },
        { name: "Sodavand", additions: ["Ketchup"] },
        {
          name: "Falafel tallerken",
          additions: ["Kebab", "Salat"],
          categoryNames: ["Vegetar"],
        },
      ]),
    ];
    const policy = distillProbabilityPolicy(peers);
    expect(policy.policy.dipAllowKinds).toEqual(
      expect.arrayContaining(["finger_food", "menu_with_fries"]),
    );
    expect(policy.policy.dipAllowKinds).not.toContain("sandwich_grill");
    expect(policy.policy.dipDenyKinds).toEqual(
      expect.arrayContaining(["pizza", "nachos", "drinks", "sandwich_grill"]),
    );
    expect(policy.policy.neverTilbehorKinds).toContain("drinks");
    expect(policy.policy.neverMeatAddKinds).toContain("vegetarian");

    const pizzaFiltered = filterAdditionsForProduct({
      name: "Nachos med kylling",
      additions: [
        { name: "Salatmayonnaise", priceOre: 1000 },
        { name: "Remoulade", priceOre: 1000 },
        { name: "Extra ost", priceOre: 1500 },
      ],
      policy,
    });
    expect(pizzaFiltered.map((a) => a.name)).toEqual(["Extra ost"]);

    const fries = filterAdditionsForProduct({
      name: "Pommes frites",
      additions: [
        { name: "Salatmayonnaise", priceOre: 1000 },
        { name: "Ketchup", priceOre: 1000 },
      ],
      policy,
    });
    expect(fries).toHaveLength(2);

    const drink = filterAdditionsForProduct({
      name: "Sodavand",
      additions: [{ name: "Ketchup", priceOre: 1000 }],
      policy,
    });
    expect(drink).toHaveLength(0);

    const veg = filterAdditionsForProduct({
      name: "Falafel",
      categoryNames: ["Vegetar"],
      additions: [
        { name: "Kebab", priceOre: 2000 },
        { name: "Dressing", priceOre: 1000 },
      ],
      policy,
    });
    expect(veg.map((a) => a.name)).toEqual(["Dressing"]);
  });

  it("denies dips on sandwich unless menu with pommes", () => {
    const peers = [
      snap("a.dk", [
        { name: "Pommes frites", additions: ["Ketchup"] },
        { name: "Club Sandwich", additions: ["Ketchup", "Remoulade"] },
        { name: "Burger menu med pommes", additions: ["Ketchup"] },
      ]),
    ];
    const policy = distillProbabilityPolicy(peers);
    expect(classifyProductKind({ name: "Club Sandwich" })).toBe(
      "sandwich_grill",
    );
    expect(
      classifyProductKind({ name: "Burger menu med pommes" }),
    ).toBe("menu_with_fries");
    expect(
      filterAdditionsForProduct({
        name: "Club Sandwich",
        additions: [{ name: "Ketchup", priceOre: 1000 }],
        policy,
      }),
    ).toHaveLength(0);
    expect(
      filterAdditionsForProduct({
        name: "Burger menu med pommes",
        additions: [{ name: "Ketchup", priceOre: 1000 }],
        policy,
      }),
    ).toHaveLength(1);
  });
});
