/**
 * WP3 — addition candidate-pool resolver unit tests.
 *
 * Proves the "first non-empty source wins" defect is fixed: candidates from ALL
 * evidence tiers are collected, a sparse higher-tier set is supplemented from
 * lower tiers, existing semantic exclusion rules are reused, and an unknown price
 * is reported as UNRESOLVED instead of an invented 1000/1500 constant.
 */
import { describe, expect, it } from "vitest";
import {
  buildAdditionCandidatePool,
  isAdditionSetSufficient,
  resolveAdditionCandidates,
  resolveAdditionPrice,
} from "../../../src/intelligence/additionCandidatePool.js";
import { lookupPeerAdditionPrice } from "../../../src/learning/peerAdditionPriceBenchmark.js";
import { completeProductCard } from "../../../src/intelligence/completeProductCard.js";
import type { CanonicalProduct } from "../../../src/domain/schema/canonical.js";

const BURGER = {
  productName: "Cheeseburger",
  categoryName: "Burgers",
  family: "CHEESE_BURGER" as const,
};

const PIZZA = {
  productName: "Margherita",
  categoryName: "Pizza",
  family: "PIZZA" as const,
};

const DRINK = {
  productName: "Cola",
  categoryName: "Drikkevarer",
  family: "DRINK" as const,
};

const VEG_PIZZA = {
  // NB: the existing vegetarian detector uses \b(vegetar|vegan|falafel)\b, so a
  // glued "Vegetarpizza" is NOT detected; use the spaced form the pipeline uses.
  productName: "Vegetar Pizza",
  categoryName: "Vegetar",
  family: "SALATPIZZA" as const,
};

describe("addition candidate pool", () => {
  it("(a) burger with zero source additions gets a natural domain-prior set", () => {
    const pool = buildAdditionCandidatePool({
      ...BURGER,
      domainPriorAdditions: [
        { name: "Bacon" },
        { name: "Ost" },
        { name: "Salat" }, // rejected by the EXISTING classifier (CATEGORY)
        { name: "Tomat" },
        { name: "Løg" },
      ],
    });
    const { selected, rejected } = resolveAdditionCandidates(pool, BURGER);
    expect(selected.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Bacon", "Ost", "Tomat", "Løg"]),
    );
    expect(selected.length).toBeGreaterThanOrEqual(3);
    // Reuses the shipped classifier: "Salat" parses as a category heading, so it
    // is not a valid addition entity. Documented, not reimplemented.
    const salat = rejected.find((r) => r.candidate.name === "Salat");
    expect(salat?.reason).toBe("invalid_addition_entity");
  });

  it("(b) burger with one non-empty but insufficient addition is supplemented", () => {
    const pool = buildAdditionCandidatePool({
      ...BURGER,
      sourceAdditions: [{ name: "Ekstra ost", priceOre: 1500 }],
      domainPriorAdditions: [{ name: "Bacon" }, { name: "Salat" }],
    });
    const { selected } = resolveAdditionCandidates(pool, BURGER);
    // The single source addition must survive, AND be topped up from lower tiers.
    expect(selected.some((c) => c.name === "Ekstra ost")).toBe(true);
    expect(selected.some((c) => c.name === "Bacon")).toBe(true);
    expect(selected.length).toBeGreaterThan(1);
  });

  it("(c) category-ingredient-union AND peer stats BOTH contribute (core bug fix)", () => {
    const pool = buildAdditionCandidatePool({
      ...PIZZA,
      categoryIngredientAdditions: [{ name: "Ost" }],
      peerCategoryAdditions: [{ name: "Pepperoni" }],
    });
    const { selected } = resolveAdditionCandidates(pool, PIZZA);
    // Old `sets.find(...)` behaviour would have returned only the first set.
    expect(selected.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Ost", "Pepperoni"]),
    );
  });

  it("(d) drink never receives food additions", () => {
    const pool = buildAdditionCandidatePool({
      ...DRINK,
      sourceAdditions: [{ name: "Bacon", priceOre: 2000 }],
      domainPriorAdditions: [{ name: "Ketchup" }],
    });
    const { selected, rejected } = resolveAdditionCandidates(pool, DRINK);
    expect(selected).toEqual([]);
    expect(rejected.some((r) => r.reason === "drink_food_addition")).toBe(true);
  });

  it("(e) vegetarian product never receives meat additions", () => {
    const pool = buildAdditionCandidatePool({
      ...VEG_PIZZA,
      categoryIngredientAdditions: [{ name: "Oksekød" }, { name: "Tomat" }],
    });
    const { selected, rejected } = resolveAdditionCandidates(pool, VEG_PIZZA);
    expect(selected.some((c) => c.name === "Oksekød")).toBe(false);
    expect(selected.some((c) => c.name === "Tomat")).toBe(true);
    expect(
      rejected.some((r) => r.reason === "vegetarian_meat_addition"),
    ).toBe(true);
  });

  it("(f) unresolved price returns null/UNRESOLVED, never 1000/1500", () => {
    const direct = resolveAdditionPrice({ name: "Ost", benchmark: null });
    expect(direct.priceOre).toBeNull();
    expect(direct.source).toBe("UNRESOLVED");

    const pool = buildAdditionCandidatePool({
      ...PIZZA,
      domainPriorAdditions: [{ name: "Ost" }],
    });
    const ost = pool.find((c) => c.nameKey === "ost");
    expect(ost).toBeTruthy();
    expect(ost!.priceOre).toBeNull();
    expect(ost!.priceSource).toBe("UNRESOLVED");
  });

  it("(g) explicit source addition + price always wins over conflicting peers/priors", () => {
    const pool = buildAdditionCandidatePool({
      ...PIZZA,
      sourceAdditions: [{ name: "Ost", priceOre: 700 }],
      peerCategoryAdditions: [{ name: "Ost", priceOre: 1500 }],
      domainPriorAdditions: [{ name: "Ost", priceOre: 1000 }],
    });
    const { selected } = resolveAdditionCandidates(pool, PIZZA);
    const ost = selected.find((c) => c.nameKey === "ost");
    expect(ost).toBeTruthy();
    expect(ost!.tier).toBe("SOURCE");
    expect(ost!.priceOre).toBe(700);
  });

  it("treats a single arbitrary item as insufficient for burger-like families", () => {
    const one = buildAdditionCandidatePool({
      ...BURGER,
      sourceAdditions: [{ name: "Ekstra ost", priceOre: 1000 }],
    });
    const { selected } = resolveAdditionCandidates(one, BURGER);
    expect(isAdditionSetSufficient("BURGER", selected)).toBe(false);
    expect(isAdditionSetSufficient("DRINK", [])).toBe(true);
  });
});

