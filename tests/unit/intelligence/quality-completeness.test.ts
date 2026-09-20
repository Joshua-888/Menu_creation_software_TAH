/**
 * WP5 — Semantic completeness integration into MenuQualityContract.
 *
 * Verifies the QualityContract recomputes structural sufficiency on its own
 * local data (no trace lookup, no sourceId) and maps field-requirement levels to
 * the correct severity:
 *   REQUIRED unresolved                 -> QUALITY_REVIEW
 *   EXPECTED unresolved                 -> non-gating completeness warning
 *   FORBIDDEN additions on a family     -> QUALITY_BLOCKED
 *   forbidden Menu-as-variant name      -> QUALITY_BLOCKED
 *   OPTIONAL / CONDITIONAL / NOT_APPLICABLE -> never gate
 */

import { describe, expect, it } from "vitest";
import { evaluateMenuQualityContract } from "../../../src/intelligence/qualityContract.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../../src/domain/versions.js";
import type { CanonicalMenu } from "../../../src/domain/schema/canonical.js";

type Product = CanonicalMenu["categories"][0]["products"][0];

function baseMenu(products: Product[], categoryName = "Burgers"): CanonicalMenu {
  return {
    restaurantName: "WP5 Fixture",
    categories: [
      {
        sourceId: "c1",
        name: categoryName,
        sourceOrder: 0,
        commonIngredients: [],
        products,
      },
    ],
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
    status: "READY",
    issues: [],
  };
}

function product(partial: Partial<Product> & { name: string; sourceId: string }): Product {
  return {
    categorySourceId: "c1",
    sourceOrder: 0,
    description: "Lækker klassiker",
    ingredients: [],
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
    ...partial,
  } as unknown as Product;
}

function ingredientsOf(names: string[]): Product["ingredients"] {
  return names.map((n, i) => ({
    sourceId: `i${i}`,
    display: n,
    name: n,
    origin: "SOURCE" as const,
  }));
}

function addOnsOf(names: string[]): Product["addOns"] {
  return names.map((n, i) => ({
    sourceId: `a${i}`,
    name: n,
    origin: "SOURCE" as const,
  }));
}

function statusOf(menu: CanonicalMenu, name: string) {
  const q = evaluateMenuQualityContract(menu);
  return {
    q,
    product: q.products.find((p) => p.name === name),
  };
}

const COMPLETE_BURGER = ["Oksekød", "Bacon", "Salat", "Tomat", "Løg"];

