import { describe, expect, it } from "vitest";
import {
  diagnoseSourceProductCoverage,
  evaluateMenuQualityContract,
} from "../../src/intelligence/index.js";
import type { SourceAccounting } from "../../src/extraction/pdf/types.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";

function accounting(candidatesDetected: number): SourceAccounting {
  return {
    sourceFile: "fixture.jpg",
    generatedAt: new Date(0).toISOString(),
    entries: [],
    summary: {
      candidatesDetected,
      extracted: 1,
      duplicateSourceEvidence: 0,
      manualReviewRequired: 0,
      blocked: 0,
      nonProduct: 0,
    },
  };
}

function singleProductMenu(name = "Cheese Burger"): CanonicalMenu {
  return {
    restaurantName: "Coverage Fixture",
    categories: [
      {
        sourceId: "c1",
        name: "Burgers",
        sourceOrder: 0,
        commonIngredients: [],
        products: [
          {
            sourceId: "p1",
            categorySourceId: "c1",
            name,
            sourceOrder: 0,
            ingredients: [],
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
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
    status: "READY",
    issues: [],
  };
}

describe("source product coverage", () => {
  it("blocks when structural product candidates greatly exceed extracted products", () => {
    const result = diagnoseSourceProductCoverage({
      accounting: accounting(4),
      uniqueProducts: 1,
      rawText: [
        "Burger 75 Kr.",
        "Cheese burger 85 Kr.",
        "Kebab 90 Kr.",
        "Durum 95 Kr.",
      ].join("\n"),
    });
    expect(result.suspicious).toBe(true);
    expect(result.id).toBe("SOURCE_PRODUCT_COVERAGE_SUSPICIOUS");
  });

  it("does not flag a multi-price menu when candidate coverage matches products", () => {
    const repeatedPrices = Array.from(
      { length: 148 },
      (_, i) => `Variant ${i + 1} 99 kr.`,
    ).join("\n");
    const result = diagnoseSourceProductCoverage({
      accounting: accounting(24),
      uniqueProducts: 24,
      rawText: repeatedPrices,
      ocrRows: repeatedPrices.split("\n"),
    });
    expect(result.candidateCount).toBe(24);
    expect(result.priceLikeTokens).toBeGreaterThan(100);
    expect(result.suspicious).toBe(false);
    expect(result.evidencePerProduct).toBe(1);
  });

  it("does not require a fixed minimum product count", () => {
    const result = diagnoseSourceProductCoverage({
      accounting: accounting(2),
      uniqueProducts: 2,
      rawText: "Burger 75 Kr.\nKebab 90 Kr.",
    });
    expect(result.suspicious).toBe(false);
  });

  it("central contract does NOT flag low product count with low source evidence", () => {
    const menu = singleProductMenu();
    const evidence = {
      accounting: accounting(1),
      uniqueProducts: 1,
      rawText: "Cheese Burger 75 kr.",
    };
    const coverage = diagnoseSourceProductCoverage(evidence);
    expect(coverage.suspicious).toBe(false);

    const quality = evaluateMenuQualityContract(menu, coverage);
    expect(
      quality.coherence.some(
        (c) => c.id === "SOURCE_PRODUCT_COVERAGE_SUSPICIOUS",
      ),
    ).toBe(false);
  });

  it("central contract surfaces coverage suspicion for ANY caller", () => {
    const menu = singleProductMenu();
    const evidence = {
      accounting: accounting(4),
      uniqueProducts: 1,
      rawText: [
        "Burger 75 kr.",
        "Cheese burger 85 kr.",
        "Kebab 90 kr.",
        "Durum 95 kr.",
      ].join("\n"),
    };
    const coverage = diagnoseSourceProductCoverage(evidence);
    expect(coverage.suspicious).toBe(true);

    const quality = evaluateMenuQualityContract(menu, coverage);
    const finding = quality.coherence.find(
      (c) => c.id === "SOURCE_PRODUCT_COVERAGE_SUSPICIOUS",
    );
    expect(finding).toBeDefined();
    expect(finding?.pass).toBe(false);
  });

  it("central contract without source evidence emits no coverage finding", () => {
    const menu = singleProductMenu();
    const quality = evaluateMenuQualityContract(menu);
    expect(
      quality.coherence.some(
        (c) => c.id === "SOURCE_PRODUCT_COVERAGE_SUSPICIOUS",
      ),
    ).toBe(false);
  });
});
