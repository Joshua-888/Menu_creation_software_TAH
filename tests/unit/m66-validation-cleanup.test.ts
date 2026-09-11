import { describe, expect, it } from "vitest";
import { runDomainEngine } from "../../src/domain/engine.js";
import { revalidateCanonicalIssues } from "../../src/domain/issueLifecycle.js";
import { categoryExpectsListedIngredients } from "../../src/domain/ingredients.js";
import { applyProductChoiceSpec } from "../../src/decisions/transforms.js";
import { recoverIngredientTextFromEvidence } from "../../src/extraction/pdf/reconcile.js";
import { mapSourceCategoriesToDestination } from "../../src/planning/categoryMapping.js";
import {
  buildDryRunWritePlan,
  summarizeSourceDryRun,
} from "../../src/planning/index.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import { ADMIN_CONTRACT_V1 } from "../../src/tah/contracts/v1.js";
import {
  category,
  ing,
  menu,
  product,
  variant,
} from "../domain/helpers.js";

describe("M6.6 source validation cleanup", () => {
  it("clears stale MISSING_SOURCE_SUPPORTED_INGREDIENTS after ProductChoice resolve on non-pizza", () => {
    let canon = runDomainEngine(
      menu({
        restaurantName: "V",
        categories: [
          category({
            sourceId: "c",
            name: "INDISK",
            sourceOrder: 0,
            products: [
              product({
                sourceId: "p61",
                name: "Kottu",
                sourceOrder: 0,
                sourceMenuNumber: "61",
                variants: [variant("a", "Alm.", { totalKroner: 130 })],
              }),
            ],
          }),
        ],
      }),
    ).menu;
    // Force stale issue as if from older pipeline
    canon = {
      ...canon,
      categories: canon.categories.map((c) => ({
        ...c,
        products: c.products.map((p) => ({
          ...p,
          issues: [
            {
              code: "MISSING_SOURCE_SUPPORTED_INGREDIENTS",
              message: "stale",
              entityId: p.sourceId,
              severity: "MANUAL_REVIEW_REQUIRED" as const,
              field: "ingredients",
            },
          ],
          status: "MANUAL_REVIEW_REQUIRED" as const,
        })),
      })),
    };
    canon = applyProductChoiceSpec(canon, "61", {
      prompt: "Vælg",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: ["Kylling", "Okse", "Grøntsager", "Rejer"],
    });
    // Apply may already clear the issue; revalidate handles leftovers
    const beforeRevalidate = canon.categories[0]!.products[0]!;
    const { menu: next, resolutions } = revalidateCanonicalIssues(canon);
    expect(
      next.categories[0]!.products[0]!.issues.some(
        (i) => i.code === "MISSING_SOURCE_SUPPORTED_INGREDIENTS",
      ),
    ).toBe(false);
    expect(next.categories[0]!.products[0]!.status).toBe("READY");
    if (
      beforeRevalidate.issues.some(
        (i) => i.code === "MISSING_SOURCE_SUPPORTED_INGREDIENTS",
      )
    ) {
      expect(
        resolutions.some((r) => r.lifecycle === "RESOLVED_BY_DOMAIN_RULE"),
      ).toBe(true);
    }
  });

  it("default Alm. does not require human review", () => {
    const { menu: out } = runDomainEngine(
      menu({
        restaurantName: "V",
        categories: [
          category({
            sourceId: "c",
            name: "DRIKKEVARER",
            sourceOrder: 0,
            products: [
              product({
                sourceId: "p",
                name: "Juice",
                sourceOrder: 0,
                sourceMenuNumber: "69",
                variants: [],
                ingredients: [],
              }),
            ],
          }),
        ],
      }),
    );
    const p = out.categories[0]!.products[0]!;
    expect(p.variants.some((v) => v.name === "Alm.")).toBe(true);
    expect(p.status).toBe("READY");
  });

  it("optional additions empty is valid", () => {
    const { menu: out } = runDomainEngine(
      menu({
        restaurantName: "V",
        categories: [
          category({
            sourceId: "c",
            name: "GRILL",
            sourceOrder: 0,
            products: [
              product({
                sourceId: "p",
                name: "Cheeseburger",
                sourceOrder: 0,
                sourceMenuNumber: "41",
                variants: [variant("a", "Alm.", { totalKroner: 69 })],
                addOns: [],
              }),
            ],
          }),
        ],
      }),
    );
    expect(out.categories[0]!.products[0]!.addOns).toEqual([]);
    expect(out.categories[0]!.products[0]!.status).toBe("READY");
  });

  it("optional ProductChoice absent is valid", () => {
    const { menu: out } = runDomainEngine(
      menu({
        restaurantName: "V",
        categories: [
          category({
            sourceId: "c",
            name: "GRILL",
            sourceOrder: 0,
            products: [
              product({
                sourceId: "p",
                name: "Baconburger",
                sourceOrder: 0,
                sourceMenuNumber: "40",
                variants: [variant("a", "Alm.", { totalKroner: 69 })],
                productChoices: [],
              }),
            ],
          }),
        ],
      }),
    );
    expect(out.categories[0]!.products[0]!.productChoices).toEqual([]);
    expect(out.categories[0]!.products[0]!.status).toBe("READY");
  });

  it("merges category common ingredients with product ingredients", () => {
    const { menu: out } = runDomainEngine(
      menu({
        restaurantName: "V",
        categories: [
          category({
            sourceId: "c",
            name: "Pizza",
            sourceOrder: 0,
            commonIngredients: [ing("Tomat"), ing("Ost")],
            products: [
              product({
                sourceId: "p",
                name: "Vesuvio",
                sourceOrder: 0,
                sourceMenuNumber: "2",
                ingredients: [ing("Skinke")],
                variants: [variant("a", "Alm.", { totalKroner: 80 })],
              }),
            ],
          }),
        ],
      }),
    );
    expect(
      out.categories[0]!.products[0]!.ingredients.map((i) => i.display),
    ).toEqual(["Tomat", "Ost", "Skinke"]);
  });

  it("never invents unsupported ingredients", () => {
    const { menu: out } = runDomainEngine(
      menu({
        restaurantName: "V",
        categories: [
          category({
            sourceId: "c",
            name: "Pizza",
            sourceOrder: 0,
            products: [
              product({
                sourceId: "p",
                name: "Mystery",
                sourceOrder: 0,
                sourceMenuNumber: "1",
                variants: [variant("a", "Alm.", { totalKroner: 80 })],
              }),
            ],
          }),
        ],
      }),
    );
    expect(out.categories[0]!.products[0]!.ingredients).toEqual([]);
    expect(out.categories[0]!.products[0]!.status).toBe("MANUAL_REVIEW_REQUIRED");
  });

  it("recovers Klassisk pasta description from evidence without inventing", () => {
    const recovered = recoverIngredientTextFromEvidence({
      name: "Spaghetti Bolognese",
      rawText:
        "33. Spaghetti Bolognese\nKlassisk italiensk kødsovs || [spatial-fallback]",
    });
    expect(recovered).toMatch(/Klassisk italiensk kødsovs/i);
  });

  it("Pasta category maps to MISSING_DESTINATION consistently", () => {
    const maps = mapSourceCategoriesToDestination(
      [{ sourceId: "cat:pasta", name: "Pasta" }],
      [
        { databaseId: "1", name: "Pizza" },
        { databaseId: "7", name: "Grill" },
      ],
    );
    expect(maps[0]!.outcome).toBe("MISSING_DESTINATION_CATEGORY");
  });

  it("source-ready vs capability-block: Pasta READY products CREATE when createCategory CERTIFIED", () => {
    const canon: CanonicalMenu = {
      restaurantName: "Veroni",
      categories: [
        {
          sourceId: "cat:pasta",
          name: "Pasta",
          sourceOrder: 0,
          commonIngredients: [],
          products: ["33", "34", "35"].map((n, i) => ({
            sourceId: `src:${n}`,
            categorySourceId: "cat:pasta",
            name: `Pasta ${n}`,
            sourceMenuNumber: n,
            sourceOrder: i,
            ingredients: [{ display: "Sauce", origin: "SOURCE" as const }],
            variants: [
              {
                sourceId: `src:${n}::v`,
                name: "Alm.",
                nameOrigin: "SYSTEM_DEFAULT" as const,
                surcharge: 0,
                surchargeOrigin: "SYSTEM_DEFAULT" as const,
                isBase: true,
                sourceTotalPrice: 13000,
              },
            ],
            addOns: [],
            productChoices: [],
            isCombo: false,
            status: "READY" as const,
            issues: [],
            basePrice: 13000,
            basePriceOrigin: "SOURCE" as const,
          })),
        },
      ],
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
      status: "READY",
      issues: [],
    };
    const plan = buildDryRunWritePlan({
      runId: "t",
      restaurant: "V",
      host: "veronipizza.dk",
      source: "x",
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
      adapterVersion: "1",
      contractFingerprint: "x",
      canonical: canon,
      categoryMappings: [
        {
          sourceCategoryId: "cat:pasta",
          sourceCategoryName: "Pasta",
          outcome: "MISSING_DESTINATION_CATEGORY",
          reason: "no Pasta",
        },
      ],
      destination: {
        host: "veronipizza.dk",
        categories: [{ databaseId: "1", name: "Pizza" }],
        products: [],
      },
      capabilities: ADMIN_CONTRACT_V1.capabilities,
    });
    const pastaOps = plan.operations.filter((o) =>
      ["33", "34", "35"].includes(o.identity.menuNumber ?? ""),
    );
    expect(pastaOps).toHaveLength(3);
    expect(pastaOps.every((o) => o.action === "CREATE")).toBe(true);
    expect(
      plan.operations.some(
        (o) =>
          o.entityType === "category" &&
          o.action === "CREATE" &&
          o.identity.name === "Pasta",
      ),
    ).toBe(true);
    expect(categoryExpectsListedIngredients("Pasta")).toBe(false);
  });

  it("72-product WritePlan reconciliation excludes canaries from source totals", () => {
    const products = Array.from({ length: 72 }, (_, i) => {
      const n = String(i + 1);
      return {
        sourceId: `src:${n}`,
        categorySourceId: "cat:p",
        name: `P${n}`,
        sourceMenuNumber: n,
        sourceOrder: i,
        ingredients: [{ display: "Tomat", origin: "SOURCE" as const }],
        variants: [
          {
            sourceId: `src:${n}::v`,
            name: "Alm.",
            nameOrigin: "SOURCE" as const,
            surcharge: 0,
            surchargeOrigin: "SOURCE" as const,
            isBase: true,
            sourceTotalPrice: 8000,
          },
        ],
        addOns: [],
        productChoices: [],
        isCombo: false,
        status: "READY" as const,
        issues: [],
        basePrice: 8000,
        basePriceOrigin: "SOURCE" as const,
      };
    });
    const canon: CanonicalMenu = {
      restaurantName: "V",
      categories: [
        {
          sourceId: "cat:p",
          name: "Pizza",
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
    const plan = buildDryRunWritePlan({
      runId: "t",
      restaurant: "V",
      host: "veronipizza.dk",
      source: "x",
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
      adapterVersion: "1",
      contractFingerprint: "x",
      canonical: canon,
      categoryMappings: [
        {
          sourceCategoryId: "cat:p",
          sourceCategoryName: "Pizza",
          outcome: "SAFE_MAPPED_MATCH",
          destinationCategoryId: "1",
          destinationCategoryName: "Pizza",
          reason: "ok",
        },
      ],
      destination: {
        host: "veronipizza.dk",
        categories: [{ databaseId: "1", name: "Pizza" }],
        products: [
          {
            databaseId: "18",
            menuNumber: "99001",
            name: "__TAH_CANARY_PRODUCT_M3__",
            categoryIds: [],
          },
        ],
      },
      capabilities: ADMIN_CONTRACT_V1.capabilities,
    });
    const src = summarizeSourceDryRun(plan);
    expect(src.total).toBe(72);
    expect(src.DESTINATION_INTERNAL_TEST_RECORDS).toBe(1);
  });
});
