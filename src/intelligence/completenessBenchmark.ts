/**
 * Completeness observability / benchmark artifact
 * (SEMANTIC_COMPLETENESS_ENGINE_V1 — WP6).
 *
 * Pure aggregation ONLY. This module consumes data the pipeline has already
 * computed — the per-product statuses from the MenuQualityContract (WP5) and the
 * per-field completion traces (WP4) — and reports field-level counts for a run.
 *
 * It deliberately does NOT:
 *   - re-run or duplicate any completion / quality logic;
 *   - change any quality-gate outcome (QUALITY_READY / REVIEW / BLOCKED);
 *   - invent a single "quality score". Field-level facts are the primary truth
 *     (mission Section 17), so an operator can see exactly which dimension is
 *     incomplete instead of one opaque number;
 *   - perform any I/O. Persisting the artifact is the caller's job.
 */

import type { CanonicalMenu } from "../domain/schema/canonical.js";
import type {
  FieldCompletenessTrace,
  MenuQualityContractResult,
  SemanticProvenanceTier,
} from "./types.js";
import type { FieldName } from "./fieldRequirements.js";

/** Counts for a field the mission terms "required" (e.g. ingredients). */
export type RequiredFieldCounts = {
  required: number;
  resolved: number;
  unresolved: number;
};

/** Counts for a field the mission terms "expected" (e.g. additions). */
export type ExpectedFieldCounts = {
  expected: number;
  resolved: number;
  unresolved: number;
};

/**
 * Deterministic, per-run completeness report.
 *
 * Every number is a count derived from already-computed evidence — never a
 * weighted score. `required`/`expected` is the number of products for which the
 * field was applicable and carried a completeness expectation;
 * `resolved` + `unresolved` always reconciles back to it.
 */
export interface CompletenessBenchmark {
  /**
   * Category roll-up derived from the product statuses.
   * `review` = a category contains at least one non-READY product (review OR
   * blocked); `resolved` = every product is QUALITY_READY. A category whose
   * products are absent from the quality result is treated as `review` (unknown
   * must not be silently reported as resolved). Invariant:
   * `total === resolved + review`.
   */
  categories: { total: number; resolved: number; review: number };
  /**
   * Direct product-status roll-up from the MenuQualityContract (WP5). Counted by
   * status, never recomputed. Invariant:
   * `total === resolved + review + blocked` and `total === products.length`.
   */
  products: { total: number; resolved: number; review: number; blocked: number };
  /** Field-level completeness counts, keyed by the canonical {@link FieldName}. */
  fields: {
    ingredients: RequiredFieldCounts;
    description: RequiredFieldCounts;
    additions: ExpectedFieldCounts;
    variants: ExpectedFieldCounts;
    productChoices: ExpectedFieldCounts;
    comboComponents: ExpectedFieldCounts;
  };
  /**
   * How many accepted values came from each evidence class. Buckets use the
   * mission's operator-facing terminology; the finer WP1 tiers are folded into
   * the closest class (see {@link provenanceBucket}). Only traces whose
   * `finalStatus` indicates a value was actually selected (not UNRESOLVED) are
   * tallied.
   */
  provenance: {
    SOURCE: number;
    /** EXACT_PRODUCT_FACT + RESTAURANT_FACT (the restaurant's own business facts). */
    BUSINESS_FACT: number;
    CATEGORY_EVIDENCE: number;
    /** PEER_SUBTYPE + PEER_FAMILY (both peer-derived evidence). */
    PEER: number;
    DOMAIN_PRIOR: number;
  };
}

export interface CompletenessBenchmarkInput {
  /**
   * Target menu structure. Needed only to group products into categories — the
   * MenuQualityContract exposes per-product statuses but not their category.
   */
  menu: CanonicalMenu;
  /** Per-product quality outcomes from WP5 (`MenuQualityContractResult.products`). */
  quality: MenuQualityContractResult;
  /**
   * WP4 completeness traces, grouped one array per product trace (exactly what
   * `MenuIntelligenceResult.policyTraces[].completenessTraces` produces). The
   * arrays are flattened internally; a flat array also works.
   */
  completenessTraces?: readonly (readonly FieldCompletenessTrace[])[];
}

/**
 * Map a WP1 provenance tier onto the mission's operator-facing bucket.
 *
 * Returns `null` for tiers that have no bucket in the Section 17 vocabulary:
 * `UNRESOLVED` (by definition no value was selected) and `GLOBAL_POLICY`
 * (currently unreachable as a selected tier — no resolver ever assigns it, only
 * `TIER_RANK`/`SUPPLEMENTAL_TIERS` reference it). Keeping this explicit avoids a
 * silent mis-attribution if the tier set changes later.
 */
function provenanceBucket(
  tier: SemanticProvenanceTier,
): keyof CompletenessBenchmark["provenance"] | null {
  switch (tier) {
    case "SOURCE":
      return "SOURCE";
    case "EXACT_PRODUCT_FACT":
    case "RESTAURANT_FACT":
      // Both are authoritative restaurant-level facts (approved product facts
      // and restaurant business facts); the mission groups them as BUSINESS_FACT.
      return "BUSINESS_FACT";
    case "CATEGORY_EVIDENCE":
      return "CATEGORY_EVIDENCE";
    case "PEER_SUBTYPE":
    case "PEER_FAMILY":
      // Peer_SUBTYPE is a finer peer cohort than PEER_FAMILY; both are PEER.
      return "PEER";
    case "DOMAIN_PRIOR":
      return "DOMAIN_PRIOR";
    case "GLOBAL_POLICY":
    case "UNRESOLVED":
      return null;
  }
}

