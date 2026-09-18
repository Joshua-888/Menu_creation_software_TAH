import { describe, expect, it } from "vitest";
import type { CanonicalMenu, CanonicalProduct } from "../../../src/domain/schema/canonical.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../../src/domain/versions.js";
import { buildDryRunWritePlan } from "../../../src/planning/dryRun.js";
import { ADMIN_CONTRACT_V1 } from "../../../src/tah/contracts/v1.js";

function readyProduct(
  sourceId: string,
  categorySourceId: string,
  name: string,
  menuNumber: string,
  order: number,
): CanonicalProduct {
  return {
    sourceId,
    categorySourceId,
    name,
    sourceMenuNumber: menuNumber,
    assignedMenuNumber: menuNumber,
    sourceOrder: order,
    ingredients: [{ display: "Oksekød", origin: "SOURCE" }],
    variants: [
      {
        sourceId: `${sourceId}::v`,
        name: "Alm.",
        nameOrigin: "SYSTEM_DEFAULT",
        surcharge: 0,
        surchargeOrigin: "SYSTEM_DEFAULT",
        isBase: true,
        sourceTotalPrice: 7500,
      },
    ],
    addOns: [],
    productChoices: [],
    isCombo: false,
    status: "READY",
    issues: [],
    basePrice: 7500,
    basePriceOrigin: "SOURCE",
    description: "Oksekød, Salat",
  };
}

describe("CREATE category sequencing for empty destinations", () => {
  it("emits category A then its products before category B", () => {
    const canonical: CanonicalMenu = {
      restaurantName: "Fixture Grill",
      categories: [
        {
          sourceId: "cat:burgers",
          name: "Burgers",
          sourceOrder: 0,
          commonIngredients: [],
          products: [
            readyProduct("src:1", "cat:burgers", "Smash burger", "1", 0),
            readyProduct("src:2", "cat:burgers", "Cheese burger", "2", 1),
          ],
        },
        {
          sourceId: "cat:durum",
          name: "Durum",
          sourceOrder: 1,
          commonIngredients: [],
          products: [
            readyProduct("src:20", "cat:durum", "Durum kebab", "20", 0),
          ],
        },
      ],
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
      status: "READY",
      issues: [],
    };

    const plan = buildDryRunWritePlan({
      runId: "seq-empty-dest",
      restaurant: "Fixture Grill",
      host: "fixture.test",
      source: "fixture",
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
      adapterVersion: "1",
      contractFingerprint: "fp",
      canonical,
      categoryMappings: [
        {
          sourceCategoryId: "cat:burgers",
          sourceCategoryName: "Burgers",
          outcome: "MISSING_DESTINATION_CATEGORY",
          reason: "empty destination",
        },
        {
          sourceCategoryId: "cat:durum",
          sourceCategoryName: "Durum",
          outcome: "MISSING_DESTINATION_CATEGORY",
          reason: "empty destination",
        },
      ],
      destination: {
        host: "fixture.test",
        categories: [],
        products: [],
      },
      capabilities: ADMIN_CONTRACT_V1.capabilities,
    });

    const kinds = plan.operations.map((op) => ({
      id: op.operationId,
      entity: op.entityType,
      action: op.action,
      name: op.identity.name,
    }));
    const catCreates = kinds.filter(
      (op) => op.entity === "category" && op.action === "CREATE",
    );
    const productCreates = kinds.filter(
      (op) => op.entity === "product" && op.action === "CREATE",
    );
    expect(catCreates.map((op) => op.name)).toEqual(["Burgers", "Durum"]);
    expect(productCreates.map((op) => op.name)).toEqual([
      "Smash burger",
      "Cheese burger",
      "Durum kebab",
    ]);

    const burgerCat = kinds.findIndex(
      (op) =>
        op.entity === "category" &&
        op.action === "CREATE" &&
        op.name === "Burgers",
    );
    const durumCat = kinds.findIndex(
      (op) =>
        op.entity === "category" &&
        op.action === "CREATE" &&
        op.name === "Durum",
    );
    const firstBurgerProduct = kinds.findIndex(
      (op) => op.entity === "product" && op.name === "Smash burger",
    );
    const lastBurgerProduct = kinds.findIndex(
      (op) => op.entity === "product" && op.name === "Cheese burger",
    );
    const durumProduct = kinds.findIndex(
      (op) => op.entity === "product" && op.name === "Durum kebab",
    );

    expect(burgerCat).toBeGreaterThanOrEqual(0);
    expect(durumCat).toBeGreaterThan(burgerCat);
    expect(firstBurgerProduct).toBeGreaterThan(burgerCat);
    expect(lastBurgerProduct).toBeGreaterThan(firstBurgerProduct);
    expect(durumCat).toBeGreaterThan(lastBurgerProduct);
    expect(durumProduct).toBeGreaterThan(durumCat);
  });
});
