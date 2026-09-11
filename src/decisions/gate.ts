import type {
  AutoDecisionGateResult,
  DecisionCase,
  DecisionFeatures,
  PrecedentConsensus,
  ReasonerOutput,
  RiskClass,
} from "./types.js";
import { DECISION_THRESHOLDS } from "./versions.js";

export function classifyRisk(input: {
  decisionType: string;
  features: DecisionFeatures;
  inventsMissingFacts?: boolean;
}): RiskClass {
  if (input.inventsMissingFacts) return "HIGH";
  if (
    input.decisionType === "MENU_PRICE_OPTION_SEMANTICS" ||
    input.decisionType === "PRICE_OPTION_SEMANTICS" ||
    input.decisionType === "COMBO_SEMANTICS"
  ) {
    return "HIGH";
  }
  if (input.decisionType === "DESTINATION_CATEGORY") return "HIGH";
  if (
    input.features.optionalMarkers ||
    input.features.chooseMarkers ||
    input.features.orMarkers
  ) {
    return "MEDIUM";
  }
  if (input.features.slashSeparatedOptions && !input.features.orMarkers) {
    return "HIGH"; // slash alone is ambiguous
  }
  return "LOW";
}

/**
 * Multi-signal gate. Model confidence alone is never enough.
 */
export function runAutoDecisionGate(input: {
  case: DecisionCase;
  method: "PRECEDENT" | "AI";
  consensus?: PrecedentConsensus | null;
  reasoner?: ReasonerOutput | null;
  inventsMissingFacts: boolean;
  domainValidationOk: boolean;
  hasPolicyConflict: boolean;
}): AutoDecisionGateResult {
  const reasonCodes: string[] = [];
  const risk = input.case.riskClass;

  if (input.hasPolicyConflict) {
    return {
      verdict: "REVIEW",
      reasonCodes: ["POLICY_CONFLICT"],
      riskClass: risk,
    };
  }
  if (input.inventsMissingFacts) {
    return {
      verdict: "BLOCK",
      reasonCodes: ["WOULD_INVENT_MISSING_FACTS"],
      riskClass: "HIGH",
    };
  }
  if (!input.domainValidationOk) {
    return {
      verdict: "BLOCK",
      reasonCodes: ["DOMAIN_VALIDATION_FAILED"],
      riskClass: risk,
    };
  }

  if (input.method === "PRECEDENT") {
    const c = input.consensus;
    if (!c || c.conflicting) {
      return {
        verdict: "REVIEW",
        reasonCodes: ["PRECEDENT_CONFLICT_OR_MISSING"],
        riskClass: risk,
      };
    }
    if (c.count < DECISION_THRESHOLDS.minPrecedentsForAuto) {
      return {
        verdict: "REVIEW",
        reasonCodes: ["INSUFFICIENT_PRECEDENTS"],
        riskClass: risk,
      };
    }
    if (c.agreement < DECISION_THRESHOLDS.precedentAgreementRequired) {
      return {
        verdict: "REVIEW",
        reasonCodes: ["PRECEDENT_AGREEMENT_BELOW_THRESHOLD"],
        riskClass: risk,
      };
    }
    if (
      risk === "HIGH" &&
      c.restaurantCount < DECISION_THRESHOLDS.minRestaurantsForGlobalPrecedent
    ) {
      return {
        verdict: "REVIEW",
        reasonCodes: ["HIGH_RISK_NEEDS_CROSS_RESTAURANT"],
        riskClass: risk,
      };
    }
    reasonCodes.push("PRECEDENT_CONSENSUS_OK");
    return { verdict: "AUTO_APPROVE", reasonCodes, riskClass: risk };
  }

  // AI path
  const r = input.reasoner;
  if (!r || r.requiresHumanReview) {
    return {
      verdict: "REVIEW",
      reasonCodes: ["AI_REQUIRES_REVIEW"],
      riskClass: risk,
    };
  }
  if (r.modelConfidence < DECISION_THRESHOLDS.minModelConfidenceWithGates) {
    return {
      verdict: "REVIEW",
      reasonCodes: ["MODEL_CONFIDENCE_TOO_LOW"],
      riskClass: risk,
    };
  }
  if (risk === "HIGH") {
    return {
      verdict: "REVIEW",
      reasonCodes: ["HIGH_RISK_AI_NOT_AUTO"],
      riskClass: risk,
    };
  }
  if (!input.consensus || input.consensus.count < 2 || input.consensus.conflicting) {
    return {
      verdict: "REVIEW",
      reasonCodes: ["AI_NEEDS_SUPPORTING_PRECEDENTS"],
      riskClass: risk,
    };
  }
  reasonCodes.push("AI_GATE_PASSED");
  return { verdict: "AUTO_APPROVE", reasonCodes, riskClass: risk };
}