describe("WP3 price-fallback tiering", () => {
  const emptyBenchmark = {
    restaurantsAnalyzed: 0,
    hosts: [],
    byNameKey: {},
    ekstraMedianOre: null,
    dipMedianOre: null,
    fingerprint: "empty",
  };

  it("peer tier with zero support resolves to UNRESOLVED (not 1000/1500/10kr)", () => {
    const named = lookupPeerAdditionPrice(emptyBenchmark, "Ost");
    expect(named.priceOre).toBeNull();
    expect(named.source).toBe("UNRESOLVED");

    const dip = lookupPeerAdditionPrice(emptyBenchmark, "Remoulade");
    expect(dip.priceOre).toBeNull();
    expect(dip.source).toBe("UNRESOLVED");

    const viaResolver = resolveAdditionPrice({
      name: "Ost",
      benchmark: emptyBenchmark,
    });
    expect(viaResolver.priceOre).toBeNull();
    expect(viaResolver.source).toBe("UNRESOLVED");
  });

  it("domain-prior tier still resolves and is tagged DOMAIN_PRIOR (peer exhausted)", () => {
    const resolved = resolveAdditionPrice({
      name: "Ost",
      benchmark: emptyBenchmark,
      domainPriorPriceOre: 1000,
    });
    expect(resolved.priceOre).toBe(1000);
    expect(resolved.source).toBe("DOMAIN_PRIOR");
  });

  it("peer tier wins over the domain prior when real peer evidence exists", () => {
    const bench = {
      ...emptyBenchmark,
      ekstraMedianOre: 1750,
      fingerprint: "peer",
    };
    const resolved = resolveAdditionPrice({
      name: "Ukendt tilbehør",
      benchmark: bench,
      domainPriorPriceOre: 1000,
    });
    expect(resolved.priceOre).toBe(1750);
    expect(resolved.source).toBe("PEER_MEDIAN");
  });

  it("pool tags a domain-prior priced candidate with the DOMAIN_PRIOR price source", () => {
    const pool = buildAdditionCandidatePool({
      ...BURGER,
      domainPriorAdditions: [{ name: "Bacon", priceOre: 2000 }],
    });
    const bacon = pool.find((c) => c.nameKey === "bacon");
    expect(bacon).toBeTruthy();
    expect(bacon!.tier).toBe("DOMAIN_PRIOR");
    expect(bacon!.priceSource).toBe("DOMAIN_PRIOR");
    expect(bacon!.priceOre).toBe(2000);
  });

  it("completeProductCard never emits a 0 (free) addition price", () => {
    const card = completeProductCard({
      product: {
        sourceId: "src:1",
        categorySourceId: "cat:1",
        sourceOrder: 1,
        name: "Cheeseburger",
        ingredients: [],
        variants: [
          {
            sourceId: "v0",
            name: "Alm.",
            nameOrigin: "SOURCE",
            surcharge: 0,
            surchargeOrigin: "DERIVED",
            isBase: true,
            sourceTotalPrice: 9900,
          },
        ],
        addOns: [{ sourceId: "a0", name: "Ekstra ost", origin: "SOURCE" }],
        productChoices: [],
        isCombo: false,
        status: "READY",
        issues: [],
      } as unknown as CanonicalProduct,
      categoryName: "Burgers",
    });
    for (const a of card.additions) {
      expect(a.priceOre ?? 0).not.toBe(0);
    }
  });
});
