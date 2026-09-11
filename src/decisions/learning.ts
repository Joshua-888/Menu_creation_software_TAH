import { randomUUID } from "node:crypto";
import type { DecisionStore } from "./store.js";
import type {
  DecisionCase,
  DecisionPolicy,
  HumanDecision,
  HumanReviewAnswer,
  PolicyCandidate,
  PolicyConditions,
  PolicyScope,
  ScopePreference,
  ShadowEvaluation,
} from "./types.js";
import { matchPolicy } from "./conditions.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
  DECISION_THRESHOLDS,
} from "./versions.js";
import { assertGlobalPolicyHasNoFixedMoney } from "./facts.js";

function scopeFromPreference(
  pref: ScopePreference,
): PolicyScope {
  switch (pref) {
    case "APPLY_THIS_CASE_ONLY":
      return "EXACT_CASE";
    case "APPLY_TO_THIS_RESTAURANT":
      return "RESTAURANT";
    case "APPLY_TO_THIS_RESTAURANT_CATEGORY":
      return "RESTAURANT_CATEGORY";
    case "PROPOSE_GLOBAL_RULE":
      return "GLOBAL";
  }
}

export function generatePolicyCandidate(input: {
  decisionCase: DecisionCase;
  human: HumanDecision;
}): PolicyCandidate {
  const scope = scopeFromPreference(input.human.scopeRequested);
  const f = input.decisionCase.contextFeatures;
  const conditions: PolicyConditions = {
    all: [
      { field: "decisionType", op: "eq", value: input.decisionCase.decisionType },
    ],
  };
  if (f.explicitChoiceMarkers.length) {
    conditions.all!.push({
      field: "explicitChoiceMarkers",
      op: "containsAll",
      value: f.explicitChoiceMarkers,
    });
  }
  if (f.priceStructure) {
    conditions.all!.push({
      field: "priceStructure",
      op: "eq",
      value: f.priceStructure,
    });
  }
  if (scope === "EXACT_CASE") {
    conditions.all!.push({
      field: "exactCaseKey",
      op: "eq",
      value: f.exactCaseKey,
    });
  }
  if (scope === "RESTAURANT" || scope === "RESTAURANT_CATEGORY") {
    conditions.all!.push({
      field: "restaurantKey",
      op: "eq",
      value: input.decisionCase.restaurantKey,
    });
  }
  if (
    scope === "RESTAURANT_CATEGORY" &&
    input.decisionCase.sourceCategory
  ) {
    conditions.all!.push({
      field: "sourceCategory",
      op: "eq",
      value: input.decisionCase.sourceCategory,
    });
  }

  // Never invent combo contents for Menu semantics
  const invents =
    input.decisionCase.decisionType === "MENU_PRICE_OPTION_SEMANTICS" &&
    /combo|fries|soda|pommes|sodavand/i.test(input.human.selectedResolution);

  return {
    candidateId: `pcand_${randomUUID()}`,
    proposedScope: scope,
    scopeRestaurant:
      scope === "GLOBAL" ? null : input.decisionCase.restaurantKey,
    scopeCategory:
      scope === "RESTAURANT_CATEGORY"
        ? input.decisionCase.sourceCategory
        : null,
    decisionType: input.decisionCase.decisionType,
    conditions,
    resolution: input.human.selectedResolution,
    resolutionOptionId: input.human.selectedOptionId,
    supportingDecisionIds: [input.human.humanDecisionId],
    examplesMatched: [input.decisionCase.decisionCaseId],
    examplesExcluded: [],
    potentialConflicts: [],
    inventsMissingFacts: invents,
    createdAt: new Date().toISOString(),
  };
}

