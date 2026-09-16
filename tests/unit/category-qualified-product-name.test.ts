import { describe, expect, it } from "vitest";
import {
  applyCategoryQualifiedProductName,
  isProductNameReceiptSafe,
  resolveReceiptNamingFamily,
  CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
} from "../../src/intelligence/categoryQualifiedProductName.js";
import { completeProductCard } from "../../src/intelligence/completeProductCard.js";
import { evaluateMenuQualityContract } from "../../src/intelligence/qualityContract.js";
import type { CanonicalProduct } from "../../src/domain/schema/canonical.js";

function apply(category: string, name: string) {
  return applyCategoryQualifiedProductName({
    categoryName: category,
    productName: name,
  });
}

function applyTwice(category: string, name: string) {
  const once = apply(category, name).name;
  const again = apply(category, once).name;
  return { once, again };
}

function minimalProduct(overrides: {
  sourceId: string;
  name: string;
  description?: string;
}): CanonicalProduct {
  return {
    sourceId: overrides.sourceId,
    categorySourceId: "cat:x",
    name: overrides.name,
    sourceOrder: 0,
    ingredients: [
      { display: "Tun", origin: "SOURCE" },
      { display: "Salat", origin: "SOURCE" },
    ],
    variants: [
      {
        sourceId: `${overrides.sourceId}:v0`,
        name: "Alm.",
        nameOrigin: "SOURCE",
        surcharge: 0,
        surchargeOrigin: "DERIVED",
        isBase: true,
        sourceTotalPrice: 7500,
      },
    ],
    addOns: [],
    productChoices: [],
    isCombo: false,
    issues: [],
    status: "READY",
    description: overrides.description ?? "Tun og salat",
  };
}

