/**
 * M6 decision types — strongly typed, extensible (not Veroni-closed).
 */

import { z } from "zod";

/** Extensible decision type: known literals + open string for future kinds. */
export const KNOWN_DECISION_TYPES = [
  "MENU_PRICE_OPTION_SEMANTICS",
  "PRODUCT_CHOICE",
  "DESTINATION_CATEGORY",
  "VARIANT_SEMANTICS",
  "ADDITION_SCOPE",
  "INGREDIENT_SEMANTICS",
  "CATEGORY_MAPPING",
  "COMBO_SEMANTICS",
  "PRICE_OPTION_SEMANTICS",
  "SOURCE_AMBIGUITY",
  "PRICE_SEMANTICS",
  "PRICE_CORRECTION",
  "VARIANT_PRICING",
  "ADDITION_SET",
  "ADDITION_PRICING",
  "ADDITION_CHOICE_RULE",
  "ADDITION_CORRECTION",
  "PRODUCT_CHOICE_OPTIONS",
  "PRODUCT_CHOICE_SCOPE",
] as const;

export type KnownDecisionType = (typeof KNOWN_DECISION_TYPES)[number];
export type DecisionType = KnownDecisionType | (string & {});

export const DecisionCaseStatusSchema = z.enum([
  "UNRESOLVED",
  "AUTO_RESOLVED_DETERMINISTIC",
  "AUTO_RESOLVED_POLICY",
  "AUTO_RESOLVED_PRECEDENT",
  "AUTO_RESOLVED_AI",
  "HUMAN_REVIEW_REQUIRED",
  "HUMAN_RESOLVED",
  "BLOCKED",
  "POLICY_CONFLICT",
]);
export type DecisionCaseStatus = z.infer<typeof DecisionCaseStatusSchema>;

export const PolicyScopeSchema = z.enum([
  "EXACT_CASE",
  "RESTAURANT",
  "RESTAURANT_CATEGORY",
  "GLOBAL",
  "CATEGORY_PATTERN",
]);
export type PolicyScope = z.infer<typeof PolicyScopeSchema>;

export const PolicyStatusSchema = z.enum([
  "DRAFT",
  "SHADOW",
  "ACTIVE",
  "DEPRECATED",
  "REJECTED",
]);
export type PolicyStatus = z.infer<typeof PolicyStatusSchema>;

export const RiskClassSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const ScopePreferenceSchema = z.enum([
  "APPLY_THIS_CASE_ONLY",
  "APPLY_TO_THIS_RESTAURANT",
  "APPLY_TO_THIS_RESTAURANT_CATEGORY",
  "PROPOSE_GLOBAL_RULE",
]);
export type ScopePreference = z.infer<typeof ScopePreferenceSchema>;

export const ConditionOpSchema = z.enum([
  "eq",
  "neq",
  "contains",
  "containsAny",
  "containsAll",
  "in",
  "exists",
  "gte",
  "lte",
]);
export type ConditionOp = z.infer<typeof ConditionOpSchema>;

export type PolicyConditionAtom = {
  field: string;
  op: ConditionOp;
  value?: unknown;
};

export type PolicyConditions = {
  all?: PolicyConditionAtom[];
  any?: PolicyConditionAtom[];
};

export type DecisionOption = {
  id: string;
  label: string;
  effect?: string;
};

export type DecisionFeatures = {
  decisionType: DecisionType;
  normalizedPhrases: string[];
  explicitChoiceMarkers: string[];
  slashSeparatedOptions: boolean;
  orMarkers: boolean;
  chooseMarkers: boolean;
  optionalMarkers: boolean;
  priceStructure: string | null;
  priceOptionLabels: string[];
  variantLabels: string[];
  optionCount: number;
  sourceCategory: string | null;
  destinationCategoryCandidates: string[];
  hasExplicitPricePerOption: boolean;
  hasSingleSharedPrice: boolean;
  hasMissingOptionPrices: boolean;
  productTypeHints: string[];
  contextBefore: string | null;
  contextAfter: string | null;
  sourceConfidence: number | null;
  visualEvidenceAvailable: boolean;
  ocrConfidence: number | null;
  exactCaseKey: string;
  restaurantKey: string | null;
};

export type DecisionCase = {
  decisionCaseId: string;
  runId: string;
  sourceId: string;
  restaurantId: string;
  restaurantKey: string;
  host: string;
  menuNumber: string | null;
  productName: string;
  sourceCategory: string | null;
  destinationCategoryCandidate: string | null;
  decisionType: DecisionType;
  sourceText: string;
  normalizedSourceText: string;
  contextFeatures: DecisionFeatures;
  sourceEvidenceJson: string | null;
  currentCanonicalInterpretation: string;
  availableOptions: DecisionOption[];
  recommendedOptionId: string | null;
  recommendedRationale: string | null;
  /** System recommendation only — NEVER treat as human approval */
  isSystemRecommendationOnly: boolean;
  status: DecisionCaseStatus;
  riskClass: RiskClass;
  resolutionId: string | null;
  resolutionMethod: string | null;
  explanationJson: string | null;
  createdAt: string;
  updatedAt: string;
  decisionEngineVersion: string;
  schemaVersion: string;
};

