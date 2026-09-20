/**
 * WP6 — completeness observability / benchmark artifact.
 *
 * Pure aggregation over already-computed data: `buildCompletenessBenchmark`
 * consumes the MenuQualityContract result (WP5) + WP4 completeness traces and
 * reports field-level counts. No completion / quality logic is re-run here.
 *
 * Covered:
 * (a) product counts reconcile (total === resolved + review + blocked);
 * (b) categories roll up from per-product statuses;
 * (c) provenance buckets tally a hand-constructed trace set exactly, and only
 *     count values that were actually selected;
 * (d) fields with no trace coverage yet report honest zeros, never fabrications;
 * (e) the real third-merchant fixture flows through the pipeline and the
 *     benchmark reflects Massaman Curry's REVIEW status + its ingredient trace.
 */

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { buildCompletenessBenchmark } from "../../../src/intelligence/completenessBenchmark.js";
import { runRawSourceCertification } from "../../../src/certification/runRawCertification.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../../src/domain/versions.js";
import type { CanonicalMenu } from "../../../src/domain/schema/canonical.js";
import type {
  FieldCompletenessTrace,
  MenuQualityContractResult,
  ProductQualityResult,
  QualityStatus,
} from "../../../src/intelligence/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function qualityProduct(
  productSourceId: string,
  name: string,
  status: QualityStatus,
): ProductQualityResult {
  return {
    productSourceId,
    name,
    status,
    checks: [],
    blockers: [],
    completenessWarnings: [],
  };
}

function menu(
  categories: { sourceId: string; name: string; productIds: string[] }[],
  productNameById: Record<string, string> = {},
): CanonicalMenu {
  return {
    restaurantName: "Benchmark Fixture",
    categories: categories.map((c, ci) => ({
      sourceId: c.sourceId,
      name: c.name,
      sourceOrder: ci,
      commonIngredients: [],
      products: c.productIds.map((id, pi) => ({
        sourceId: id,
        categorySourceId: c.sourceId,
        sourceOrder: pi,
        name: productNameById[id] ?? id,
        ingredients: [],
        variants: [],
        addOns: [],
        productChoices: [],
        isCombo: false,
        status: "READY" as const,
        issues: [],
      })),
    })),
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
    status: "READY",
    issues: [],
  } as unknown as CanonicalMenu;
}

function qualityResult(
  products: ProductQualityResult[],
): MenuQualityContractResult {
  const ready = products.filter((p) => p.status === "QUALITY_READY").length;
  const review = products.filter((p) => p.status === "QUALITY_REVIEW").length;
  const blocked = products.filter(
    (p) => p.status === "QUALITY_BLOCKED",
  ).length;
  return {
    menuStatus:
      blocked > 0
        ? "MENU_QUALITY_BLOCKED"
        : review > 0
          ? "MENU_QUALITY_REVIEW"
          : "MENU_QUALITY_READY",
    products,
    coherence: [],
    blockers: [],
    readyProductIds: products
      .filter((p) => p.status === "QUALITY_READY")
      .map((p) => p.productSourceId),
    reviewProductIds: products
      .filter((p) => p.status === "QUALITY_REVIEW")
      .map((p) => p.productSourceId),
    blockedProductIds: products
      .filter((p) => p.status === "QUALITY_BLOCKED")
      .map((p) => p.productSourceId),
    statusAccounting: {
      productCount: products.length,
      ready,
      review,
      blocked,
      reconciles: ready + review + blocked === products.length,
    },
    findingCounts: { failedChecks: 0, coherenceFailures: 0 },
    completenessAccounting: {
      productsWithWarnings: 0,
      warningCount: 0,
      reconciles: true,
    },
  };
}

