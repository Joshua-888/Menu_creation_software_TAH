/**
 * Safe structured policy condition DSL — no eval, no dynamic code.
 */

import type {
  DecisionFeatures,
  PolicyConditionAtom,
  PolicyConditions,
  PolicyMatch,
  DecisionPolicy,
} from "./types.js";
import { PolicyScopeSchema } from "./types.js";

const SCOPE_SPECIFICITY: Record<string, number> = {
  EXACT_CASE: 400,
  RESTAURANT_CATEGORY: 300,
  RESTAURANT: 200,
  CATEGORY_PATTERN: 150,
  GLOBAL: 100,
};

export function scopeSpecificity(scope: string): number {
  return SCOPE_SPECIFICITY[scope] ?? 0;
}

function getField(features: DecisionFeatures, field: string): unknown {
  const map: Record<string, unknown> = {
    decisionType: features.decisionType,
    choiceMarker: features.explicitChoiceMarkers[0] ?? null,
    choiceMarkers: features.explicitChoiceMarkers,
    explicitChoiceMarkers: features.explicitChoiceMarkers,
    hasExplicitOptions: features.explicitChoiceMarkers.length > 0,
    slashSeparatedOptions: features.slashSeparatedOptions,
    orMarkers: features.orMarkers,
    chooseMarkers: features.chooseMarkers,
    optionalMarkers: features.optionalMarkers,
    priceStructure: features.priceStructure,
    priceOptionLabels: features.priceOptionLabels,
    sourceCategory: features.sourceCategory,
    restaurantKey: features.restaurantKey,
    exactCaseKey: features.exactCaseKey,
    productTypeHints: features.productTypeHints,
    optionCount: features.optionCount,
    hasExplicitPricePerOption: features.hasExplicitPricePerOption,
  };
  return map[field];
}

export function evalAtom(
  features: DecisionFeatures,
  atom: PolicyConditionAtom,
): boolean {
  const left = getField(features, atom.field);
  switch (atom.op) {
    case "exists":
      return left !== undefined && left !== null && left !== "";
    case "eq":
      return left === atom.value;
    case "neq":
      return left !== atom.value;
    case "contains":
      if (typeof left === "string" && typeof atom.value === "string") {
        return left.toLowerCase().includes(atom.value.toLowerCase());
      }
      if (Array.isArray(left)) {
        return left.map(String).includes(String(atom.value));
      }
      return false;
    case "containsAny": {
      const want = Array.isArray(atom.value) ? atom.value.map(String) : [];
      const have = Array.isArray(left)
        ? left.map(String)
        : typeof left === "string"
          ? [left]
          : [];
      return want.some((w) => have.includes(w));
    }
    case "containsAll": {
      const want = Array.isArray(atom.value) ? atom.value.map(String) : [];
      const have = Array.isArray(left)
        ? left.map(String)
        : typeof left === "string"
          ? [left]
          : [];
      return want.every((w) => have.includes(w));
    }
    case "in": {
      const set = Array.isArray(atom.value) ? atom.value : [];
      return set.includes(left as never);
    }
    case "gte":
      return typeof left === "number" && typeof atom.value === "number"
        ? left >= atom.value
        : false;
    case "lte":
      return typeof left === "number" && typeof atom.value === "number"
        ? left <= atom.value
        : false;
    default:
      return false;
  }
}

export function matchConditions(
  features: DecisionFeatures,
  conditions: PolicyConditions,
): { matched: boolean; matchedConditions: PolicyConditionAtom[]; failedConditions: PolicyConditionAtom[] } {
  const matchedConditions: PolicyConditionAtom[] = [];
  const failedConditions: PolicyConditionAtom[] = [];
  const all = conditions.all ?? [];
  const any = conditions.any ?? [];

  for (const atom of all) {
    if (evalAtom(features, atom)) matchedConditions.push(atom);
    else failedConditions.push(atom);
  }
  if (failedConditions.length) {
    return { matched: false, matchedConditions, failedConditions };
  }
  if (any.length) {
    const anyOk = any.filter((a) => evalAtom(features, a));
    if (!anyOk.length) {
      return {
        matched: false,
        matchedConditions,
        failedConditions: [...any],
      };
    }
    matchedConditions.push(...anyOk);
  }
  return { matched: true, matchedConditions, failedConditions };
}

export function matchPolicy(
  features: DecisionFeatures,
  policy: DecisionPolicy,
): PolicyMatch {
  // Scope filters
  if (policy.scope === "RESTAURANT" || policy.scope === "RESTAURANT_CATEGORY") {
    if (
      policy.scopeRestaurant &&
      policy.scopeRestaurant !== features.restaurantKey
    ) {
      return {
        matched: false,
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        specificity: scopeSpecificity(policy.scope),
        matchedConditions: [],
        failedConditions: [
          {
            field: "restaurantKey",
            op: "eq",
            value: policy.scopeRestaurant,
          },
        ],
        resolution: policy.resolution,
        resolutionOptionId: policy.resolutionOptionId,
        evidenceScore: 0,
      };
    }
  }
  if (
    (policy.scope === "RESTAURANT_CATEGORY" ||
      policy.scope === "CATEGORY_PATTERN") &&
    policy.scopeCategory
  ) {
    if (features.sourceCategory !== policy.scopeCategory) {
      return {
        matched: false,
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        specificity: scopeSpecificity(policy.scope),
        matchedConditions: [],
        failedConditions: [
          {
            field: "sourceCategory",
            op: "eq",
            value: policy.scopeCategory,
          },
        ],
        resolution: policy.resolution,
        resolutionOptionId: policy.resolutionOptionId,
        evidenceScore: 0,
      };
    }
  }

  const { matched, matchedConditions, failedConditions } = matchConditions(
    features,
    policy.conditions,
  );
  return {
    matched,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    specificity: scopeSpecificity(policy.scope),
    matchedConditions,
    failedConditions,
    resolution: policy.resolution,
    resolutionOptionId: policy.resolutionOptionId,
    evidenceScore: matched ? matchedConditions.length + scopeSpecificity(policy.scope) / 100 : 0,
  };
}

export function assertValidScope(scope: string): void {
  PolicyScopeSchema.parse(scope);
}