describe("WP5 — completeness requirement → quality severity mapping", () => {
  it("(a) REQUIRED ingredients unresolved -> QUALITY_REVIEW", () => {
    const { product: p } = statusOf(
      baseMenu([product({ sourceId: "p1", name: "Baconburger", ingredients: [] })]),
      "Baconburger",
    );
    expect(p?.status).toBe("QUALITY_REVIEW");
    expect(p?.checks.find((c) => c.id === "INGREDIENTS_COMPLETE")?.pass).toBe(false);
  });

  it("(f) recomputation catches a 2-token burger the old `length >= 2` check passed", () => {
    // ['Løg', 'Tomat'] has length 2 (old heuristic: complete) but is structurally
    // INSUFFICIENT for a burger (no protein / no build). Requires INGREDIENTS → REVIEW.
    const { product: p } = statusOf(
      baseMenu([
        product({ sourceId: "p1", name: "Baconburger", ingredients: ingredientsOf(["Løg", "Tomat"]) }),
      ]),
      "Baconburger",
    );
    expect(p?.status).toBe("QUALITY_REVIEW");
    expect(p?.checks.find((c) => c.id === "INGREDIENTS_COMPLETE")?.pass).toBe(false);
  });

  it("PARTIAL (some evidence, below structural bar) is advisory and does not gate", () => {
    // A pizza with a base but no substantive topping resolves PARTIAL. Per the
    // Architect severity ruling, only UNRESOLVED/INSUFFICIENT gate a REQUIRED
    // field; PARTIAL is a review signal but not a hard status change.
    const { product: p } = statusOf(
      baseMenu(
        [product({ sourceId: "p1", name: "Pizza Margherita", ingredients: ingredientsOf(["Tomat", "Løg"]) })],
        "Pizzaer",
      ),
      "Pizza Margherita",
    );
    expect(p?.checks.find((c) => c.id === "INGREDIENTS_COMPLETE")?.pass).toBe(true);
  });

  it("(c) EXPECTED additions unresolved -> stays QUALITY_READY + completeness warning", () => {
    const { q, product: p } = statusOf(
      baseMenu([
        product({ sourceId: "p1", name: "Baconburger", ingredients: ingredientsOf(COMPLETE_BURGER), addOns: [] }),
      ]),
      "Baconburger",
    );
    expect(p?.status).toBe("QUALITY_READY");
    expect(p?.checks.find((c) => c.id === "ADDITIONS_EXPECTATION_RESOLVED")?.pass).toBe(true);
    expect(p?.completenessWarnings.some((w) => /additions expected/i.test(w))).toBe(true);
    expect(q.completenessAccounting.productsWithWarnings).toBeGreaterThanOrEqual(1);
    expect(q.completenessAccounting.reconciles).toBe(true);
  });

  it("(b) FORBIDDEN additions on a drink -> QUALITY_BLOCKED", () => {
    const { q, product: p } = statusOf(
      baseMenu(
        [
          product({
            sourceId: "p1",
            name: "Cola",
            ingredients: [],
            addOns: addOnsOf(["Mayo"]),
          }),
        ],
        "Drikkevarer",
      ),
      "Cola",
    );
    expect(p?.status).toBe("QUALITY_BLOCKED");
    expect(p?.checks.find((c) => c.id === "ADDITIONS_EXPECTATION_RESOLVED")?.pass).toBe(false);
    expect(q.statusAccounting.blocked).toBe(1);
  });

  it("(d) forbidden Menu-as-variant name -> QUALITY_BLOCKED (not length-based)", () => {
    const { product: p } = statusOf(
      baseMenu([
        product({
          sourceId: "p1",
          name: "Baconburger",
          ingredients: ingredientsOf(COMPLETE_BURGER),
          variants: [
            {
              sourceId: "v1",
              name: "Menu",
              nameOrigin: "SOURCE",
              surcharge: 0,
              surchargeOrigin: "DERIVED",
              isBase: false,
              sourceTotalPrice: 9500,
            },
          ],
        }),
      ]),
      "Baconburger",
    );
    expect(p?.status).toBe("QUALITY_BLOCKED");
    expect(p?.checks.find((c) => c.id === "VARIANT_EXPECTATION_RESOLVED")?.pass).toBe(false);
  });

  it("(e) a combo with legitimate size variants is NOT a Menu-as-variant violation", () => {
    const { product: p } = statusOf(
      baseMenu([
        product({
          sourceId: "p1",
          name: "Kebabmenu",
          isCombo: true,
          ingredients: ingredientsOf(["Kebab", "Pommes", "Cola"]),
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
            {
              sourceId: "v1",
              name: "Familie",
              nameOrigin: "SOURCE",
              surcharge: 3000,
              surchargeOrigin: "DERIVED",
              isBase: false,
              sourceTotalPrice: 12900,
            },
          ],
        }),
      ],
      "Menuer",
    ),
      "Kebabmenu",
    );
    expect(p?.checks.find((c) => c.id === "VARIANT_EXPECTATION_RESOLVED")?.pass).toBe(true);
    expect(p?.checks.find((c) => c.id === "NO_MENU_VARIANT")?.pass).toBe(true);
  });

  it("(accounting) status buckets reconcile and warnings are aggregated", () => {
    const q = evaluateMenuQualityContract(
      baseMenu([
        product({ sourceId: "p1", name: "Baconburger", ingredients: ingredientsOf(COMPLETE_BURGER) }),
        product({ sourceId: "p2", name: "Cheeseburger", ingredients: [] }),
      ]),
    );
    expect(q.statusAccounting.reconciles).toBe(true);
    expect(
      q.statusAccounting.ready + q.statusAccounting.review + q.statusAccounting.blocked,
    ).toBe(q.statusAccounting.productCount);
    expect(q.completenessAccounting.reconciles).toBe(true);
    const warningSum = q.products.reduce((n, p) => n + p.completenessWarnings.length, 0);
    expect(q.completenessAccounting.warningCount).toBe(warningSum);
  });
});
