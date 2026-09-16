import { describe, expect, it } from "vitest";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";
import { looksLikeGarbageName } from "../../src/domain/textNormalize.js";
import { evaluateMenuQualityContract } from "../../src/intelligence/qualityContract.js";

function menuWithDefaultZeroPrice(): CanonicalMenu {
  return {
    restaurantName: "Fixture",
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
    status: "READY",
    issues: [],
    categories: [
      {
        sourceId: "category",
        name: "Burgers",
        sourceOrder: 0,
        commonIngredients: [],
        products: [
          {
            sourceId: "product",
            categorySourceId: "category",
            name: "Classic burger",
            description: "Oksekød, salat og dressing",
            sourceOrder: 0,
            basePrice: 0,
            basePriceOrigin: "SYSTEM_DEFAULT",
            ingredients: [
              { display: "Oksekød", origin: "SOURCE" },
              { display: "Salat", origin: "SOURCE" },
            ],
            variants: [],
            addOns: [],
            productChoices: [],
            isCombo: false,
            status: "READY",
            issues: [],
          },
        ],
      },
    ],
  };
}

describe("menu quality hardening", () => {
  it("blocks a system-default zero base price", () => {
    const result = evaluateMenuQualityContract(menuWithDefaultZeroPrice());
    expect(result.menuStatus).toBe("MENU_QUALITY_BLOCKED");
    expect(result.products[0]?.checks).toContainEqual(
      expect.objectContaining({
        id: "PRICE_SUPPORTED",
        pass: false,
      }),
    );
    expect(result.blockers.join(" ")).toMatch(/PRICE_UNSUPPORTED/);
  });

  it("rejects multi-token names containing lowercase consonant noise", () => {
    expect(looksLikeGarbageName("Syttede sds")).toBe(true);
    expect(looksLikeGarbageName("BBQ Burger")).toBe(false);
  });
});
