import { randomUUID } from "node:crypto";
import { matchPolicy } from "./conditions.js";
import { tryDeterministicResolve } from "./deterministic.js";
import { classifyRisk, runAutoDecisionGate } from "./gate.js";
import {
  evaluatePrecedentConsensus,
  retrievePrecedents,
  type DecisionReasonerPort,
  FakeDecisionReasoner,
} from "./precedents.js";
import type { DecisionStore } from "./store.js";
import type {
  DecisionCase,
  DecisionOutcome,
  DecisionPolicy,
  HumanDecision,
  HumanReviewAnswer,
  PolicyMatch,
} from "./types.js";
import {
  generatePolicyCandidate,
  handleHumanCorrection,
  mergeSupportIntoMatchingShadow,
  promoteCandidateToShadow,
  tryPromoteShadowToActive,
} from "./learning.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
  POLICY_REGISTRY_VERSION,
} from "./versions.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class DecisionPolicyRegistry {
  constructor(private readonly store: DecisionStore) {}

  registerCase(c: DecisionCase): void {
    this.store.assertIntegrity();
    this.store.upsertCase(c);
  }

  findApplicablePolicies(features: DecisionCase["contextFeatures"]): {
    matches: PolicyMatch[];
    conflict: boolean;
    winner: PolicyMatch | null;
  } {
    this.store.assertIntegrity();
    const active = this.store.listPolicies("ACTIVE");
    const matches = active
      .map((p) => matchPolicy(features, p))
      .filter((m) => m.matched);
    if (!matches.length) {
      return { matches: [], conflict: false, winner: null };
    }
    const maxSpec = Math.max(...matches.map((m) => m.specificity));
    const top = matches.filter((m) => m.specificity === maxSpec);
    const resolutions = new Set(
      top.map((m) => `${m.resolution}::${m.resolutionOptionId}`),
    );
    if (resolutions.size > 1) {
      return { matches: top, conflict: true, winner: null };
    }
    return { matches: top, conflict: false, winner: top[0]! };
  }

  recordHumanDecision(
    decisionCase: DecisionCase,
    answer: HumanReviewAnswer,
    opts?: {
      correctionOfAuto?: {
        method: string;
        policyId: string | null;
        policyVersion: number | null;
      };
    },
  ): { human: HumanDecision; candidate: ReturnType<typeof generatePolicyCandidate> } {
    this.store.assertIntegrity();
    let human: HumanDecision;
    if (opts?.correctionOfAuto) {
      human = handleHumanCorrection({
        store: this.store,
        case: decisionCase,
        previousAutoMethod: opts.correctionOfAuto.method,
        previousPolicyId: opts.correctionOfAuto.policyId,
        previousPolicyVersion: opts.correctionOfAuto.policyVersion,
        answer,
      });
    } else {
      human = {
        humanDecisionId: `hd_${randomUUID()}`,
        decisionCaseId: decisionCase.decisionCaseId,
        selectedResolution: answer.resolution,
        selectedOptionId: answer.selectedOptionId,
        operatorId: answer.operatorId ?? null,
        decisionType: decisionCase.decisionType,
        scopeRequested: answer.scopePreference,
        scopeApproved:
          answer.scopePreference === "APPLY_THIS_CASE_ONLY"
            ? "EXACT_CASE"
            : answer.scopePreference === "APPLY_TO_THIS_RESTAURANT"
              ? "RESTAURANT"
              : answer.scopePreference === "APPLY_TO_THIS_RESTAURANT_CATEGORY"
                ? "RESTAURANT_CATEGORY"
                : "GLOBAL",
        comment: answer.comment ?? null,
        sourceEvidenceSnapshot: decisionCase.sourceEvidenceJson,
        decisionFeaturesSnapshot: JSON.stringify(decisionCase.contextFeatures),
        canonicalBeforeJson: null,
        canonicalAfterJson: null,
        createdAt: nowIso(),
        engineVersion: DECISION_ENGINE_VERSION,
        schemaVersion: DECISION_SCHEMA_VERSION,
        supersedesHumanDecisionId: null,
      };
      this.store.insertHumanDecision(human);
    }

    const updated: DecisionCase = {
      ...decisionCase,
      status: "HUMAN_RESOLVED",
      isSystemRecommendationOnly: false,
      resolutionId: human.selectedOptionId,
      resolutionMethod: "HUMAN",
      updatedAt: nowIso(),
    };
    this.store.upsertCase(updated);

    const candidate = generatePolicyCandidate({
      decisionCase: updated,
      human,
    });
    this.store.saveCandidate(candidate);

    // Narrow scopes: SHADOW immediately; ACTIVE only after support threshold
    if (
      candidate.proposedScope === "EXACT_CASE" ||
      candidate.proposedScope === "RESTAURANT" ||
      candidate.proposedScope === "RESTAURANT_CATEGORY"
    ) {
      try {
        const merged = mergeSupportIntoMatchingShadow(this.store, candidate);
        const shadow =
          merged ?? promoteCandidateToShadow(this.store, candidate);
        tryPromoteShadowToActive(this.store, shadow);
      } catch {
        /* invents-facts or other skip */
      }
    } else if (candidate.proposedScope === "GLOBAL") {
      // GLOBAL: candidate only — no auto ACTIVE (globalAutoPromoteEnabled=false)
      try {
        promoteCandidateToShadow(this.store, candidate);
      } catch {
        /* invents-facts */
      }
    }

    return { human, candidate };
  }

  getDecisionHistory(decisionCaseId: string): HumanDecision[] {
    return this.store
      .listHumanDecisions()
      .filter((h) => h.decisionCaseId === decisionCaseId);
  }
}

