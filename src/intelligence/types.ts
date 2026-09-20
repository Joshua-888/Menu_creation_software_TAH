/**
 * Shared types for the single Menu Intelligence spine.
 * Create and QA both produce TargetMenu through MenuIntelligenceEngine.
 */

import type { CanonicalMenu } from "../domain/schema/canonical.js";
import type { SourceMenu } from "../domain/schema/source.js";
import type { IngredientLikelihoodPolicy } from "../learning/ingredientLikelihood.js";
import type { AdditionLikelihoodPolicy } from "../learning/additionLikelihood.js";
import type { DecisionStore } from "../decisions/store.js";
import type { CompletenessBenchmark } from "./completenessBenchmark.js";

export type IntelligenceMode = "CREATE_MENU" | "QA_RECONCILE";

export type SemanticEntityType =
  | "PRODUCT_NAME"
  | "CATEGORY"
  | "INGREDIENT"
  | "ADDITION"
  | "VARIANT"
  | "PRODUCT_CHOICE"
  | "COMBO_COMPONENT"
  | "COMBO_CONTEXT"
  | "META_INSTRUCTION"
  | "PRICE"
  | "DESCRIPTION_TEXT"
  | "UNKNOWN";

export type FieldOrigin =
  | "SOURCE"
  | "SOURCE_OCR"
  | "SOURCE_PDF_TEXT"
  | "SOURCE_LAYOUT"
  | "SOURCE_VISION"
  | "HUMAN_APPROVED"
  | "PEER_INFERENCE"
  | "DOMAIN_PRIOR"
  | "DERIVED"
  | "SYSTEM_DEFAULT"
  | "SEMANTIC_RULE";

export type FieldProvenance = {
  field: string;
  value: string;
  origin: FieldOrigin;
  confidence: number;
  sourceRef?: string;
  cohort?: string;
  support?: number;
  probability?: number;
  restaurantCount?: number;
  reason?: string;
};

export type ClassifiedPhrase = {
  rawText: string;
  normalizedText: string;
  entityType: SemanticEntityType;
  confidence: number;
  sourceEvidence?: string;
  reason: string;
};

/**
 * Semantic Completeness Engine (V1) — evidence provenance tier.
 *
 * Ordered evidence hierarchy used when deciding how a field should be completed:
 *
 *   SOURCE > EXACT_PRODUCT_FACT > RESTAURANT_FACT > CATEGORY_EVIDENCE >
 *   PEER_SUBTYPE > PEER_FAMILY > GLOBAL_POLICY > DOMAIN_PRIOR > UNRESOLVED
 *
 * Higher-ranked tiers must win over lower-ranked tiers when both supply a value
 * for the same field. `UNRESOLVED` means no evidence source could produce a
 * value; it must never be silently treated as an empty/complete value.
 *
 * This type is foundational only in WP1 — it is not yet wired into runtime logic.
 */
export type SemanticProvenanceTier =
  | "SOURCE"
  | "EXACT_PRODUCT_FACT"
  | "RESTAURANT_FACT"
  | "CATEGORY_EVIDENCE"
  | "PEER_SUBTYPE"
  | "PEER_FAMILY"
  | "GLOBAL_POLICY"
  | "DOMAIN_PRIOR"
  | "UNRESOLVED";

/**
 * Semantic Completeness Engine (V1) — requiredness of a field for a product.
 *
 * Describes how strongly a field must be present for a given product/category:
 * - REQUIRED: missing/insufficient value blocks completeness (hard gate).
 * - EXPECTED: missing value is a completeness gap but not a hard block.
 * - CONDITIONAL: requirement depends on other resolved facts/context.
 * - OPTIONAL: value may be absent without affecting completeness.
 * - FORBIDDEN: a value must NOT be present (presence is a defect).
 * - NOT_APPLICABLE: field is meaningless for this product/context.
 *
 * Foundational only in WP1 — not yet wired into runtime logic.
 */
export type FieldRequirementLevel =
  | "REQUIRED"
  | "EXPECTED"
  | "CONDITIONAL"
  | "OPTIONAL"
  | "FORBIDDEN"
  | "NOT_APPLICABLE";

/**
 * Semantic Completeness Engine (V1) — sufficiency outcome for a field.
 *
 * - SUFFICIENT: acceptable value resolved from evidence.
 * - PARTIAL: some value/evidence exists but does not fully satisfy the field.
 * - INSUFFICIENT: evidence exists but is below the required bar.
 * - UNRESOLVED: no usable evidence found (must remain explicit, never implicit empty).
 * - NOT_APPLICABLE: field does not apply for this product/context.
 *
 * Foundational only in WP1 — not yet wired into runtime logic.
 */
