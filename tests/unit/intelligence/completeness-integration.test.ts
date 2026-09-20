/**
 * WP4 — Semantic Completeness Engine integration into completeProductCard /
 * menuIntelligenceEngine.
 *
 * Verifies that the WP2 field-requirement matrix and ingredient-sufficiency
 * assessor now DRIVE the existing resolution mechanisms (no new mechanisms, no
 * quality-gate change), and that per-field explainability traces are recorded.
 *
 * Covered:
 * (a) old length-check said sufficient but structural check says insufficient
 *     → resolution now triggers (sparse pizza);
 * (b) both checks agree → no behavior change, richness preserved (rich burger);
 * (c) a NOT_APPLICABLE-ingredients / FORBIDDEN-additions family (DRINK) is never
 *     subjected to ingredient resolution or the WP3 addition pool;
 * (d) `runMenuIntelligence().policyTraces` carries additive completenessTraces
 *     for ingredients/additions without breaking existing consumers.
 */

import { describe, expect, it } from "vitest";
import { completeProductCard } from "../../../src/intelligence/completeProductCard.js";
import { runMenuIntelligence } from "../../../src/intelligence/menuIntelligenceEngine.js";
import { getFieldRequirements } from "../../../src/intelligence/fieldRequirements.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../../src/domain/versions.js";
import type { CanonicalMenu } from "../../../src/domain/schema/canonical.js";
import type { CanonicalProduct } from "../../../src/domain/schema/canonical.js";

function product(
  name: string,
  ingredients: string[],
  addOns: string[] = [],
): CanonicalProduct {
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
    addOns: addOns.map((n, i) => ({
      sourceId: `a${i}`,
      name: n,
      origin: "SOURCE",
    })),
    productChoices: [],
    isCombo: false,
    status: "READY",
    issues: [],
  } as unknown as CanonicalProduct;
}

function findTrace(card: ReturnType<typeof completeProductCard>, field: string) {
  return card.completenessTraces.find((t) => t.field === field);
}