export class DecisionEngine {
  constructor(
    private readonly store: DecisionStore,
    private readonly registry: DecisionPolicyRegistry,
    private readonly reasoner: DecisionReasonerPort = new FakeDecisionReasoner(),
  ) {}

  async resolve(decisionCase: DecisionCase): Promise<DecisionOutcome> {
    this.store.assertIntegrity();
    const features = decisionCase.contextFeatures;

    // 1–2 already-deterministically resolved statuses short-circuit
    if (
      decisionCase.status === "HUMAN_RESOLVED" ||
      decisionCase.status.startsWith("AUTO_RESOLVED_")
    ) {
      return {
        decisionCaseId: decisionCase.decisionCaseId,
        status: decisionCase.status,
        resolution: decisionCase.resolutionId,
        optionId: decisionCase.resolutionId,
        method: "NONE",
        policyId: null,
        policyVersion: null,
        precedentIds: [],
        explanation: "already resolved",
        gate: null,
        reasoner: null,
        policyMatches: [],
      };
    }

    // 2b — deterministic strong source evidence (before policies)
    const det = tryDeterministicResolve(decisionCase);
    if (det) {
      return this.finish(decisionCase, {
        status: det.status,
        resolution: det.resolution,
        optionId: det.optionId,
        method: det.method,
        policyId: null,
        policyVersion: null,
        precedentIds: [],
        explanation: det.explanation,
        gate: det.gate,
        reasoner: null,
        policyMatches: [],
      });
    }

    // 3–5 ACTIVE policies
    const { matches, conflict, winner } =
      this.registry.findApplicablePolicies(features);
    if (conflict) {
      return this.finish(decisionCase, {
        status: "POLICY_CONFLICT",
        resolution: null,
        optionId: null,
        method: "NONE",
        policyId: null,
        policyVersion: null,
        precedentIds: [],
        explanation: `POLICY_CONFLICT: ${matches.map((m) => `${m.policyId}@${m.policyVersion}=${m.resolutionOptionId}`).join("; ")}`,
        gate: {
          verdict: "REVIEW",
          reasonCodes: ["POLICY_CONFLICT"],
          riskClass: decisionCase.riskClass,
        },
        reasoner: null,
        policyMatches: matches,
      });
    }
    if (winner) {
      const pol = this.store.getPolicy(winner.policyId, winner.policyVersion);
      if (pol && !pol.inventsMissingFacts) {
        return this.finish(decisionCase, {
          status: "AUTO_RESOLVED_POLICY",
          resolution: winner.resolution,
          optionId: winner.resolutionOptionId,
          method: "ACTIVE_POLICY",
          policyId: winner.policyId,
          policyVersion: winner.policyVersion,
          precedentIds: [],
          explanation: explainPolicy(winner, pol),
          gate: null,
          reasoner: null,
          policyMatches: matches,
        });
      }
    }

    // 6–7 precedents
    const hits = retrievePrecedents(this.store, features);
    const consensus = evaluatePrecedentConsensus(hits);
    const precGate = runAutoDecisionGate({
      case: decisionCase,
      method: "PRECEDENT",
      consensus,
      inventsMissingFacts: false,
      domainValidationOk: true,
      hasPolicyConflict: false,
    });
    if (
      precGate.verdict === "AUTO_APPROVE" &&
      consensus.dominantResolution &&
      consensus.dominantOptionId
    ) {
      return this.finish(decisionCase, {
        status: "AUTO_RESOLVED_PRECEDENT",
        resolution: consensus.dominantResolution,
        optionId: consensus.dominantOptionId,
        method: "PRECEDENT",
        policyId: null,
        policyVersion: null,
        precedentIds: hits.map((h) => h.humanDecisionId),
        explanation: `PRECEDENT consensus ${consensus.agreement} over ${consensus.count} cases (${consensus.restaurantCount} restaurants)`,
        gate: precGate,
        reasoner: null,
        policyMatches: matches,
      });
    }

    // 8–10 AI
    const reasonerOut = await this.reasoner.reason({
      decisionCase,
      features,
      policies: this.store.listPolicies("ACTIVE"),
      precedents: hits,
      consensus,
    });
    // Clamp to available options
    const allowed = new Set(decisionCase.availableOptions.map((o) => o.id));
    if (!allowed.has(reasonerOut.proposedOptionId)) {
      reasonerOut.requiresHumanReview = true;
      reasonerOut.uncertainties.push("OPTION_OUTSIDE_SCHEMA");
    }
    const aiGate = runAutoDecisionGate({
      case: decisionCase,
      method: "AI",
      consensus,
      reasoner: reasonerOut,
      inventsMissingFacts: false,
      domainValidationOk: true,
      hasPolicyConflict: false,
    });
    if (aiGate.verdict === "AUTO_APPROVE") {
      return this.finish(decisionCase, {
        status: "AUTO_RESOLVED_AI",
        resolution: reasonerOut.proposedResolution,
        optionId: reasonerOut.proposedOptionId,
        method: "AI_GATE",
        policyId: null,
        policyVersion: null,
        precedentIds: reasonerOut.precedentIds,
        explanation: `AI_GATE ${reasonerOut.reasonCode} conf=${reasonerOut.modelConfidence}`,
        gate: aiGate,
        reasoner: reasonerOut,
        policyMatches: matches,
      });
    }

    // 11 human review
    return this.finish(decisionCase, {
      status: "HUMAN_REVIEW_REQUIRED",
      resolution: null,
      optionId: null,
      method: "NONE",
      policyId: null,
      policyVersion: null,
      precedentIds: hits.map((h) => h.humanDecisionId),
      explanation: `HUMAN_REVIEW_REQUIRED: ${aiGate.reasonCodes.join(",")}; recommended=${decisionCase.recommendedOptionId ?? "none"} (NOT an approval)`,
      gate: aiGate,
      reasoner: reasonerOut,
      policyMatches: matches,
    });
  }

