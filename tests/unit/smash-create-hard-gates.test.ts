import { describe, expect, it } from "vitest";
import {
  joinTitleFragments,
  isCredibleDishTitle,
  dominantBaseMenuPair,
} from "../../src/extraction/pdf/namePriceExtract.js";
import {
  normalizeSourceCategoriesByKind,
  peerModalCategoryForKind,
} from "../../src/learning/categoryKindNaming.js";
import { assertCreateCardQuality } from "../../src/domain/menuCardQuality.js";
import { createMigrationWritePlan, planCreateProduct } from "../../src/runner/writePlan.js";
import { synthesizeMenuerProductsFromMenuPrices } from "../../src/planning/menuerFromMenuPrice.js";
import { category, menu, product, variant } from "../domain/helpers.js";
import { kronerToOre } from "../../src/domain/money.js";

describe("namePrice OCR helpers (merchant-agnostic)", () => {
  it("joins split title fragments with noun-last preference", () => {
    expect(joinTitleFragments(["Smash", "Dirty", "Classic Smash"])).toEqual([
      "Dirty Smash",
      "Classic Smash",
    ]);
    expect(joinTitleFragments(["Crunch", "Murphy Sl"])).toEqual([
      "Crunch Murphy",
    ]);
  });

  it("rejects OCR garbage titles", () => {
    expect(isCredibleDishTitle("SMASHMDURGU PR")).toBe(false);
    expect(isCredibleDishTitle("TORS")).toBe(false);
    expect(isCredibleDishTitle("Classic Smash")).toBe(true);
  });

  it("detects dominant base/menu price pair from page text", () => {
    expect(
      dominantBaseMenuPair("99,- Menu 149,- 99 Menu 149 99,- Menu 149,-"),
    ).toEqual([99, 149]);
  });
});

describe("category kind naming SEMANTIC_RULE", () => {
  it("renames Grill to Burgers when majority products are sandwich_grill", () => {
    const source = menu({
      restaurantName: "Any",
      categories: [
        category({
          sourceId: "cat-g",
          name: "Grill",
          sourceOrder: 0,
          products: [
            product({ sourceId: "p1", name: "Classic Smash", sourceOrder: 0 }),
            product({ sourceId: "p2", name: "Dirty Smash", sourceOrder: 1 }),
            product({ sourceId: "p3", name: "Spice Burger", sourceOrder: 2 }),
          ],
        }),
      ],
    });
    const out = normalizeSourceCategoriesByKind(source);
    expect(out.categories[0]?.name).toBe("Burgers");
  });

  it("uses peer modal category when available", () => {
    const label = peerModalCategoryForKind(
      [
        {
          host: "a.dk",
          restaurantKey: "a",
          observedAt: "2026-01-01",
          source: "fixture",
          products: [
            {
              menuNumber: "1",
              name: "Baconburger",
              categoryNames: ["Burgers"],
              variants: [],
              additions: [],
            },
            {
              menuNumber: "2",
              name: "Cheeseburger",
              categoryNames: ["Burgers"],
              variants: [],
              additions: [],
            },
          ],
        },
      ],
      "sandwich_grill",
    );
    expect(label).toBe("Burgers");
  });
});

describe("Menu is never a variant + Menuer synthesis", () => {
  it("synthesizes Menuer products from Menu price options", () => {
    const source = menu({
      restaurantName: "Any",
      categories: [
        category({
          sourceId: "cat-b",
          name: "Burgers",
          sourceOrder: 0,
          products: [
            product({
              sourceId: "p1",
              name: "Classic Smash",
              sourceOrder: 0,
              variants: [
                variant("v1", "Alm.", { totalKroner: 99 }),
              ],
              // @ts-expect-error helpers may not type sourcePriceOptions
              sourcePriceOptions: [
                { label: "BASE", sourceTotalPrice: kronerToOre(99) },
                { label: "Menu", sourceTotalPrice: kronerToOre(149) },
              ],
            }),
          ],
        }),
      ],
    });
    // Attach sourcePriceOptions explicitly
    source.categories[0]!.products[0]!.sourcePriceOptions = [
      { label: "BASE", sourceTotalPrice: kronerToOre(99) },
      { label: "Menu", sourceTotalPrice: kronerToOre(149) },
    ];
    const out = synthesizeMenuerProductsFromMenuPrices(source);
    const menuer = out.categories.find((c) => c.name === "Menuer");
    expect(menuer?.products.length).toBe(1);
    expect(menuer?.products[0]?.name).toMatch(/Menu$/);
    expect(menuer?.products[0]?.isCombo).toBe(true);
  });
});

describe("assertCreateCardQuality gate", () => {
  it("blocks Menu variants and empty burger cards", () => {
    const plan = createMigrationWritePlan({
      runId: "t1",
      restaurant: "x",
      host: "x.dk",
      source: "test",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: [
        planCreateProduct({
          operationId: "op1",
          identity: {
            sourceId: "p1",
            name: "Classic Smash",
            categoryHint: "Burgers",
          },
          payload: {
            sourceId: "p1",
            menuNumber: "1",
            name: "Classic Smash",
            description: "",
            basePriceOre: 9900,
            categoryIds: ["c1"],
            variants: [
              { name: "Alm.", surchargeOre: 0 },
              { name: "Menu", surchargeOre: 5000 },
            ],
            ingredients: [],
            additions: [],
            intendedHidden: false,
          },
        }),
      ],
    });
    const gate = assertCreateCardQuality(plan);
    expect(gate.ok).toBe(false);
    expect(gate.blockers.some((b) => /Menu variant/i.test(b))).toBe(true);
    expect(gate.blockers.some((b) => /ingredients/i.test(b))).toBe(true);
  });
});
