import { describe, expect, it } from "vitest";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import {
  applyCategoryVariantFanOut,
  categoryEligibleForStructuralFanOut,
  categoryExcludedFromStructuralFanOut,
  DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY,
  matchStructuralVariant,
} from "../../src/learning/categorySizeVariantPolicy.js";
import {
  distillStructurePatterns,
  encodeStructureSemanticRule,
  parseStructureSemanticRule,
  type PeerMenuSnapshot,
} from "../../src/learning/peerMenuStructure.js";
import { defaultStructurePattern } from "../../src/learning/structurePolicy.js";

function product(input: {
  id: string;
  menu: string;
  name: string;
  variants: Array<{ name: string; surcharge: number; isBase?: boolean }>;
}) {
  return {
    sourceId: input.id,
    sourceMenuNumber: input.menu,
    name: input.name,
    status: "READY" as const,
    variants: input.variants.map((v, i) => ({
      sourceId: `${input.id}::v${i}`,
      name: v.name,
      nameOrigin: "SOURCE" as const,
      surcharge: v.surcharge,
      surchargeOrigin: "SOURCE" as const,
      isBase: v.isBase ?? i === 0,
    })),
    ingredients: [],
    addOns: [],
  };
}

function menuWithCategories(
  cats: Array<{
    name: string;
    products: ReturnType<typeof product>[];
  }>,
): CanonicalMenu {
  return {
    schemaVersion: "1",
    domainRuleVersion: "1",
    restaurant: "test.dk",
    source: "test",
    categories: cats.map((c, i) => ({
      sourceId: `cat-${i}`,
      name: c.name,
      products: c.products,
    })),
  } as unknown as CanonicalMenu;
}