export function promoteCandidateToShadow(
  store: DecisionStore,
  candidate: PolicyCandidate,
  createdBy = "system",
): DecisionPolicy {
  if (candidate.inventsMissingFacts) {
    throw new Error("Cannot shadow policy that invents missing facts");
  }
  // Fixed money / option lists are BUSINESS_FACT — never GLOBAL
  const looksLikeFact =
    /"amountMinor"\s*:/.test(candidate.resolution) ||
    /"options"\s*:\s*\[/.test(candidate.resolution) ||
    /\b\d{3,}\b/.test(candidate.resolution);
  if (candidate.proposedScope === "GLOBAL" && looksLikeFact) {
    assertGlobalPolicyHasNoFixedMoney({
      scope: "GLOBAL",
      knowledgeKind: "BUSINESS_FACT",
      resolution: candidate.resolution,
    });
  }
  const policy: DecisionPolicy = {
    policyId: `pol_${candidate.decisionType}_${candidate.proposedScope}_${randomUUID().slice(0, 8)}`,
    policyVersion: 1,
    decisionType: candidate.decisionType,
    scope: candidate.proposedScope,
    scopeRestaurant: candidate.scopeRestaurant,
    scopeCategory: candidate.scopeCategory,
    conditions: candidate.conditions,
    resolution: candidate.resolution,
    resolutionOptionId: candidate.resolutionOptionId,
    status: "SHADOW",
    createdFromDecisionIds: candidate.supportingDecisionIds,
    confidenceEvidence: `candidate:${candidate.candidateId}`,
    createdAt: new Date().toISOString(),
    activatedAt: null,
    deprecatedAt: null,
    createdBy,
    validationSummary: null,
    inventsMissingFacts: false,
    knowledgeKind: looksLikeFact ? "BUSINESS_FACT" : "SEMANTIC_RULE",
  };
  store.insertPolicyVersion(policy);
  return policy;
}

export function shadowEvaluate(
  store: DecisionStore,
  policy: DecisionPolicy,
): ShadowEvaluation {
  const humans = store.listHumanDecisions({
    decisionType: String(policy.decisionType),
  });
  let matches = 0;
  let correct = 0;
  let conflicts = 0;
  let changed = 0;
  const details: string[] = [];

  for (const h of humans) {
    const c = store.getCase(h.decisionCaseId);
    if (!c) continue;
    // scope filter
    if (
      policy.scopeRestaurant &&
      policy.scopeRestaurant !== c.restaurantKey
    ) {
      continue;
    }
    const m = matchPolicy(c.contextFeatures, policy);
    if (!m.matched) continue;
    matches += 1;
    if (
      m.resolution === h.selectedResolution &&
      m.resolutionOptionId === h.selectedOptionId
    ) {
      correct += 1;
    } else {
      conflicts += 1;
      changed += 1;
      details.push(
        `would change ${h.humanDecisionId}: ${h.selectedOptionId} → ${m.resolutionOptionId}`,
      );
    }
  }

  const passed = changed === 0 && conflicts === 0;
  return {
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    matches,
    correctMatches: correct,
    conflicts,
    changedHistoricalOutcomes: changed,
    falseGeneralizations: conflicts,
    passed,
    details,
  };
}

/**
 * Merge a new human decision into an existing matching SHADOW policy when
 * resolution + scope + condition fingerprint align. Returns updated SHADOW
 * (or null if no merge target — caller should create a fresh SHADOW).
 */
export function mergeSupportIntoMatchingShadow(
  store: DecisionStore,
  candidate: PolicyCandidate,
): DecisionPolicy | null {
  const shadows = store.listPolicies("SHADOW");
  const candFp = JSON.stringify(candidate.conditions);
  for (const pol of shadows) {
    if (pol.decisionType !== candidate.decisionType) continue;
    if (pol.scope !== candidate.proposedScope) continue;
    if (pol.scopeRestaurant !== candidate.scopeRestaurant) continue;
    if (pol.resolutionOptionId !== candidate.resolutionOptionId) continue;
    if (pol.resolution !== candidate.resolution) continue;
    if (JSON.stringify(pol.conditions) !== candFp) continue;
    if (pol.inventsMissingFacts || candidate.inventsMissingFacts) continue;

    const ids = [
      ...new Set([
        ...pol.createdFromDecisionIds,
        ...candidate.supportingDecisionIds,
      ]),
    ];
    return store.newPolicyStatus(pol.policyId, pol.policyVersion, "SHADOW", {
      createdFromDecisionIds: ids,
      validationSummary: `support merged → ${ids.length}`,
    });
  }
  return null;
}

export function tryPromoteShadowToActive(
  store: DecisionStore,
  policy: DecisionPolicy,
): { promoted: boolean; reason: string; policy?: DecisionPolicy } {
  if (policy.status !== "SHADOW") {
    return { promoted: false, reason: "NOT_SHADOW" };
  }
  const eval_ = shadowEvaluate(store, policy);
  if (!eval_.passed) {
    return { promoted: false, reason: "SHADOW_EVAL_FAILED" };
  }
  const support = policy.createdFromDecisionIds.length;

  if (policy.scope === "GLOBAL") {
    if (!DECISION_THRESHOLDS.globalAutoPromoteEnabled) {
      return {
        promoted: false,
        reason: "GLOBAL_AUTO_PROMOTE_DISABLED",
      };
    }
    if (support < DECISION_THRESHOLDS.globalPolicyMinSupport) {
      return { promoted: false, reason: "GLOBAL_SUPPORT_TOO_LOW" };
    }
  } else if (
    policy.scope === "RESTAURANT" ||
    policy.scope === "RESTAURANT_CATEGORY" ||
    policy.scope === "EXACT_CASE"
  ) {
    if (support < DECISION_THRESHOLDS.restaurantPolicyMinSupport) {
      return { promoted: false, reason: "RESTAURANT_SUPPORT_TOO_LOW" };
    }
  }

  const next = store.newPolicyStatus(policy.policyId, policy.policyVersion, "ACTIVE", {
    validationSummary: JSON.stringify(eval_),
  });
  return { promoted: true, reason: "PROMOTED", policy: next };
}

export function handleHumanCorrection(input: {
  store: DecisionStore;
  case: DecisionCase;
  previousAutoMethod: string;
  previousPolicyId: string | null;
  previousPolicyVersion: number | null;
  answer: HumanReviewAnswer;
}): HumanDecision {
  const human: HumanDecision = {
    humanDecisionId: `hd_${randomUUID()}`,
    decisionCaseId: input.case.decisionCaseId,
    selectedResolution: input.answer.resolution,
    selectedOptionId: input.answer.selectedOptionId,
    operatorId: input.answer.operatorId ?? null,
    decisionType: input.case.decisionType,
    scopeRequested: input.answer.scopePreference,
    scopeApproved: scopeFromPreference(input.answer.scopePreference),
    comment: input.answer.comment ?? "correction of automatic decision",
    sourceEvidenceSnapshot: input.case.sourceEvidenceJson,
    decisionFeaturesSnapshot: JSON.stringify(input.case.contextFeatures),
    canonicalBeforeJson: null,
    canonicalAfterJson: null,
    createdAt: new Date().toISOString(),
    engineVersion: DECISION_ENGINE_VERSION,
    schemaVersion: DECISION_SCHEMA_VERSION,
    supersedesHumanDecisionId: null,
  };
  input.store.insertHumanDecision(human);

  if (input.previousPolicyId != null && input.previousPolicyVersion != null) {
    const pol = input.store.getPolicy(
      input.previousPolicyId,
      input.previousPolicyVersion,
    );
    if (pol && pol.status === "ACTIVE") {
      input.store.newPolicyStatus(
        pol.policyId,
        pol.policyVersion,
        "SHADOW",
        {
          validationSummary: `REVALIDATION after human correction ${human.humanDecisionId}`,
        },
      );
    }
  }
  return human;
}