describe("WP4 — semantic completeness integration", () => {
  describe("(a) structural sufficiency triggers resolution the old length-check missed", () => {
    it("sparse pizza [Tomat, Løg] (length>=2) is now enriched from the domain prior", () => {
      // Old heuristic: ingredients.length >= 2 → 'complete', resolution never ran.
      // New: assessPizzaLike is PARTIAL (base but no substantive topping) → resolution runs.
      const card = completeProductCard({
        product: product("Pizza Margherita", ["Tomat", "Løg"]),
        categoryName: "Pizzaer",
      });
      expect(card.productFamily).toBe("PIZZA");
      // Resolution added the missing pizza base/topping tokens.
      expect(card.ingredients).toContain("Ost");
      expect(card.ingredients.length).toBeGreaterThan(2);

      const trace = findTrace(card, "ingredients")!;
      expect(trace).toBeTruthy();
      expect(trace.initialStatus).toBe("PARTIAL");
      expect(trace.finalStatus).toBe("SUFFICIENT");
      expect(trace.selectedTier).toBe("DOMAIN_PRIOR");
      expect(trace.evidenceConsidered).toContain("DOMAIN_PRIOR");
    });
  });

  describe("(b) agreement between checks preserves behavior and richness", () => {
    it("rich burger ingredients are SUFFICIENT before and after; source list wins", () => {
      const richIngredients = [
        "Oksekød",
        "Bacon",
        "Salat",
        "Tomat",
        "Løg",
        "Ketchup",
        "Mayo",
      ];
      const card = completeProductCard({
        product: product("Baconburger", richIngredients),
        categoryName: "Burgers",
      });
      expect(card.ingredients).toEqual(richIngredients);

      const trace = findTrace(card, "ingredients")!;
      expect(trace.initialStatus).toBe("SUFFICIENT");
      expect(trace.finalStatus).toBe("SUFFICIENT");
      // Honesty: the accepted value is the source list, so the accepted tier is
      // SOURCE — a prior that was merely inspected must not be claimed.
      expect(trace.selectedTier).toBe("SOURCE");
    });
  });

  describe("(c) NOT_APPLICABLE / FORBIDDEN families never resolve", () => {
    it("a DRINK is never subjected to ingredient resolution or the addition pool", () => {
      const card = completeProductCard({
        product: product("Cola", [], ["Mayo", "Ekstra ost"]),
        categoryName: "Drikkevarer",
      });
      expect(card.productFamily).toBe("DRINK");
      // DRINKS_NO_FOOD_EXTRAS: no ingredients, no food extras.
      expect(card.ingredients).toEqual([]);
      expect(card.additions).toEqual([]);

      const ing = findTrace(card, "ingredients")!;
      expect(ing.requirementLevel).toBe("NOT_APPLICABLE");
      expect(ing.initialStatus).toBe("NOT_APPLICABLE");
      expect(ing.finalStatus).toBe("NOT_APPLICABLE");
      expect(ing.evidenceConsidered).toEqual([]);

      const add = findTrace(card, "additions")!;
      expect(add.requirementLevel).toBe("FORBIDDEN");
      // No resolution was attempted → no tier may be claimed as inspected.
      expect(add.evidenceConsidered).toEqual([]);
      expect(add.selectedTier).toBeUndefined();
    });

    it("the DRINK requirement matrix forbids additions", () => {
      expect(getFieldRequirements("DRINK").additions).toBe("FORBIDDEN");
      expect(getFieldRequirements("DRINK").ingredients).toBe("NOT_APPLICABLE");
    });
  });

  describe("(d) policyTraces carries additive completenessTraces", () => {
    function menu(): CanonicalMenu {
      return {
        restaurantName: "Fixture WP4",
        categories: [
          {
            sourceId: "cat-burgers",
            name: "Burgers",
            sourceOrder: 0,
            commonIngredients: [],
            products: [
              {
                sourceId: "p-1",
                categorySourceId: "cat-burgers",
                name: "Baconburger",
                sourceOrder: 0,
                assignedMenuNumber: "1",
                ingredients: [
                  { sourceId: "i0", display: "Oksekød", name: "Oksekød" },
                  { sourceId: "i1", display: "Bacon", name: "Bacon" },
                  { sourceId: "i2", display: "Salat", name: "Salat" },
                  { sourceId: "i3", display: "Tomat", name: "Tomat" },
                  { sourceId: "i4", display: "Ketchup", name: "Ketchup" },
                  { sourceId: "i5", display: "Mayo", name: "Mayo" },
                ],
                variants: [
                  {
                    sourceId: "v0",
                    name: "Alm.",
                    nameOrigin: "SOURCE",
                    surcharge: 0,
                    surchargeOrigin: "SOURCE",
                    isBase: true,
                    sourceTotalPrice: 9900,
                  },
                ],
                addOns: [],
                productChoices: [],
                isCombo: false,
                status: "READY",
                issues: [],
              },
            ],
          },
          {
            sourceId: "cat-drinks",
            name: "Drikkevarer",
            sourceOrder: 1,
            commonIngredients: [],
            products: [
              {
                sourceId: "d-1",
                categorySourceId: "cat-drinks",
                name: "Cola",
                sourceOrder: 0,
                assignedMenuNumber: "10",
                ingredients: [],
                variants: [
                  {
                    sourceId: "vd1",
                    name: "Alm.",
                    nameOrigin: "SOURCE",
                    surcharge: 0,
                    surchargeOrigin: "SOURCE",
                    isBase: true,
                    sourceTotalPrice: 2500,
                  },
                ],
                addOns: [],
                productChoices: [],
                isCombo: false,
                status: "READY",
                issues: [],
              },
            ],
          },
        ],
        schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
        domainRulesEngineVersion: DOMAIN_RULE_ENGINE_VERSION,
        status: "READY",
        issues: [],
      } as unknown as CanonicalMenu;
    }

    it("every trace keeps its existing shape and gains optional completenessTraces", () => {
      const result = runMenuIntelligence({
        mode: "CREATE_MENU",
        restaurantName: "Fixture WP4",
        restaurantKey: "wp4.example",
        canonicalMenu: menu(),
      });

      expect(result.policyTraces.length).toBeGreaterThan(0);
      for (const t of result.policyTraces) {
        // Existing consumers depend on these fields — they must survive.
        expect(typeof t.productSourceId).toBe("string");
        expect(typeof t.name).toBe("string");
        expect(typeof t.category).toBe("string");
        expect(t.fields).toBeTruthy();
        expect(Array.isArray(t.qualityChecks)).toBe(true);
      }

      const burger = result.policyTraces.find((t) => t.name === "Baconburger")!;
      expect(burger.completenessTraces).toBeTruthy();
      const bIng = burger.completenessTraces!.find((x) => x.field === "ingredients")!;
      expect(bIng).toBeTruthy();
      expect(bIng.requirementLevel).toBe("REQUIRED");
      const bAdd = burger.completenessTraces!.find((x) => x.field === "additions")!;
      expect(bAdd).toBeTruthy();

      const drink = result.policyTraces.find((t) => t.name === "Cola")!;
      const dAdd = drink.completenessTraces!.find((x) => x.field === "additions")!;
      expect(dAdd.requirementLevel).toBe("FORBIDDEN");
    });
  });
});