export type FieldSufficiencyStatus =
  | "SUFFICIENT"
  | "PARTIAL"
  | "INSUFFICIENT"
  | "UNRESOLVED"
  | "NOT_APPLICABLE";

/**
 * Semantic Completeness Engine (V1) — audit trace for one field's completion.
 *
 * Records how a field was evaluated: the requirement level, its status before
 * completion, every provenance tier considered, which tier/value was selected,
 * what was rejected and why, and the final status after the engine ran.
 *
 * `evidenceConsidered` should reflect the ranked evidence hierarchy
 * (see {@link SemanticProvenanceTier}); `selectedTier` should be the highest-ranked
 * tier that produced the accepted value. `rejectedCandidates` captures lower-ranked
 * or conflicting candidates for auditability. `confidence` is optional and only
 * meaningful when the engine can quantify it.
 *
 * Foundational only in WP1 — not yet wired into runtime logic.
 */
export interface FieldCompletenessTrace {
  /** The target field this trace describes (e.g. "ingredients", "description"). */
  field: string;
  /** Requiredness of the field for the product/context being completed. */
  requirementLevel: FieldRequirementLevel;
  /** Sufficiency status before completion was attempted. */
  initialStatus: FieldSufficiencyStatus;
  /** Provenance tiers that were inspected as candidate evidence. */
  evidenceConsidered: SemanticProvenanceTier[];
  /** Highest-ranked tier whose value was accepted, if any. */
  selectedTier?: SemanticProvenanceTier;
  /** Value selected from `selectedTier`, if any. */
  selectedValue?: unknown;
  /** Candidates considered but not selected, with the tier and rejection reason. */
  rejectedCandidates?: {
    value: unknown;
    tier: SemanticProvenanceTier;
    reason: string;
  }[];
  /** Optional confidence for the selected value when quantifiable. */
  confidence?: number;
  /** Sufficiency status after completion was attempted. */
  finalStatus: FieldSufficiencyStatus;
}

export type ProductFamily =
  | "BURGER"
  | "BACON_BURGER"
  | "CHEESE_BURGER"
  | "SANDWICH"
  | "PIZZA"
  | "SALATPIZZA"
  | "CALZONE"
  | "DURUM"
  | "PITA"
  | "PASTA"
  | "INDIAN_MAIN"
  | "FRIES"
  | "NACHOS"
  | "SUSHI"
  | "DRINK"
  | "COMBO_MENU"
  | "OTHER_FOOD"
  | "UNKNOWN";

export type QualityStatus =
  | "QUALITY_READY"
  | "QUALITY_REVIEW"
  | "QUALITY_BLOCKED";

export type MenuQualityStatus =
  | "MENU_QUALITY_READY"
  | "MENU_QUALITY_REVIEW"
  | "MENU_QUALITY_BLOCKED";

export type QualityCheckId =
  | "PRODUCT_NAME_VALID"
  | "PRODUCT_NAME_RECEIPT_SAFE"
  | "CATEGORY_SEMANTIC_FIT"
  | "DESCRIPTION_PROFESSIONAL"
  | "INGREDIENTS_COMPLETE"
  | "INGREDIENTS_VALID"
  | "NO_META_AS_INGREDIENT"
  | "NO_PRODUCT_NAME_AS_INGREDIENT"
  | "NO_GLUED_INGREDIENTS"
  | "VARIANT_STRUCTURE_VALID"
  | "NO_MENU_VARIANT"
  | "PRODUCT_CHOICES_VALID"
  | "COMBO_STRUCTURE_VALID"
  | "ADDITIONS_VALID"
  | "ADDITION_SCOPE_VALID"
  | "ADDITION_PRICE_SUPPORTED"
  | "ADDITIONS_EXPECTATION_RESOLVED"
  | "VARIANT_EXPECTATION_RESOLVED"
  | "PRICE_SUPPORTED"
  | "NO_OCR_GARBAGE"
  | "GRAMMAR_VALID"
  | "PROVENANCE_SUFFICIENT";

export type QualityCheckResult = {
  id: QualityCheckId;
  pass: boolean;
  detail?: string;
};

export type ProductQualityResult = {
  productSourceId: string;
  menuNumber?: string;
  name: string;
  status: QualityStatus;
  checks: QualityCheckResult[];
  blockers: string[];
  /**
   * Non-gating completeness advisories (WP5). EXPECTED-level gaps (e.g. an
   * addition list that is expected but unresolved) are surfaced here WITHOUT
   * moving `status` off QUALITY_READY — they are review signal, not a gate.
   */
  completenessWarnings: string[];
};

