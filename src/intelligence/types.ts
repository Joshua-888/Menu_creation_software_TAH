/**
 * Shared types for the single Menu Intelligence spine.
 * Create and QA both produce TargetMenu through MenuIntelligenceEngine.
 */

import type { CanonicalMenu } from "../domain/schema/canonical.js";
import type { SourceMenu } from "../domain/schema/source.js";
import type { IngredientLikelihoodPolicy } from "../learning/ingredientLikelihood.js";
import type { AdditionLikelihoodPolicy } from "../learning/additionLikelihood.js";
import type { DecisionStore } from "../decisions/store.js";

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
  }>;
  writeEligible: boolean;
  writeBlockReason?: string;
};
