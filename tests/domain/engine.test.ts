import { describe, expect, it } from "vitest";
import { runDomainEngine } from "../../src/domain/engine.js";
import { kronerToOre } from "../../src/domain/money.js";
import { category, ing, menu, product, variant } from "./helpers.js";

describe("runDomainEngine fixtures", () => {
  it("injects Alm. when product has no variants", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Mad",
          sourceOrder: 1,
          commonIngredients: [ing("Salt")],
          products: [
            product({
              sourceId: "p1",
              name: "Soup",
              sourceOrder: 1,
              sourceMenuNumber: "1",
              ingredients: [ing("Vand")],
            }),
          ],
        }),
      ],
    });

    const { menu: out, validation } = runDomainEngine(source);
    const p = out.categories[0]!.products[0]!;
    expect(p.variants).toHaveLength(1);
    expect(p.variants[0]!.name).toBe("Alm.");
    expect(p.variants[0]!.surchargeOrigin).toBe("SYSTEM_DEFAULT");
    expect(validation.productCount).toBe(1);
  });

  it("assigns missing numbers after highest numeric late in menu", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          commonIngredients: [ing("Tomat"), ing("Ost")],
          products: [
            product({
              sourceId: "a",
              name: "A",
              sourceOrder: 1,
              ingredients: [ing("Skinke")],
            }),
            product({
              sourceId: "b",
              name: "B",
              sourceOrder: 2,
              ingredients: [ing("Bacon")],
            }),
            product({
              sourceId: "c",
              name: "C",
              sourceOrder: 3,
              sourceMenuNumber: "87",
              ingredients: [ing("Pepperoni")],
            }),
          ],
        }),
      ],
    });

    const { menu: out } = runDomainEngine(source);
    const nums = out.categories[0]!.products.map((p) => p.assignedMenuNumber);
    expect(nums).toEqual(["88", "89", "87"]);
  });

  it("handles Alm/Family and per-product different surcharges", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          commonIngredients: [ing("Tomat"), ing("Ost")],
          products: [
            product({
              sourceId: "marg",
              name: "Margherita",
              sourceOrder: 1,
              sourceMenuNumber: "1",
              variants: [
                variant("m-alm", "Alm.", { totalKroner: 90 }),
                variant("m-deep", "Deep", { totalKroner: 110 }),
                variant("m-fam", "Family", { totalKroner: 170 }),
              ],
            }),
            product({
              sourceId: "pep",
              name: "Pepperoni",
              sourceOrder: 2,
              sourceMenuNumber: "2",
              ingredients: [ing("Pepperoni")],
              variants: [
                variant("p-alm", "Alm.", { totalKroner: 95 }),
                variant("p-deep", "Deep", { totalKroner: 120 }),
                variant("p-fam", "Family", { totalKroner: 180 }),
              ],
            }),
          ],
        }),
      ],
    });

    const { menu: out } = runDomainEngine(source);
    const marg = out.categories[0]!.products[0]!;
    const pep = out.categories[0]!.products[1]!;
    expect(marg.basePrice).toBe(kronerToOre(90));
    expect(marg.variants.find((v) => v.name === "Deep")?.surcharge).toBe(
      kronerToOre(20),
    );
    expect(pep.basePrice).toBe(kronerToOre(95));
    expect(pep.variants.find((v) => v.name === "Deep")?.surcharge).toBe(
      kronerToOre(25),
    );
    expect(pep.variants.find((v) => v.name === "Family")?.surcharge).toBe(
      kronerToOre(85),
    );
  });

  it("uses explicit +80 surcharge", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          commonIngredients: [ing("Tomat")],
          products: [
            product({
              sourceId: "p1",
              name: "Hawaii",
              sourceOrder: 1,
              sourceMenuNumber: "3",
              ingredients: [ing("Skinke"), ing("Ananas")],
              variants: [
                variant("alm", "Alm.", { totalKroner: 100 }),
                variant("fam", "Familie", { explicitSurchargeKroner: 80 }),
              ],
            }),
          ],
        }),
      ],
    });

    const { menu: out } = runDomainEngine(source);
    const fam = out.categories[0]!.products[0]!.variants.find(
      (v) => v.name === "Familie",
    );
    expect(fam?.surcharge).toBe(kronerToOre(80));
  });

  it("flags SOURCE_PRICE_CONFLICT for review", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          commonIngredients: [ing("Tomat")],
          products: [
            product({
              sourceId: "p1",
              name: "X",
              sourceOrder: 1,
              sourceMenuNumber: "1",
              variants: [
                variant("alm", "Alm.", { totalKroner: 100 }),
                variant("fam", "Familie", {
                  totalKroner: 200,
                  explicitSurchargeKroner: 80,
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const { menu: out } = runDomainEngine(source);
    const p = out.categories[0]!.products[0]!;
    expect(p.status).toBe("MANUAL_REVIEW_REQUIRED");
    expect(p.issues.some((i) => i.code === "SOURCE_PRICE_CONFLICT")).toBe(true);
  });

  it("composes category ingredients for pizza with no extras", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          commonIngredients: [ing("Tomato"), ing("Cheese")],
          products: [
            product({
              sourceId: "p1",
              name: "Margherita",
              sourceOrder: 1,
              sourceMenuNumber: "1",
              variants: [variant("alm", "Alm.", { totalKroner: 80 })],
            }),
          ],
        }),
      ],
    });

    const { menu: out } = runDomainEngine(source);
    expect(
      out.categories[0]!.products[0]!.ingredients.map((i) => i.display),
    ).toEqual(["Tomato", "Cheese"]);
  });

  it("requires review when ingredients missing — never invents", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          products: [
            product({
              sourceId: "p1",
              name: "Mystery",
              sourceOrder: 1,
              sourceMenuNumber: "1",
              variants: [variant("alm", "Alm.", { totalKroner: 80 })],
            }),
          ],
        }),
      ],
    });

    const { menu: out } = runDomainEngine(source);
    const p = out.categories[0]!.products[0]!;
    expect(p.ingredients).toEqual([]);
    expect(
      p.issues.some((i) => i.code === "MISSING_SOURCE_SUPPORTED_INGREDIENTS"),
    ).toBe(true);
    expect(p.status).toBe("MANUAL_REVIEW_REQUIRED");
  });

  it("keeps ProductChoice as structural IDs, not ingredients", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Menu",
          sourceOrder: 1,
          commonIngredients: [ing("Brød")],
          products: [
            product({
              sourceId: "pizza-h",
              name: "Hawaii",
              sourceOrder: 1,
              sourceMenuNumber: "1",
              ingredients: [ing("Skinke"), ing("Ananas")],
              variants: [variant("h-alm", "Alm.", { totalKroner: 90 })],
            }),
            product({
              sourceId: "pizza-p",
              name: "Pepperoni",
              sourceOrder: 2,
              sourceMenuNumber: "2",
              ingredients: [ing("Pepperoni")],
              variants: [variant("p-alm", "Alm.", { totalKroner: 95 })],
            }),
            product({
              sourceId: "combo",
              name: "MENU",
              sourceOrder: 3,
              sourceMenuNumber: "10",
              isCombo: true,
              ingredients: [ing("Salat")],
              variants: [variant("c-alm", "Alm.", { totalKroner: 120 })],
              productChoices: [
                {
                  sourceId: "choice-1",
                  prompt: "Choose any pizza",
                  options: [
                    { productSourceId: "pizza-h" },
                    { productSourceId: "pizza-p" },
                  ],
                },
              ],
            }),
          ],
        }),
      ],
    });

    const { menu: out } = runDomainEngine(source);
    const combo = out.categories[0]!.products.find((p) => p.sourceId === "combo")!;
    expect(combo.productChoices[0]!.options.map((o) => o.productSourceId)).toEqual([
      "pizza-h",
      "pizza-p",
    ]);
    expect(combo.ingredients.map((i) => i.display)).toEqual(["Brød", "Salat"]);
    expect(combo.ingredients.map((i) => i.display)).not.toContain("Pepperoni");
  });

  it("marks duplicate source menu numbers as MANUAL_REVIEW, not BLOCKED", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          commonIngredients: [ing("Tomat")],
          products: [
            product({
              sourceId: "p1",
              name: "A",
              sourceOrder: 1,
              sourceMenuNumber: "5",
              variants: [variant("a1", "Alm.", { totalKroner: 80 })],
            }),
            product({
              sourceId: "p2",
              name: "B",
              sourceOrder: 2,
              sourceMenuNumber: "5",
              variants: [variant("b1", "Alm.", { totalKroner: 85 })],
            }),
          ],
        }),
      ],
    });

    const { menu: out } = runDomainEngine(source);
    for (const p of out.categories[0]!.products) {
      expect(
        p.issues.some((i) => i.code === "DUPLICATE_SOURCE_MENU_NUMBER"),
      ).toBe(true);
      expect(p.status).toBe("MANUAL_REVIEW_REQUIRED");
    }
  });

  it("does not invent variants from blank cells", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          commonIngredients: [ing("Tomat")],
          products: [
            product({
              sourceId: "p1",
              name: "Only Alm",
              sourceOrder: 1,
              sourceMenuNumber: "1",
              variants: [variant("alm", "Alm.", { totalKroner: 90 })],
            }),
          ],
        }),
      ],
    });

    const { menu: out } = runDomainEngine(source);
    expect(out.categories[0]!.products[0]!.variants).toHaveLength(1);
  });

  it("does not mutate the input SourceMenu", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          commonIngredients: [ing("Tomat")],
          products: [
            product({
              sourceId: "p1",
              name: "A",
              sourceOrder: 1,
              variants: [variant("alm", "Alm.", { totalKroner: 90 })],
            }),
          ],
        }),
      ],
    });
    const before = JSON.stringify(source);
    runDomainEngine(source);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("is deterministic for identical input", () => {
    const source = menu({
      restaurantName: "Demo",
      categories: [
        category({
          sourceId: "c1",
          name: "Pizza",
          sourceOrder: 1,
          commonIngredients: [ing("Tomat"), ing("Ost")],
          products: [
            product({
              sourceId: "p1",
              name: "Hawaii",
              sourceOrder: 1,
              sourceMenuNumber: "12",
              ingredients: [ing("Skinke")],
              variants: [
                variant("alm", "Alm.", { totalKroner: 100 }),
                variant("fam", "Familie", { totalKroner: 180 }),
              ],
            }),
          ],
        }),
      ],
    });

    const a = runDomainEngine(source);
    const b = runDomainEngine(source);
    expect(JSON.stringify(a.menu)).toBe(JSON.stringify(b.menu));
  });
});