describe("category structural-variant SEMANTIC_RULE", () => {
  it("matches Alm/Fam/Deep/Glutenfri/Fuldkorn/Hj.", () => {
    expect(matchStructuralVariant("Alm.")?.kind).toBe("alm");
    expect(matchStructuralVariant("Fam.")?.kind).toBe("familie");
    expect(matchStructuralVariant("Familie")?.kind).toBe("familie");
    expect(matchStructuralVariant("Deep")?.kind).toBe("deep");
    expect(matchStructuralVariant("Glutenfri")?.kind).toBe("glutenfri");
    expect(matchStructuralVariant("Fuldkorn")?.kind).toBe("fuldkorn");
    expect(matchStructuralVariant("Hj.")?.kind).toBe("hjemmelavet");
    expect(matchStructuralVariant("hjemmelavet")?.kind).toBe("hjemmelavet");
    expect(matchStructuralVariant("Kebab")).toBeNull();
  });

  it("eligible vs excluded categories", () => {
    expect(categoryEligibleForStructuralFanOut("PIZZA")).toBe(true);
    expect(categoryEligibleForStructuralFanOut("Vegetarpizza")).toBe(true);
    expect(categoryEligibleForStructuralFanOut("Burgers")).toBe(true);
    expect(categoryEligibleForStructuralFanOut("Durum")).toBe(true);
    expect(categoryEligibleForStructuralFanOut("Pita")).toBe(true);
    expect(categoryEligibleForStructuralFanOut("Sandwich - hjemmelavet")).toBe(
      true,
    );
    expect(categoryEligibleForStructuralFanOut("Indbagt")).toBe(true);
    expect(categoryExcludedFromStructuralFanOut("Drikkevarer")).toBe(true);
    expect(categoryExcludedFromStructuralFanOut("Dip og diverse")).toBe(true);
    expect(categoryEligibleForStructuralFanOut("Dip og diverse")).toBe(false);
    expect(categoryEligibleForStructuralFanOut("Drikkevarer")).toBe(false);
  });

  it("fans Alm+Fam onto sibling pizzas using median Fam surcharge", () => {
    const menu = menuWithCategories([
      {
        name: "PIZZA",
        products: [
          product({
            id: "p1",
            menu: "1",
            name: "Margherita",
            variants: [
              { name: "Alm.", surcharge: 0, isBase: true },
              { name: "Familie", surcharge: 11000 },
            ],
          }),
          product({
            id: "p2",
            menu: "2",
            name: "Elia",
            variants: [{ name: "Alm.", surcharge: 0, isBase: true }],
          }),
          product({
            id: "p3",
            menu: "3",
            name: "PIZZA Alm. Familie",
            variants: [],
          }),
        ],
      },
    ]);

    const { menu: out, traces } = applyCategoryVariantFanOut({ menu });
    expect(traces[0]!.applied).toBe(true);
    expect(traces[0]!.kindsApplied).toEqual(
      expect.arrayContaining(["alm", "familie"]),
    );
    const p2 = out.categories[0]!.products.find((p) => p.sourceMenuNumber === "2")!;
    expect(p2.variants.map((v) => v.name)).toEqual(["Alm.", "Familie"]);
    expect(p2.variants.find((v) => v.name === "Familie")!.surcharge).toBe(11000);
    const p3 = out.categories[0]!.products.find((p) => p.sourceMenuNumber === "3")!;
    expect(p3.variants.map((v) => v.name)).toEqual(["Alm.", "Familie"]);
    expect(p3.name).toBe("PIZZA");
  });

  it("fans Deep onto burgers when present in category", () => {
    const menu = menuWithCategories([
      {
        name: "Burgers",
        products: [
          product({
            id: "b1",
            menu: "10",
            name: "Cheese",
            variants: [
              { name: "Alm.", surcharge: 0, isBase: true },
              { name: "Deep", surcharge: 2000 },
            ],
          }),
          product({
            id: "b2",
            menu: "11",
            name: "Bacon",
            variants: [{ name: "Alm.", surcharge: 0, isBase: true }],
          }),
        ],
      },
    ]);
    const { menu: out } = applyCategoryVariantFanOut({ menu });
    const b2 = out.categories[0]!.products.find((p) => p.sourceMenuNumber === "11")!;
    expect(b2.variants.map((v) => v.name)).toEqual(
      expect.arrayContaining(["Alm.", "Deep"]),
    );
    expect(b2.variants.find((v) => v.name === "Deep")!.surcharge).toBe(2000);
  });

  it("fans Glutenfri / Fuldkorn / Hj. when observed", () => {
    const menu = menuWithCategories([
      {
        name: "Sandwich",
        products: [
          product({
            id: "s1",
            menu: "20",
            name: "Club",
            variants: [
              { name: "Alm.", surcharge: 0, isBase: true },
              { name: "Glutenfri", surcharge: 1500 },
              { name: "Fuldkorn", surcharge: 500 },
              { name: "Hj.", surcharge: 1000 },
            ],
          }),
          product({
            id: "s2",
            menu: "21",
            name: "Chicken",
            variants: [],
          }),
        ],
      },
    ]);
    const { menu: out } = applyCategoryVariantFanOut({ menu });
    const s2 = out.categories[0]!.products.find((p) => p.sourceMenuNumber === "21")!;
    expect(s2.variants.map((v) => v.name)).toEqual([
      "Alm.",
      "Glutenfri",
      "Fuldkorn",
      "Hj.",
    ]);
  });

  it("does not fan onto drinks or dip og diverse", () => {
    const menu = menuWithCategories([
      {
        name: "Drikkevarer",
        products: [
          product({
            id: "d1",
            menu: "90",
            name: "Cola",
            variants: [
              { name: "Alm.", surcharge: 0 },
              { name: "Familie", surcharge: 2000 },
            ],
          }),
          product({
            id: "d2",
            menu: "91",
            name: "Fanta",
            variants: [],
          }),
        ],
      },
      {
        name: "Dip og diverse",
        products: [
          product({
            id: "x1",
            menu: "95",
            name: "Mayo",
            variants: [
              { name: "Alm.", surcharge: 0 },
              { name: "Deep", surcharge: 500 },
            ],
          }),
          product({
            id: "x2",
            menu: "96",
            name: "Ketchup",
            variants: [],
          }),
        ],
      },
    ]);
    const { menu: out, traces } = applyCategoryVariantFanOut({ menu });
    expect(traces.every((t) => !t.applied)).toBe(true);
    expect(out.categories[0]!.products[1]!.variants).toEqual([]);
    expect(out.categories[1]!.products[1]!.variants).toEqual([]);
  });

  it("never invents Fam. surcharge without priced sibling", () => {
    const menu = menuWithCategories([
      {
        name: "PIZZA",
        products: [
          product({
            id: "p1",
            menu: "1",
            name: "A",
            variants: [{ name: "Alm.", surcharge: 0 }],
          }),
          product({
            id: "p2",
            menu: "2",
            name: "B",
            variants: [{ name: "Alm.", surcharge: 0 }],
          }),
        ],
      },
    ]);
    const { traces } = applyCategoryVariantFanOut({ menu });
    // Alm alone can be applied with median 0 — but no Fam to invent
    expect(traces[0]!.kindsApplied).not.toContain("familie");
  });

  it("encodes/parses categoryVariantFanOut on structure SEMANTIC_RULE", () => {
    const pattern = defaultStructurePattern();
    expect(pattern.categoryVariantFanOut.fanOutKinds).toEqual(
      expect.arrayContaining(["deep", "glutenfri", "hjemmelavet"]),
    );
    const encoded = encodeStructureSemanticRule(pattern);
    const parsed = parseStructureSemanticRule(encoded);
    expect(parsed?.categoryVariantFanOut.mode).toBe("SOURCE_CATEGORY");
    expect(parsed?.categoryVariantFanOut.fanOutKinds).toContain("familie");
  });

  it("distillStructurePatterns includes categoryVariantFanOut", () => {
    const snap: PeerMenuSnapshot = {
      host: "peer.dk",
      restaurantKey: "peer.dk",
      observedAt: new Date().toISOString(),
      source: "fixture",
      products: [
        {
          menuNumber: "1",
          name: "A",
          variants: [
            { name: "Alm.", priceOre: 0 },
            { name: "Familie", priceOre: 11000 },
          ],
          additions: [
            { name: "Mayonnaise", priceOre: 1000 },
            { name: "Ketchup", priceOre: 1000 },
          ],
        },
        {
          menuNumber: "2",
          name: "B",
          variants: [
            { name: "Alm.", priceOre: 0 },
            { name: "Familie", priceOre: 11000 },
          ],
          additions: [
            { name: "Mayonnaise", priceOre: 1000 },
            { name: "Ketchup", priceOre: 1000 },
          ],
        },
        {
          menuNumber: "3",
          name: "C",
          variants: [
            { name: "Alm.", priceOre: 0 },
            { name: "Familie", priceOre: 11000 },
          ],
          additions: [
            { name: "Mayonnaise", priceOre: 1000 },
            { name: "Ketchup", priceOre: 1000 },
          ],
        },
      ],
    };
    const summary = distillStructurePatterns([snap]);
    expect(summary.categoryVariantFanOut.enabled).toBe(true);
    expect(summary.categoryVariantFanOut.peerSizeCoverage).toBeGreaterThan(0);
    expect(DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY.enabled).toBe(true);
  });
});