  private finish(
    decisionCase: DecisionCase,
    partial: Omit<DecisionOutcome, "decisionCaseId">,
  ): DecisionOutcome {
    const outcome: DecisionOutcome = {
      decisionCaseId: decisionCase.decisionCaseId,
      ...partial,
    };
    const updated: DecisionCase = {
      ...decisionCase,
      status: outcome.status,
      resolutionId: outcome.optionId,
      resolutionMethod: outcome.method,
      explanationJson: JSON.stringify({
        explanation: outcome.explanation,
        gate: outcome.gate,
        policyMatches: outcome.policyMatches,
      }),
      // Keep isSystemRecommendationOnly true until HUMAN_RESOLVED
      isSystemRecommendationOnly:
        outcome.status === "HUMAN_RESOLVED"
          ? false
          : decisionCase.isSystemRecommendationOnly,
      riskClass: classifyRisk({
        decisionType: decisionCase.decisionType,
        features: decisionCase.contextFeatures,
      }),
      updatedAt: nowIso(),
    };
    this.store.upsertCase(updated);
    this.store.insertOutcome({
      outcomeId: `out_${randomUUID()}`,
      decisionCaseId: decisionCase.decisionCaseId,
      status: outcome.status,
      resolution: outcome.resolution,
      optionId: outcome.optionId,
      method: outcome.method,
      policyId: outcome.policyId,
      policyVersion: outcome.policyVersion,
      precedentIds: outcome.precedentIds,
      explanation: outcome.explanation,
      gateJson: outcome.gate ? JSON.stringify(outcome.gate) : null,
      reasonerJson: outcome.reasoner
        ? JSON.stringify(outcome.reasoner)
        : null,
      engineVersion: DECISION_ENGINE_VERSION,
      policyRegistryVersion: POLICY_REGISTRY_VERSION,
    });
    return outcome;
  }
}

function explainPolicy(m: PolicyMatch, p: DecisionPolicy): string {
  return [
    `Resolved: ${m.resolution}`,
    `Method: ACTIVE_POLICY`,
    `Policy: ${p.policyId}@v${p.policyVersion}`,
    `Matched because:`,
    ...m.matchedConditions.map(
      (c) => `- ${c.field} ${c.op} ${JSON.stringify(c.value)}`,
    ),
    `Specificity: ${m.specificity}`,
    `Support decisions: ${p.createdFromDecisionIds.length}`,
  ].join("\n");
}