export type MenuCoherenceCheck = {
  id: string;
  pass: boolean;
  detail?: string;
};

export type MenuQualityContractResult = {
  menuStatus: MenuQualityStatus;
  products: ProductQualityResult[];
  coherence: MenuCoherenceCheck[];
  blockers: string[];
  readyProductIds: string[];
  reviewProductIds: string[];
  blockedProductIds: string[];
  /**
   * Mutually exclusive product-status totals.
   * Invariant: ready + review + blocked === productCount
   */
  statusAccounting: {
    productCount: number;
    ready: number;
    review: number;
    blocked: number;
    reconciles: boolean;
  };
  /** Finding counts (NOT product counts) — one product may contribute many. */
  findingCounts: {
    failedChecks: number;
    coherenceFailures: number;
  };
  /**
   * WP5 completeness accounting — advisory (non-gating) completeness signal.
   * EXPECTED-level gaps are counted here so review tooling can see them without
   * the products being forced off QUALITY_READY. `reconciles` asserts that the
   * per-product warning array and this aggregate agree.
   */
  completenessAccounting: {
    productsWithWarnings: number;
    warningCount: number;
    reconciles: boolean;
  };
};

export type PolicyLifecycleStatus = "ACTIVE" | "SUPERSEDED" | "DEPRECATED";

export type PolicyLifecycleRecord = {
  policyId: string;
  status: PolicyLifecycleStatus;
  replacementPolicyId?: string;
  reason: string;
  date: string;
  version: string;
};

export type PeerConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type PeerEvidenceThresholds = {
  highMinRestaurants: number;
  highMinProbability: number;
  mediumMinRestaurants: number;
  mediumMinProbability: number;
  lowBelowRestaurants: number;
};

export type CompletedProductCard = {
  name: string;
  categoryName: string;
  description: string;
  ingredients: string[];
  variants: Array<{ name: string; priceOre?: number; isBase?: boolean }>;
  productChoices: Array<{ prompt: string; options: string[] }>;
  comboComponents: string[];
  additions: Array<{
    name: string;
    priceOre?: number;
    priceProvenance?: FieldProvenance;
  }>;
  prices: Array<{ label: string; priceOre: number }>;
  productFamily: ProductFamily;
  isCombo: boolean;
  provenance: FieldProvenance[];
  policyTrace: Record<string, unknown>;
  /**
   * Semantic Completeness Engine (V1) — per-field completion traces.
   *
   * Additive explainability only (WP4): records how ingredients/additions were
   * evaluated. It does NOT by itself change READY/REVIEW/BLOCKED outcomes; the
   * QualityContract gate that consumes these traces is a later work package.
   */
  completenessTraces: FieldCompletenessTrace[];
};

export type MenuIntelligenceInput = {
  mode: IntelligenceMode;
  restaurantName: string;
  restaurantKey: string;
  /** CREATE: extracted source (post-OCR/reconcile). */
  sourceMenu?: SourceMenu;
  /** Already-built canonical (CREATE after domain, or QA from live). */
  canonicalMenu: CanonicalMenu;
  decisionStore?: DecisionStore;
  ingredientLikelihood?: IngredientLikelihoodPolicy | null;
  additionLikelihood?: AdditionLikelihoodPolicy | null;
  constitutionVersion?: string;
};

export type TargetMenu = CanonicalMenu;

export type MenuIntelligenceResult = {
  constitutionVersion: string;
  mode: IntelligenceMode;
  targetMenu: TargetMenu;
  quality: MenuQualityContractResult;
  policyTraces: Array<{
    productSourceId: string;
    name: string;
    category: string;
    fields: Record<string, unknown>;
    qualityChecks: QualityCheckResult[];
    /**
     * Semantic Completeness Engine (V1) — per-field completion traces (WP4).
     * Additive explainability; consumers of the existing shape are unaffected.
     */
    completenessTraces?: FieldCompletenessTrace[];
  }>;
  writeEligible: boolean;
  writeBlockReason?: string;
  /**
   * Semantic Completeness Engine (V1) — WP6 completeness observability.
   *
   * Deterministic per-run field-level counts aggregated from already-computed
   * quality outcomes + WP4 completion traces (see `buildCompletenessBenchmark`).
   * Purely additive: observability only — it never influences `writeEligible`,
   * `quality`, or any gate. Optional so existing consumers are unaffected.
   */
  completenessBenchmark?: CompletenessBenchmark;
};
