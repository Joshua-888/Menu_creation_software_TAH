import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import { DecisionStore } from "../../src/decisions/store.js";
import { resolveAdditionsForProduct } from "../../src/decisions/precedence.js";
import { fanOutRestaurantAdditions } from "../../src/planning/structureMapping.js";
import {
  composeCategoryIngredientAdditions,
  upsertCategoryIngredientAdditionFacts,
  DEFAULT_EKSTRA_PRICE_ORE,
} from "../../src/learning/categoryIngredientAdditions.js";
import type { AdditionLikelihoodPolicy } from "../../src/learning/additionLikelihood.js";
import { upsertPeerAdditionFactsForMenu } from "../../src/learning/additionLikelihood.js";
import { upsertVeroniTilbehorBusinessFact } from "../../src/learning/structurePolicy.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function menu(): CanonicalMenu {
  return {
    schemaVersion: "1",
    domainRuleVersion: "1",
    restaurant: "veronipizza.dk",
    source: "test",
    categories: [
      {
        sourceId: "cat-pizza",
        name: "PIZZA",
        products: [
          {
            sourceId: "p1",
            sourceMenuNumber: "1",
            name: "Margherita",
            status: "READY",
            description: "Tomat, ost, oregano",
            variants: [],
            ingredients: [],
            addOns: [],
          },
          {
            sourceId: "p2",
            sourceMenuNumber: "2",
            name: "Elia",
            status: "READY",
            description: "Tomat, ost, skinke, champignon",
            variants: [],
            ingredients: [
              { display: "Pepperoni", origin: "SOURCE" },
            ],
            addOns: [],
          },
          {
            sourceId: "p3",
            sourceMenuNumber: "3",
            name: "Has source adds",
            status: "READY",
            description: "Tomat, ost, ananas",
            variants: [],
            ingredients: [],
            addOns: [
              {
                sourceId: "a1",
                name: "Ekstra ost",
                price: 1500,
                origin: "SOURCE",
              },
            ],
          },
        ],
      },
      {
        sourceId: "cat-drink",
        name: "Drikkevarer",
        products: [
          {
            sourceId: "d1",
            sourceMenuNumber: "90",
            name: "Cola",
            status: "READY",
            description: "Citron, is",
            variants: [],
            ingredients: [{ display: "Citron", origin: "SOURCE" }],
            addOns: [],
          },
        ],
      },
      {
        sourceId: "cat-dip",
        name: "Dip og diverse",
        products: [
          {
            sourceId: "x1",
            sourceMenuNumber: "95",
            name: "Mayo",
            status: "READY",
            description: "Hvidløg, chili",
            variants: [],
            ingredients: [{ display: "Hvidløg", origin: "SOURCE" }],
            addOns: [],
          },
        ],
      },
      {
        sourceId: "cat-burger",
        name: "Burgers",
        products: [
          {
            sourceId: "b1",
            sourceMenuNumber: "20",
            name: "Cheese",
            status: "READY",
            description: "Oksekød, ost, salat, tomat",
            variants: [],
            ingredients: [],
            addOns: [],
          },
        ],
      },
    ],
  } as unknown as CanonicalMenu;
}