function trace(
  partial: Partial<FieldCompletenessTrace> & {
    field: string;
    finalStatus: FieldCompletenessTrace["finalStatus"];
  },
): FieldCompletenessTrace {
  return {
    requirementLevel: "REQUIRED",
    initialStatus: "UNRESOLVED",
    evidenceConsidered: [],
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// (a) product counts reconcile
// ---------------------------------------------------------------------------

describe("WP6 completeness benchmark — product counts", () => {
  it("counts by status and reconciles total === resolved + review + blocked", () => {
    const m = menu(
      [{ sourceId: "c1", name: "Burgers", productIds: ["p1", "p2", "p3"] }],
      { p1: "Burger A", p2: "Burger B", p3: "Burger C" },
    );
    const q = qualityResult([
      qualityProduct("p1", "Burger A", "QUALITY_READY"),
      qualityProduct("p2", "Burger B", "QUALITY_REVIEW"),
      qualityProduct("p3", "Burger C", "QUALITY_BLOCKED"),
    ]);

    const bench = buildCompletenessBenchmark({ menu: m, quality: q });

    expect(bench.products).toEqual({
      total: 3,
      resolved: 1,
      review: 1,
      blocked: 1,
    });
    expect(bench.products.total).toBe(
      bench.products.resolved + bench.products.review + bench.products.blocked,
    );
    expect(bench.products.total).toBe(q.products.length);
  });
});

// ---------------------------------------------------------------------------
// (b) categories roll up from product statuses
// ---------------------------------------------------------------------------

describe("WP6 completeness benchmark — category aggregation", () => {
  it("marks a category 'review' if any product is non-READY, else 'resolved'", () => {
    const m = menu(
      [
        { sourceId: "c1", name: "Burgers", productIds: ["p1", "p2"] },
        { sourceId: "c2", name: "Drinks", productIds: ["p3"] },
        { sourceId: "c3", name: "Desserts", productIds: ["p4"] },
      ],
      { p1: "Burger A", p2: "Burger B", p3: "Cola", p4: "Kage" },
    );
    const q = qualityResult([
      qualityProduct("p1", "Burger A", "QUALITY_READY"),
      // c1 is polluted by one non-READY product → review.
      qualityProduct("p2", "Burger B", "QUALITY_REVIEW"),
      qualityProduct("p3", "Cola", "QUALITY_READY"),
      qualityProduct("p4", "Kage", "QUALITY_BLOCKED"),
    ]);

    const bench = buildCompletenessBenchmark({ menu: m, quality: q });

    expect(bench.categories.total).toBe(3);
    // c1 (review) + c3 (blocked product = not resolved) = 2 review; c2 resolved.
    expect(bench.categories.review).toBe(2);
    expect(bench.categories.resolved).toBe(1);
    expect(bench.categories.total).toBe(
      bench.categories.resolved + bench.categories.review,
    );
  });

  it("treats a product missing from the quality result as not resolved (fail-safe)", () => {
    const m = menu(
      [{ sourceId: "c1", name: "Burgers", productIds: ["p1", "p2"] }],
      { p1: "Burger A", p2: "Burger B" },
    );
    // p2 is absent from the quality result — unknown, never silently resolved.
    const q = qualityResult([
      qualityProduct("p1", "Burger A", "QUALITY_READY"),
    ]);

    const bench = buildCompletenessBenchmark({ menu: m, quality: q });

    expect(bench.categories.review).toBe(1);
    expect(bench.categories.resolved).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (c) provenance tallies
// ---------------------------------------------------------------------------

describe("WP6 completeness benchmark — provenance", () => {
  it("buckets every tier and counts only selected (non-UNRESOLVED) values", () => {
    const m = menu([{ sourceId: "c1", name: "Burgers", productIds: ["p1"] }], {
      p1: "Burger A",
    });
    const q = qualityResult([
      qualityProduct("p1", "Burger A", "QUALITY_READY"),
    ]);

    const traces: FieldCompletenessTrace[] = [
      // SOURCE x2
      trace({ field: "ingredients", finalStatus: "SUFFICIENT", selectedTier: "SOURCE" }),
      trace({ field: "additions", finalStatus: "SUFFICIENT", selectedTier: "SOURCE" }),
      // BUSINESS_FACT = EXACT_PRODUCT_FACT + RESTAURANT_FACT
      trace({
        field: "ingredients",
        finalStatus: "SUFFICIENT",
        selectedTier: "EXACT_PRODUCT_FACT",
      }),
      trace({
        field: "additions",
        finalStatus: "SUFFICIENT",
        selectedTier: "RESTAURANT_FACT",
      }),
      // CATEGORY_EVIDENCE
      trace({
        field: "ingredients",
        finalStatus: "SUFFICIENT",
        selectedTier: "CATEGORY_EVIDENCE",
      }),
      // PEER = PEER_SUBTYPE + PEER_FAMILY
      trace({
        field: "ingredients",
        finalStatus: "SUFFICIENT",
        selectedTier: "PEER_SUBTYPE",
      }),
      trace({
        field: "additions",
        finalStatus: "SUFFICIENT",
        selectedTier: "PEER_FAMILY",
      }),
      // DOMAIN_PRIOR
      trace({
        field: "ingredients",
        finalStatus: "PARTIAL",
        selectedTier: "DOMAIN_PRIOR",
      }),
      // UNRESOLVED — no value selected: must NOT be tallied.
      trace({
        field: "ingredients",
        finalStatus: "UNRESOLVED",
        selectedTier: "UNRESOLVED",
      }),
      trace({ field: "ingredients", finalStatus: "UNRESOLVED" }),
    ];

    const bench = buildCompletenessBenchmark({
      menu: m,
      quality: q,
      completenessTraces: [traces],
    });

    expect(bench.provenance).toEqual({
      SOURCE: 2,
      BUSINESS_FACT: 2,
      CATEGORY_EVIDENCE: 1,
      PEER: 2,
      DOMAIN_PRIOR: 1,
    });
  });

  it("does not mis-bucket GLOBAL_POLICY (no Section 17 bucket)", () => {
    const m = menu([{ sourceId: "c1", name: "Burgers", productIds: ["p1"] }], {
      p1: "Burger A",
    });
    const q = qualityResult([
      qualityProduct("p1", "Burger A", "QUALITY_READY"),
    ]);
    const bench = buildCompletenessBenchmark({
      menu: m,
      quality: q,
      completenessTraces: [
        [
          trace({
            field: "ingredients",
            finalStatus: "SUFFICIENT",
            selectedTier: "GLOBAL_POLICY",
          }),
        ],
      ],
    });
    const total = Object.values(bench.provenance).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (d) field counts — honest zeros for uncovered fields
// ---------------------------------------------------------------------------

describe("WP6 completeness benchmark — field counts", () => {
  it("tallies ingredients/additions and reports honest zeros elsewhere", () => {
    const m = menu([{ sourceId: "c1", name: "Burgers", productIds: ["p1"] }], {
      p1: "Burger A",
    });
    const q = qualityResult([
      qualityProduct("p1", "Burger A", "QUALITY_READY"),
    ]);

    const traces: FieldCompletenessTrace[] = [
      trace({
        field: "ingredients",
        requirementLevel: "REQUIRED",
        finalStatus: "SUFFICIENT",
        selectedTier: "SOURCE",
      }),
      trace({
        field: "ingredients",
        requirementLevel: "REQUIRED",
        finalStatus: "UNRESOLVED",
      }),
      trace({
        field: "additions",
        requirementLevel: "EXPECTED",
        finalStatus: "SUFFICIENT",
        selectedTier: "SOURCE",
      }),
      // NOT_APPLICABLE / FORBIDDEN are not expectations → excluded, not penalised.
      trace({
        field: "ingredients",
        requirementLevel: "NOT_APPLICABLE",
        finalStatus: "NOT_APPLICABLE",
      }),
      trace({
        field: "additions",
        requirementLevel: "FORBIDDEN",
        finalStatus: "NOT_APPLICABLE",
      }),
    ];

    const bench = buildCompletenessBenchmark({
      menu: m,
      quality: q,
      completenessTraces: [traces],
    });

    expect(bench.fields.ingredients).toEqual({
      required: 2,
      resolved: 1,
      unresolved: 1,
    });
    expect(bench.fields.ingredients.required).toBe(
      bench.fields.ingredients.resolved + bench.fields.ingredients.unresolved,
    );
    expect(bench.fields.additions).toEqual({
      expected: 1,
      resolved: 1,
      unresolved: 0,
    });

    // No trace coverage for these fields yet → honest zeros, never fabricated.
    // `description` is a required-style field (mission: required/resolved/
    // unresolved); the others are expected-style (expected/resolved/unresolved).
    expect(bench.fields.description).toEqual({
      required: 0,
      resolved: 0,
      unresolved: 0,
    });
    for (const field of [
      "variants",
      "productChoices",
      "comboComponents",
    ] as const) {
      expect(bench.fields[field]).toEqual({
        expected: 0,
        resolved: 0,
        unresolved: 0,
      });
    }
  });

  it("is pure and deterministic (same input → deep-equal output)", () => {
    const m = menu([{ sourceId: "c1", name: "Burgers", productIds: ["p1"] }], {
      p1: "Burger A",
    });
    const q = qualityResult([
      qualityProduct("p1", "Burger A", "QUALITY_READY"),
    ]);
    const a = buildCompletenessBenchmark({ menu: m, quality: q });
    const b = buildCompletenessBenchmark({ menu: m, quality: q });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// (e) real third-merchant fixture through the production pipeline
// ---------------------------------------------------------------------------

describe("WP6 completeness benchmark — third-merchant pipeline", () => {
  it(
    "reflects Massaman Curry's REVIEW status and its ingredient trace",
    async () => {
      const root = process.cwd();
      const result = await runRawSourceCertification({
        restaurantName: "Fixture Thai House",
        restaurantKey: "fixture-thai.example",
        rawFilePath: resolve(root, "fixtures/golden/third-merchant/raw-source.pdf"),
        kind: "pdf",
        repoRoot: root,
      });

      const bench = result.intelligence.completenessBenchmark;
      expect(bench).toBeTruthy();
      if (!bench) throw new Error("benchmark missing");

      // Product roll-up mirrors the WP5 status accounting exactly.
      expect(bench.products.total).toBe(
        result.intelligence.quality.statusAccounting.productCount,
      );
      expect(bench.products.review).toBe(
        result.intelligence.quality.statusAccounting.review,
      );
      expect(bench.products.total).toBe(
        bench.products.resolved + bench.products.review + bench.products.blocked,
      );
      expect(bench.categories.total).toBe(
        result.intelligence.targetMenu.categories.length,
      );
      expect(bench.categories.total).toBe(
        bench.categories.resolved + bench.categories.review,
      );

      // Massaman Curry is the single REVIEW product (WP5 documented delta).
      expect(bench.products.review).toBeGreaterThanOrEqual(1);
      const massamanTrace = result.intelligence.policyTraces.find(
        (t) => t.name === "Massaman Curry",
      );
      expect(massamanTrace).toBeTruthy();
      const massamanIngredientTrace = massamanTrace?.completenessTraces?.find(
        (t) => t.field === "ingredients",
      );
      expect(massamanIngredientTrace).toBeTruthy();
      expect(massamanIngredientTrace?.finalStatus).not.toBe("SUFFICIENT");

      // The benchmark's ingredient counts are non-trivial and include at least
      // one unresolved field — consistent with the ingredient trace above.
      expect(bench.fields.ingredients.required).toBeGreaterThan(0);
      expect(bench.fields.ingredients.unresolved).toBeGreaterThanOrEqual(1);
    },
    180_000,
  );
});
