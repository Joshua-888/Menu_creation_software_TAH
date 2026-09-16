/**
 * QualityContract negative + positive cases.
 */

import { describe, expect, it } from "vitest";
import { evaluateMenuQualityContract } from "../../src/intelligence/qualityContract.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";

function baseMenu(
  products: CanonicalMenu["categories"][0]["products"],
  categoryName = "Burgers",
): CanonicalMenu {
  return {
    restaurantName: "QC Fixture",
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

function product(
  partial: Partial<CanonicalMenu["categories"][0]["products"][0]> & {
    name: string;
    sourceId: string;
  },
): CanonicalMenu["categories"][0]["products"][0] {
  return {
    categorySourceId: "c1",
    sourceOrder: 0,
    ingredients: [],
    variants: [],
    addOns: [],
    productChoices: [],
    isCombo: false,
    status: "READY",
    issues: [],
    ...partial,
  };
}

describe("MenuQualityContract negative cases", () => {
  it("blocks burger with zero ingredients", () => {
    const q = evaluateMenuQualityContract(
      baseMenu([
        product({
          sourceId: "p1",
          name: "Baconburger",
          ingredients: [],
        }),
      ]),
    );
    expect(q.menuStatus).not.toBe("MENU_QUALITY_READY");
  });

  it("blocks Menu variant", () => {
    const q = evaluateMenuQualityContract(
      baseMenu([
        product({
          sourceId: "p1",
          name: "Baconburger",
          ingredients: [
            { display: "Oksekød", origin: "SOURCE" },
            { display: "Bacon", origin: "SOURCE" },
          ],
          description: "Oksekød og bacon",
          variants: [
            {
              sourceId: "v1",
              name: "Menu",
              nameOrigin: "SOURCE",
              surcharge: 0,
              surchargeOrigin: "SOURCE",
              isBase: false,
            },
          ],
        }),
      ]),
    );
    expect(
      q.products.some((p) =>
        p.checks.some((c) => c.id === "NO_MENU_VARIANT" && !c.pass),
      ),
    ).toBe(true);
  });

  it("blocks drink with ketchup addition", () => {
    const q = evaluateMenuQualityContract(
      baseMenu(
        [
          product({
            sourceId: "d1",
            name: "Cola",
            addOns: [
              {
                sourceId: "a1",
                name: "Ketchup",
                price: 1000,
                origin: "SYSTEM_DEFAULT",
              },
            ],
          }),
        ],
        "Drikkevarer",
      ),
    );
    expect(
      q.products.some((p) =>
        p.checks.some((c) => c.id === "ADDITION_SCOPE_VALID" && !c.pass),
      ) || q.coherence.some((c) => c.id === "DRINKS_NO_FOOD_ADDITIONS" && !c.pass),
    ).toBe(true);
  });

  it("blocks Tomat as product name", () => {
    const q = evaluateMenuQualityContract(
      baseMenu([
        product({
          sourceId: "p1",
          name: "Tomat",
          ingredients: [{ display: "Tomat", origin: "SOURCE" }],
        }),
      ]),
    );
    expect(
      q.products.some((p) =>
        p.checks.some((c) => c.id === "PRODUCT_NAME_VALID" && !c.pass),
      ),
    ).toBe(true);
  });

  it("blocks empty menu", () => {
    const q = evaluateMenuQualityContract({
      restaurantName: "Empty",
      categories: [],
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
      status: "BLOCKED",
      issues: [],
    });
    expect(q.menuStatus).toBe("MENU_QUALITY_BLOCKED");
  });
});

describe("MenuQualityContract positive cases", () => {
  it("passes a complete burger card", () => {
    const q = evaluateMenuQualityContract(
      baseMenu([
        product({
          sourceId: "p1",
          name: "Baconburger",
          description: "Oksekød, bacon, salat, tomat, løg, ketchup og mayo",
          ingredients: [
            { display: "Oksekød", origin: "SOURCE" },
            { display: "Bacon", origin: "SOURCE" },
            { display: "Salat", origin: "SOURCE" },
            { display: "Tomat", origin: "SOURCE" },
            { display: "Løg", origin: "SOURCE" },
            { display: "Ketchup", origin: "SOURCE" },
            { display: "Mayo", origin: "SOURCE" },
          ],
          variants: [
            {
              sourceId: "v1",
              name: "Alm.",
              nameOrigin: "SOURCE",
              surcharge: 0,
              surchargeOrigin: "SOURCE",
              isBase: true,
              sourceTotalPrice: 8900,
            },
          ],
          addOns: [
            {
              sourceId: "a1",
              name: "Ost",
              price: 1000,
              origin: "DERIVED",
            },
          ],
        }),
      ]),
    );
    expect(q.products[0]?.status).toBe("QUALITY_READY");
  });

  it("passes a drink without food additions", () => {
    const q = evaluateMenuQualityContract(
      baseMenu(
        [
          product({
            sourceId: "d1",
            name: "Cola",
            variants: [
              {
                sourceId: "v1",
                name: "Alm.",
                nameOrigin: "SOURCE",
                surcharge: 0,
                surchargeOrigin: "SOURCE",
                isBase: true,
                sourceTotalPrice: 2500,
              },
            ],
          }),
        ],
        "Drikkevarer",
      ),
    );
    expect(q.products[0]?.status).toBe("QUALITY_READY");
  });

  it("passes a thai curry card", () => {
    const q = evaluateMenuQualityContract(
      baseMenu(
        [
          product({
            sourceId: "t1",
            name: "Gron Curry Kylling",
            description: "Kokosmælk, basilikum og kylling",
            ingredients: [
              { display: "Kokosmælk", origin: "DERIVED" },
              { display: "Basilikum", origin: "DERIVED" },
              { display: "Kylling", origin: "DERIVED" },
            ],
            variants: [
              {
                sourceId: "v1",
                name: "Alm.",
                nameOrigin: "SOURCE",
                surcharge: 0,
                surchargeOrigin: "SOURCE",
                isBase: true,
                sourceTotalPrice: 9900,
              },
            ],
          }),
        ],
        "Hovedretter",
      ),
    );
    expect(q.products[0]?.status).toBe("QUALITY_READY");
  });

  it("passes a pizza card", () => {
    const q = evaluateMenuQualityContract(
      baseMenu(
        [
          product({
            sourceId: "p1",
            name: "Pepperoni",
            description: "Tomat og ost",
            ingredients: [
              { display: "Tomat", origin: "SOURCE" },
              { display: "Ost", origin: "SOURCE" },
            ],
            variants: [
              {
                sourceId: "v1",
                name: "Alm.",
                nameOrigin: "SOURCE",
                surcharge: 0,
                surchargeOrigin: "SOURCE",
                isBase: true,
                sourceTotalPrice: 7500,
              },
            ],
          }),
        ],
        "PIZZA",
      ),
    );
    expect(q.products[0]?.status).toBe("QUALITY_READY");
  });
});