describe("category ingredient Tilbehør", () => {
  it("composes union from Beskrivelse + ingredients; skips dips drinks", () => {
    const comps = composeCategoryIngredientAdditions({ menu: menu() });
    const pizza = comps.find((c) => c.categoryName === "PIZZA")!;
    expect(pizza.eligible).toBe(true);
    const names = pizza.additions.map((a) => a.name.toLowerCase());
    expect(names).toEqual(
      expect.arrayContaining([
        "tomat",
        "ost",
        "oregano",
        "skinke",
        "champignon",
        "pepperoni",
      ]),
    );
    expect(names).toContain("ananas"); // from #3 description even with source adds
    expect(pizza.additions.every((a) => a.priceOre === DEFAULT_EKSTRA_PRICE_ORE)).toBe(
      true,
    );

    expect(comps.find((c) => c.categoryName === "Drikkevarer")!.additions).toEqual(
      [],
    );
    expect(
      comps.find((c) => c.categoryName === "Dip og diverse")!.additions,
    ).toEqual([]);

    const burgers = comps.find((c) => c.categoryName === "Burgers")!;
    expect(burgers.additions.map((a) => a.name.toLowerCase())).toEqual(
      expect.arrayContaining(["oksekød", "ost", "salat", "tomat"]),
    );
  });

  it("uses peer median price when available", () => {
    const likelihood = {
      restaurantsAnalyzed: 1,
      hosts: ["peer.dk"],
      thresholds: { allowMin: 0.35, denyMax: 0.12, minSupport: 3 },
      byKind: {
        pizza: [
          {
            kind: "pizza" as const,
            nameKey: "ost",
            displayName: "Ost",
            nProductsInKind: 10,
            kWithAddition: 8,
            pHat: 0.8,
            pSmooth: 0.8,
            medianPriceOre: 1500,
            decision: "ALLOW" as const,
            isDip: false,
          },
        ],
      },
      proposedSets: [],
      fingerprint: "test",
      rules: [],
    } satisfies AdditionLikelihoodPolicy;

    const pizza = composeCategoryIngredientAdditions({
      menu: menu(),
      likelihood,
    }).find((c) => c.categoryName === "PIZZA")!;
    const ost = pizza.additions.find((a) => a.nameKey === "ost")!;
    expect(ost.priceOre).toBe(1500);
    expect(ost.priceSource).toBe("PEER_MEDIAN");
  });

  it("fans out onto products without source addOns; source still wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "cat-ing-"));
    dirs.push(dir);
    const store = new DecisionStore(join(dir, "d.sqlite"));
    const m = menu();
    const prevSeed = process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
    process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = "veronipizza.dk";
    try {
      upsertCategoryIngredientAdditionFacts({
        store,
        restaurantKey: "veronipizza.dk",
        menu: m,
      });
      upsertVeroniTilbehorBusinessFact({
        store,
        restaurantKey: "veronipizza.dk",
      });

      const fan = fanOutRestaurantAdditions({
        menu: m,
        registry: store.facts,
        restaurantKey: "veronipizza.dk",
      });
      const p1 = fan.menu.categories[0]!.products.find(
        (p) => p.sourceMenuNumber === "1",
      )!;
      expect(p1.addOns.map((a) => a.name.toLowerCase())).toEqual(
        expect.arrayContaining(["tomat", "ost", "oregano"]),
      );
      // Restaurant mayo may merge in; probability would strip later
      const p3 = fan.menu.categories[0]!.products.find(
        (p) => p.sourceMenuNumber === "3",
      )!;
      expect(p3.addOns.map((a) => a.name)).toEqual(["Ekstra ost"]);

      const resolved = resolveAdditionsForProduct({
        registry: store.facts,
        restaurantKey: "veronipizza.dk",
        sourceCategory: "PIZZA",
        sourceId: "p1",
        menuNumber: "1",
        sourceAdditions: [],
      });
      expect(resolved.origin).toBe("RESTAURANT_CATEGORY_OR_RESTAURANT_FACT");
      expect(resolved.additions.some((a) => a.nameKey === "ost")).toBe(true);
    } finally {
      if (prevSeed === undefined) delete process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
      else process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = prevSeed;
      store.close();
    }
  });

  it("skips peer upsert for categories with ingredient union", () => {
    const dir = mkdtempSync(join(tmpdir(), "cat-peer-"));
    dirs.push(dir);
    const store = new DecisionStore(join(dir, "d.sqlite"));
    const m = menu();
    const { categoriesWithUnion } = upsertCategoryIngredientAdditionFacts({
      store,
      restaurantKey: "veronipizza.dk",
      menu: m,
    });
    expect(categoriesWithUnion).toContain("PIZZA");

    const likelihood: AdditionLikelihoodPolicy = {
      restaurantsAnalyzed: 1,
      hosts: ["peer.dk"],
      thresholds: { allowMin: 0.35, denyMax: 0.12, minSupport: 3 },
      byKind: {},
      proposedSets: [
        {
          kind: "pizza",
          additions: [
            {
              name: "PeerOnlyTopping",
              nameKey: "peeronlytopping",
              priceOre: 2000,
              pHat: 0.9,
              support: 5,
              isDip: false,
            },
          ],
        },
      ],
      fingerprint: "x",
      rules: [],
    };

    const peer = upsertPeerAdditionFactsForMenu({
      store,
      restaurantKey: "veronipizza.dk",
      menu: m,
      likelihood,
      skipCategories: categoriesWithUnion,
    });
    expect(peer.categories.find((c) => c.category === "PIZZA")).toBeUndefined();

    const resolved = resolveAdditionsForProduct({
      registry: store.facts,
      restaurantKey: "veronipizza.dk",
      sourceCategory: "PIZZA",
      sourceId: "p1",
      menuNumber: "1",
      sourceAdditions: [],
    });
    expect(
      resolved.additions.some((a) => a.nameKey === "peeronlytopping"),
    ).toBe(false);
    expect(resolved.additions.some((a) => a.nameKey === "pepperoni")).toBe(true);

    store.close();
  });
});
