/**
 * Status accounting invariant: ready+review+blocked === productCount.
 * Findings are separate from product status.
 */

import { describe, expect, it } from "vitest";
import { evaluateMenuQualityContract } from "../../src/intelligence/qualityContract.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";

function menuWith(
  products: CanonicalMenu["categories"][0]["products"],
): CanonicalMenu {
  return {
    restaurantName: "Accounting Fixture",
    categories: [
      {
        sourceId: "c1",
        name: "Burgers",
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

function p(
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

describe("product status accounting invariant", () => {
  it("ready + review + blocked === productCount (mutually exclusive)", () => {
    const q = evaluateMenuQualityContract(
      menuWith([
        p({
          sourceId: "ready",
          name: "Classic Smash",
          ingredients: [
            { display: "Oksekød", origin: "SOURCE" },
            { display: "Salat", origin: "SOURCE" },
            { display: "Tomat", origin: "SOURCE" },
          ],
          description: "Oksekød, salat og tomat",
          basePrice: 8900,
        }),
        p({
          sourceId: "review",
          name: "Mystery Burger",
          ingredients: [{ display: "Oksekød", origin: "SOURCE" }],
          description: "",
        }),
        p({
          sourceId: "blocked",
          name: "Tomat",
          ingredients: [],
        }),
      ]),
    );

    const { ready, review, blocked, productCount, reconciles } =
      q.statusAccounting;
    expect(productCount).toBe(3);
    expect(ready + review + blocked).toBe(productCount);
    expect(reconciles).toBe(true);
    expect(ready + review + blocked).not.toBe(
      q.findingCounts.failedChecks,
    );
  });

  it("findingCounts are not product counts", () => {
    const q = evaluateMenuQualityContract(
      menuWith([
        p({
          sourceId: "p1",
          name: "Bad Burger",
          ingredients: [
            { display: "Tilbehør", origin: "SOURCE" },
            { display: "Bad Burger", origin: "SOURCE" },
          ],
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
    expect(q.statusAccounting.productCount).toBe(1);
    expect(
      q.statusAccounting.ready +
        q.statusAccounting.review +
        q.statusAccounting.blocked,
    ).toBe(1);
    expect(q.findingCounts.failedChecks).toBeGreaterThan(1);
  });
});