describe("CATEGORY_QUALIFIED_PRODUCT_NAME_V1", () => {
  it("exposes versioned policy id", () => {
    expect(CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID).toBe(
      "CATEGORY_QUALIFIED_PRODUCT_NAME_V1",
    );
  });

  describe("SALAD", () => {
    it("Salater + Tun → Salat m. Tun", () => {
      const r = apply("Salater", "Tun");
      expect(r.name).toBe("Salat m. Tun");
      expect(r.trace.family).toBe("SALAD");
      expect(r.trace.changed).toBe(true);
      expect(r.trace.reason).toBe(
        "PRODUCT_NAME_NOT_RECEIPT_SAFE_WITHOUT_CATEGORY",
      );
    });

    it("Salat + Kylling → Salat m. Kylling", () => {
      expect(apply("Salat", "Kylling").name).toBe("Salat m. Kylling");
    });

    it("Salater + Kylling og Bacon → Salat m. Kylling og Bacon", () => {
      expect(apply("Salater", "Kylling og Bacon").name).toBe(
        "Salat m. Kylling og Bacon",
      );
    });

    it("Salater + Græsk Salat → unchanged", () => {
      const r = apply("Salater", "Græsk Salat");
      expect(r.name).toBe("Græsk Salat");
      expect(r.trace.changed).toBe(false);
      expect(r.trace.reason).toBe("ALREADY_RECEIPT_SAFE");
    });
  });

  describe("PITA", () => {
    it("Pitabrød + Shawarma → Pita m. Shawarma", () => {
      expect(apply("Pitabrød", "Shawarma").name).toBe("Pita m. Shawarma");
      expect(resolveReceiptNamingFamily("Pitabrød")).toBe("PITA");
    });

    it("Pita + Kebab → Pita m. Kebab", () => {
      expect(apply("Pita", "Kebab").name).toBe("Pita m. Kebab");
    });

    it("Pita + Pita m. Kebab → unchanged", () => {
      expect(apply("Pita", "Pita m. Kebab").name).toBe("Pita m. Kebab");
    });

    it("Pita med Kebab stays source-faithful", () => {
      expect(apply("Pita", "Pita med Kebab").name).toBe("Pita med Kebab");
    });

    it("Pita Brød alias", () => {
      expect(resolveReceiptNamingFamily("Pita Brød")).toBe("PITA");
    });
  });

  describe("DURUM / ROLL", () => {
    it("Durum + Kylling → Durum m. Kylling", () => {
      expect(apply("Durum", "Kylling").name).toBe("Durum m. Kylling");
    });

    it("Durumrulle + Mix → Durum m. Mix", () => {
      expect(apply("Durumrulle", "Mix").name).toBe("Durum m. Mix");
      expect(resolveReceiptNamingFamily("Durumrulle")).toBe("DURUM");
    });

    it("Durum + Shawarma / Kebab", () => {
      expect(apply("Durum", "Shawarma").name).toBe("Durum m. Shawarma");
      expect(apply("Durumrulle", "Kebab").name).toBe("Durum m. Kebab");
    });

    it("Rulle + Kebab → Rulle m. Kebab (not Durum)", () => {
      expect(resolveReceiptNamingFamily("Rulle")).toBe("ROLL");
      expect(apply("Rulle", "Kebab").name).toBe("Rulle m. Kebab");
      expect(apply("Rulle", "Kylling").name).toBe("Rulle m. Kylling");
    });
  });

  describe("PIZZA SANDWICH", () => {
    it("Pizza Sandwich + Kylling", () => {
      expect(apply("Pizza Sandwich", "Kylling").name).toBe(
        "Pizza Sandwich m. Kylling",
      );
    });

    it("aliases Pizzasandwich / Pizza-Sandwich", () => {
      expect(resolveReceiptNamingFamily("Pizzasandwich")).toBe(
        "PIZZA_SANDWICH",
      );
      expect(resolveReceiptNamingFamily("Pizza-Sandwich")).toBe(
        "PIZZA_SANDWICH",
      );
      expect(apply("Pizzasandwich", "Kebab").name).toBe(
        "Pizza Sandwich m. Kebab",
      );
    });

    it("already qualified unchanged", () => {
      expect(apply("Pizza Sandwich", "Pizza Sandwich m. Kebab").name).toBe(
        "Pizza Sandwich m. Kebab",
      );
    });
  });

  describe("SANDWICH", () => {
    it("Sandwich + Kylling og Bacon", () => {
      expect(apply("Sandwich", "Kylling og Bacon").name).toBe(
        "Sandwich m. Kylling og Bacon",
      );
    });

    it("Sandwich + Skinke / Tun", () => {
      expect(apply("Sandwich", "Skinke").name).toBe("Sandwich m. Skinke");
      expect(apply("Sandwich", "Tun").name).toBe("Sandwich m. Tun");
    });

    it("Club Sandwich unchanged", () => {
      expect(apply("Sandwich", "Club Sandwich").name).toBe("Club Sandwich");
    });
  });

  describe("BAGEL", () => {
    it("Bagel + Tun", () => {
      expect(apply("Bagel", "Tun").name).toBe("Bagel m. Tun");
    });

    it("Bagel + Kylling og Bacon / Skinke", () => {
      expect(apply("Bagel", "Kylling og Bacon").name).toBe(
        "Bagel m. Kylling og Bacon",
      );
      expect(apply("Bagel", "Skinke").name).toBe("Bagel m. Skinke");
    });

    it("already qualified / Chicken Bagel unchanged", () => {
      expect(apply("Bagel", "Bagel m. Kylling").name).toBe("Bagel m. Kylling");
      expect(apply("Bagel", "Chicken Bagel").name).toBe("Chicken Bagel");
    });
  });

  describe("idempotency", () => {
    const cases: Array<[string, string]> = [
      ["Salater", "Tun"],
      ["Pita", "Kebab"],
      ["Durum", "Shawarma"],
      ["Rulle", "Kebab"],
      ["Pizza Sandwich", "Kylling"],
      ["Sandwich", "Skinke"],
      ["Bagel", "Tun"],
    ];

    it("applyPolicy(applyPolicy(name)) == applyPolicy(name)", () => {
      for (const [cat, name] of cases) {
        const { once, again } = applyTwice(cat, name);
        expect(again).toBe(once);
      }
    });
  });

  describe("negative / unrelated categories", () => {
    it("does not qualify Pizza / Burger / Drikkevarer", () => {
      expect(apply("Pizza", "Margherita").name).toBe("Margherita");
      expect(apply("Burger", "Cheeseburger").name).toBe("Cheeseburger");
      expect(apply("Burgers", "Smash burger").name).toBe("Smash burger");
      expect(apply("Drikkevarer", "Coca-Cola").name).toBe("Coca-Cola");
      expect(resolveReceiptNamingFamily("Pizza")).toBeNull();
      expect(resolveReceiptNamingFamily("Burgers")).toBeNull();
    });
  });

  describe("receipt-safe quality check", () => {
    it("fails underspecified names under qualifying categories", () => {
      expect(
        isProductNameReceiptSafe({
          productName: "Tun",
          categoryName: "Salater",
        }),
      ).toBe(false);
      expect(
        isProductNameReceiptSafe({
          productName: "Kebab",
          categoryName: "Pita",
        }),
      ).toBe(false);
    });

    it("passes qualified names", () => {
      expect(
        isProductNameReceiptSafe({
          productName: "Salat m. Tun",
          categoryName: "Salater",
        }),
      ).toBe(true);
      expect(
        isProductNameReceiptSafe({
          productName: "Margherita",
          categoryName: "Pizza",
        }),
      ).toBe(true);
    });
  });

  describe("completeProductCard integration + provenance", () => {
    it("writes qualified name onto card with SEMANTIC_RULE provenance", () => {
      const product = minimalProduct({
        sourceId: "src:tun",
        name: "Tun",
      });

      const card = completeProductCard({
        product,
        categoryName: "Salater",
      });
      expect(card.name).toBe("Salat m. Tun");
      const nameProv = card.provenance.find((p) => p.field === "name");
      expect(nameProv?.origin).toBe("SEMANTIC_RULE");
      expect(nameProv?.sourceRef).toBe("Tun");
      expect(card.policyTrace.categoryQualifiedProductName).toMatchObject({
        policyId: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
        originalName: "Tun",
        finalName: "Salat m. Tun",
        family: "SALAD",
      });
    });

    it("QualityContract PRODUCT_NAME_RECEIPT_SAFE passes after completion", () => {
      const product = minimalProduct({
        sourceId: "src:tun",
        name: "Salat m. Tun",
      });

      const quality = evaluateMenuQualityContract({
        restaurantName: "Test",
        schemaVersion: "1",
        domainRulesVersion: "1",
        status: "READY",
        issues: [],
        categories: [
          {
            sourceId: "cat:salater",
            name: "Salater",
            sourceOrder: 0,
            commonIngredients: [],
            products: [product],
          },
        ],
      } as never);
      const pq = quality.products[0]!;
      const check = pq.checks.find((c) => c.id === "PRODUCT_NAME_RECEIPT_SAFE");
      expect(check?.pass).toBe(true);
    });
  });
});