/**
 * A trace contributes to a field's counts only when the field was applicable
 * and actually carried a completeness expectation. NOT_APPLICABLE (field is
 * meaningless here, e.g. ingredients on a drink) and FORBIDDEN (a value must NOT
 * be present, e.g. food additions on a drink) are not expectations, so they are
 * excluded from the denominator rather than counted as unresolved.
 */
function isApplicableTrace(trace: FieldCompletenessTrace): boolean {
  return (
    trace.requirementLevel !== "NOT_APPLICABLE" &&
    trace.requirementLevel !== "FORBIDDEN"
  );
}

function tallyField(
  traces: readonly FieldCompletenessTrace[],
  field: FieldName,
): { total: number; resolved: number; unresolved: number } {
  let total = 0;
  let resolved = 0;
  for (const trace of traces) {
    if (trace.field !== field) continue;
    if (!isApplicableTrace(trace)) continue;
    total += 1;
    // A field is "resolved" only when sufficiency is fully SUFFICIENT. PARTIAL /
    // INSUFFICIENT / UNRESOLVED all surface as "unresolved" (not fully resolved),
    // which keeps `required/expected === resolved + unresolved` exact.
    if (trace.finalStatus === "SUFFICIENT") resolved += 1;
  }
  return { total, resolved, unresolved: total - resolved };
}

/**
 * Build a deterministic {@link CompletenessBenchmark} from already-computed
 * quality outcomes and completeness traces.
 *
 * Pure and side-effect free: the same inputs always yield a deep-equal result.
 *
 * @param input Target menu + WP5 quality result + optional WP4 traces.
 */
export function buildCompletenessBenchmark(
  input: CompletenessBenchmarkInput,
): CompletenessBenchmark {
  const traces: FieldCompletenessTrace[] = input.completenessTraces
    ? input.completenessTraces.flatMap((group) => [...group])
    : [];

  // --- categories ---------------------------------------------------------
  // Group by the menu structure and read each product's status from the quality
  // result, keyed by the stable productSourceId.
  const statusBySourceId = new Map(
    input.quality.products.map((p) => [p.productSourceId, p.status] as const),
  );
  let categoriesResolved = 0;
  let categoriesReview = 0;
  for (const category of input.menu.categories) {
    let anyNotReady = false;
    for (const product of category.products) {
      // Missing status -> not READY (fail-safe: unknown is never "resolved").
      if (statusBySourceId.get(product.sourceId) !== "QUALITY_READY") {
        anyNotReady = true;
        break;
      }
    }
    if (anyNotReady) categoriesReview += 1;
    else categoriesResolved += 1;
  }

  // --- products -----------------------------------------------------------
  let ready = 0;
  let review = 0;
  let blocked = 0;
  for (const product of input.quality.products) {
    if (product.status === "QUALITY_READY") ready += 1;
    else if (product.status === "QUALITY_REVIEW") review += 1;
    else blocked += 1;
  }

  // --- fields -------------------------------------------------------------
  // WP4 currently emits traces only for ingredients and additions. The other
  // governed fields have no trace data yet, so the same tally honestly reports
  // zero (never a fabricated number); a future WP that emits those traces will
  // be picked up here automatically.
  const ingredients = tallyField(traces, "ingredients");
  const description = tallyField(traces, "description");
  const additions = tallyField(traces, "additions");
  const variants = tallyField(traces, "variants");
  const productChoices = tallyField(traces, "productChoices");
  const comboComponents = tallyField(traces, "comboComponents");

  // --- provenance ---------------------------------------------------------
  const provenance: CompletenessBenchmark["provenance"] = {
    SOURCE: 0,
    BUSINESS_FACT: 0,
    CATEGORY_EVIDENCE: 0,
    PEER: 0,
    DOMAIN_PRIOR: 0,
  };
  for (const trace of traces) {
    // Only a value that was actually selected counts (never UNRESOLVED).
    if (trace.finalStatus === "UNRESOLVED") continue;
    const tier = trace.selectedTier;
    if (!tier) continue;
    const bucket = provenanceBucket(tier);
    if (bucket) provenance[bucket] += 1;
  }

  return {
    categories: {
      total: input.menu.categories.length,
      resolved: categoriesResolved,
      review: categoriesReview,
    },
    products: {
      total: input.quality.products.length,
      resolved: ready,
      review,
      blocked,
    },
    fields: {
      ingredients: {
        required: ingredients.total,
        resolved: ingredients.resolved,
        unresolved: ingredients.unresolved,
      },
      description: {
        required: description.total,
        resolved: description.resolved,
        unresolved: description.unresolved,
      },
      additions: {
        expected: additions.total,
        resolved: additions.resolved,
        unresolved: additions.unresolved,
      },
      variants: {
        expected: variants.total,
        resolved: variants.resolved,
        unresolved: variants.unresolved,
      },
      productChoices: {
        expected: productChoices.total,
        resolved: productChoices.resolved,
        unresolved: productChoices.unresolved,
      },
      comboComponents: {
        expected: comboComponents.total,
        resolved: comboComponents.resolved,
        unresolved: comboComponents.unresolved,
      },
    },
    provenance,
  };
}
