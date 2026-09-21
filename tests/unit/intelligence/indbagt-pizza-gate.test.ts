/**
 * WP-F — "indbagt" is a Danish cooking-method word (battered/deep-fried), NOT a
 * pizza/calzone signal. Pizza-topping domain-prior injection must be gated on a
 * genuine pizza/calzone family or an unambiguous pizza-shop token/category.
 *
 * Regression: on an Asian menu, 'Japanske indbagte rejer' etc. no longer get
 * fabricated Tomat/Ost/Skinke. Genuine Veroni-style calzone/pizza dishes keep
 * receiving their toppings.
 */

import { describe, expect, it } from "vitest";
import { completeProductCard } from "../../../src/intelligence/completeProductCard.js";
import { inferProductFamily } from "../../../src/intelligence/peerCohorts.js";
import type { CanonicalProduct } from "../../../src/domain/schema/canonical.js";

function product(name: string, ingredients: string[] = []): CanonicalProduct {
  return {
    sourceId: `src:${name}`,
    categorySourceId: "cat:1",
    sourceOrder: 1,
    name,
    ingredients: ingredients.map((d, i) => ({
      sourceId: `i${i}`,
      display: d,
      name: d,
    })),
    variants: [
      {
        sourceId: "v0",
        name: "Alm.",
        nameOrigin: "SOURCE",
        surcharge: 0,
        surchargeOrigin: "DERIVED",
        isBase: true,
        sourceTotalPrice: 8000,
      },
    ],
    addOns: [],
    productChoices: [],
    isCombo: false,
    status: "READY",
    issues: [],
  } as unknown as CanonicalProduct;
}

const PIZZA_TOKENS = ["Tomat", "Ost", "Skinke"];

function hasPizzaTopping(card: ReturnType<typeof completeProductCard>): boolean {
  return card.ingredients.some((i) =>
    PIZZA_TOKENS.some((t) => t.toLowerCase() === i.toLowerCase()),
  );
}

describe("WP-F — indbagt is not a pizza/calzone signal", () => {
  it("classifies Asian 'indbagt' dishes as OTHER_FOOD, not CALZONE", () => {
    expect(
      inferProductFamily({ name: "Japanske indbagte rejer", categoryName: "Forretter" }),
    ).toBe("OTHER_FOOD");
    expect(
      inferProductFamily({
        name: "Indbagte tigerrejer med sur-sød sauce",
        categoryName: "Seafood",
      }),
    ).toBe("OTHER_FOOD");
    expect(
      inferProductFamily({
        name: "Indbagt kylling med sur-sød sauce",
        categoryName: "Kylling",
      }),
    ).toBe("OTHER_FOOD");
  });

  it("(a) does NOT inject pizza toppings into a non-pizza 'indbagt' dish", () => {
    const card = completeProductCard({
      product: product("Indbagt kylling med sur-sød sauce"),
      categoryName: "Kylling",
    });
    expect(card.productFamily).not.toBe("CALZONE");
    expect(hasPizzaTopping(card)).toBe(false);
    expect(card.ingredients).not.toContain("Tomat");
    expect(card.ingredients).not.toContain("Ost");
    expect(card.ingredients).not.toContain("Skinke");
  });

  it("(a2) does NOT inject pizza toppings into an Asian 'indbagte' (plural) dish", () => {
    const card = completeProductCard({
      product: product("Japanske indbagte rejer (6 stk.)"),
      categoryName: "Forretter",
    });
    expect(hasPizzaTopping(card)).toBe(false);
  });

  it("(b) STILL injects toppings for a genuine calzone-family dish", () => {
    const card = completeProductCard({
      product: product("Calzone - Karan"),
      categoryName: "Indbagt, ufo og calzone",
    });
    expect(card.productFamily).toBe("CALZONE");
    expect(card.ingredients).toContain("Tomat");
    expect(card.ingredients).toContain("Ost");
    expect(card.ingredients).toContain("Skinke");
  });

  it("(b2) STILL injects toppings for a genuine pizza-family dish", () => {
    const card = completeProductCard({
      product: product("Pizza Margherita"),
      categoryName: "Pizzaer",
    });
    expect(card.productFamily).toBe("PIZZA");
    expect(card.ingredients).toContain("Tomat");
    expect(card.ingredients).toContain("Ost");
  });

  it("(c) leaves the un-evidenced Asian dish honestly un-completed (no replacement hallucination)", () => {
    const card = completeProductCard({
      product: product("Indbagte tigerrejer med sur-sød sauce"),
      categoryName: "Seafood",
    });
    // No fabrication: the prior must not invent Italian ingredients.
    expect(card.ingredients).not.toContain("Tomat");
    expect(card.ingredients).not.toContain("Ost");
    expect(card.ingredients).not.toContain("Skinke");
  });
});
