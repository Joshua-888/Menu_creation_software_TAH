import { describe, expect, it } from "vitest";
import {
  joinTitleFragments,
  isCredibleDishTitle,
  dominantBaseMenuPair,
  looksLikeContentsLine,
  ingredientTextFromLines,
  detectNamePriceCandidates,
} from "../../src/extraction/pdf/namePriceExtract.js";
import { extractCommaPrices } from "../../src/extraction/pdf/prices.js";
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

  it("treats printed combo sides as contents, not a new title", () => {
    expect(looksLikeContentsLine("Pomfritter og sodavand")).toBe(true);
    expect(looksLikeContentsLine("Ketchup el. salat mayonnaise")).toBe(true);
    expect(looksLikeContentsLine("Hamburger menu")).toBe(false);
    expect(
      ingredientTextFromLines("Hamburger menu", [
        "Hamburger menu Kr. 120",
        "Pomfritter og sodavand",
      ]),
    ).toMatch(/pomfritter/i);

    const found = detectNamePriceCandidates(
      [
        {
          pageNumber: 1,
          width: 800,
          height: 1000,
          rawText: "Hamburger menu Kr. 120\nPomfritter og sodavand",
          items: [],
          lines: [
            {
              y: 500,
              text: "Hamburger menu Kr. 120",
              items: [
                {
                  str: "Hamburger menu Kr. 120",
                  x: 40,
                  y: 500,
                  width: 200,
                  height: 20,
                },
              ],
            },
            {
              y: 470,
              text: "Pomfritter og sodavand",
              items: [
                {
                  str: "Pomfritter og sodavand",
                  x: 40,
                  y: 470,
                  width: 220,
                  height: 18,
                },
              ],
            },
          ],
          classification: "MENU_CONTENT",
          classificationReason: "test",
          sourceKind: "image",
        },
      ],
      "fixture.jpeg",
    );
    const burger = found.find((c) => /hamburger menu/i.test(c.name ?? ""));
    expect(burger?.ingredientText ?? burger?.description ?? "").toMatch(
      /pomfritter/i,
    );
  });
});

describe("DKK currency-suffix price recognition (merchant-agnostic)", () => {
  it("recognizes 'NNN DKK' suffix prices case-insensitively", () => {
    expect(extractCommaPrices("FALAFEL 85 DKK")).toEqual([85]);
    expect(extractCommaPrices("BEEF SHAWARMA 105 DKK")).toEqual([105]);
    expect(extractCommaPrices("BEEF SHAWARMA 105 Dkk")).toEqual([105]);
    expect(extractCommaPrices("BEEF SHAWARMA 105 dkk")).toEqual([105]);
  });

  it("still recognizes legacy comma / '-' kroner forms unchanged", () => {
    expect(extractCommaPrices("99,-")).toEqual([99]);
    expect(extractCommaPrices("99,")).toEqual([99]);
    expect(extractCommaPrices("I15, 220,")).toEqual([115, 220]);
  });

  it("does not treat a bare number without a currency marker as a price", () => {
    expect(extractCommaPrices("65")).toEqual([]);
    expect(extractCommaPrices("Menu 65")).toEqual([]);
  });

  it("pairs an unnumbered title with a 'NNN DKK' price line", () => {
    const found = detectNamePriceCandidates(
      [
        {
          pageNumber: 1,
          width: 800,
          height: 1000,
          rawText: "Falafel 85 DKK",
          items: [],
          lines: [
            {
              y: 500,
              text: "Falafel 85 DKK",
              items: [
                {
                  str: "Falafel 85 DKK",
                  x: 40,
                  y: 500,
                  width: 200,
                  height: 20,
                },
              ],
            },
          ],
          classification: "MENU_CONTENT",
          classificationReason: "test",
          sourceKind: "pdf",
        },
      ],
      "fixture.pdf",
    );
    const falafel = found.find((c) => /falafel/i.test(c.name ?? ""));
    expect(falafel?.rawPrices).toContain(85);
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
