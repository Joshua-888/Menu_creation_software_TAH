import { describe, expect, it } from "vitest";
import { diagnoseSourceProductCoverage } from "../../src/intelligence/sourceCoverage.js";
import type { SourceAccounting } from "../../src/extraction/pdf/types.js";

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

describe("source product coverage", () => {
  it("blocks when price-row evidence greatly exceeds extracted products", () => {
    const result = diagnoseSourceProductCoverage({
      accounting: accounting(1),
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

  it("does not require a fixed minimum product count", () => {
    const result = diagnoseSourceProductCoverage({
      accounting: accounting(2),
      uniqueProducts: 2,
      rawText: "Burger 75 Kr.\nKebab 90 Kr.",
    });
    expect(result.suspicious).toBe(false);
  });
});