export type HumanDecision = {
  humanDecisionId: string;
  decisionCaseId: string;
  selectedResolution: string;
  selectedOptionId: string;
  operatorId: string | null;
  decisionType: DecisionType;
  scopeRequested: ScopePreference;
  scopeApproved: PolicyScope;
  comment: string | null;
  sourceEvidenceSnapshot: string | null;
  decisionFeaturesSnapshot: string;
  canonicalBeforeJson: string | null;
  canonicalAfterJson: string | null;
  createdAt: string;
  engineVersion: string;
  schemaVersion: string;
  supersedesHumanDecisionId: string | null;
};

export type DecisionPolicy = {
  policyId: string;
  policyVersion: number;
  decisionType: DecisionType;
  scope: PolicyScope;
  scopeRestaurant: string | null;
  scopeCategory: string | null;
  conditions: PolicyConditions;
  resolution: string;
  resolutionOptionId: string;
  status: PolicyStatus;
  createdFromDecisionIds: string[];
  confidenceEvidence: string | null;
  createdAt: string;
  activatedAt: string | null;
  deprecatedAt: string | null;
  createdBy: string;
  validationSummary: string | null;
  inventsMissingFacts: boolean;
  /** SEMANTIC_RULE may generalize; BUSINESS_FACT must not go GLOBAL with fixed values. */
  knowledgeKind?: "SEMANTIC_RULE" | "BUSINESS_FACT";
};

export type PolicyMatch = {
  matched: boolean;
  policyId: string;
  policyVersion: number;
  specificity: number;
  matchedConditions: PolicyConditionAtom[];
  failedConditions: PolicyConditionAtom[];
  resolution: string;
  resolutionOptionId: string;
  evidenceScore: number;
};

export type PrecedentHit = {
  humanDecisionId: string;
  decisionCaseId: string;
  decisionType: DecisionType;
  resolution: string;
  resolutionOptionId: string;
  restaurantKey: string;
  score: number;
  breakdown: Record<string, number>;
  features: DecisionFeatures;
};

export type PrecedentConsensus = {
  agreement: number;
  dominantResolution: string | null;
  dominantOptionId: string | null;
  count: number;
  restaurantCount: number;
  conflicting: boolean;
  hits: PrecedentHit[];
};

export type ReasonerOutput = {
  proposedResolution: string;
  proposedOptionId: string;
  reasonCode: string;
  evidenceUsed: string[];
  precedentIds: string[];
  uncertainties: string[];
  modelConfidence: number;
  requiresHumanReview: boolean;
  providerVersion: string;
};

export type GateVerdict = "AUTO_APPROVE" | "REVIEW" | "BLOCK";

export type AutoDecisionGateResult = {
  verdict: GateVerdict;
  reasonCodes: string[];
  riskClass: RiskClass;
};

export type DecisionOutcome = {
  decisionCaseId: string;
  status: DecisionCaseStatus;
  resolution: string | null;
  optionId: string | null;
  method:
    | "DETERMINISTIC"
    | "ACTIVE_POLICY"
    | "PRECEDENT"
    | "AI_GATE"
    | "HUMAN"
    | "NONE";
  policyId: string | null;
  policyVersion: number | null;
  precedentIds: string[];
  explanation: string;
  gate: AutoDecisionGateResult | null;
  reasoner: ReasonerOutput | null;
  policyMatches: PolicyMatch[];
};

export type HumanReviewAnswer = {
  decisionCaseId: string;
  resolution: string;
  selectedOptionId: string;
  scopePreference: ScopePreference;
  comment?: string;
  operatorId?: string;
};

export type PolicyCandidate = {
  candidateId: string;
  proposedScope: PolicyScope;
  scopeRestaurant: string | null;
  scopeCategory: string | null;
  decisionType: DecisionType;
  conditions: PolicyConditions;
  resolution: string;
  resolutionOptionId: string;
  supportingDecisionIds: string[];
  examplesMatched: string[];
  examplesExcluded: string[];
  potentialConflicts: string[];
  inventsMissingFacts: boolean;
  createdAt: string;
};

export type ShadowEvaluation = {
  policyId: string;
  policyVersion: number;
  matches: number;
  correctMatches: number;
  conflicts: number;
  changedHistoricalOutcomes: number;
  falseGeneralizations: number;
  passed: boolean;
  details: string[];
};

export type DecisionMetrics = {
  decisionCases: number;
  resolvedDeterministically: number;
  resolvedByActivePolicy: number;
  resolvedByPrecedent: number;
  resolvedByAiGate: number;
  humanReviewRequired: number;
  humanResolved: number;
  policyConflicts: number;
  blocked: number;
  humanInterventionRate: number;
  autoResolutionRate: number;
  policyHitRate: number;
  precedentHitRate: number;
  aiResolutionRate: number;
  humanOverrideRate: number;
  policyConflictRate: number;
  priceDecisionCases?: number;
  priceAutoResolved?: number;
  priceHumanResolved?: number;
  additionDecisionCases?: number;
  additionAutoResolved?: number;
  additionHumanResolved?: number;
  additionPolicyHitRate?: number;
  restaurantFactReuseRate?: number;
  scopeConflictRate?: number;
  sourceVsLearnedConflictRate?: number;
  humanQuestionsAvoided?: number;
};
