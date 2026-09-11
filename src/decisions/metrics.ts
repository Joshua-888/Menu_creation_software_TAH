import type { DecisionCase, DecisionMetrics, DecisionOutcome } from "./types.js";

export function computeDecisionMetrics(
  cases: DecisionCase[],
  _outcomes: DecisionOutcome[],
): DecisionMetrics {
  const byStatus = (s: string) => cases.filter((c) => c.status === s).length;
  const decisionCases = cases.length || 1;
  const humanReviewRequired =
    byStatus("HUMAN_REVIEW_REQUIRED") +
    byStatus("UNRESOLVED") +
    byStatus("POLICY_CONFLICT");
  const humanResolved = byStatus("HUMAN_RESOLVED");
  const resolvedDeterministically = byStatus("AUTO_RESOLVED_DETERMINISTIC");
  const resolvedByActivePolicy = byStatus("AUTO_RESOLVED_POLICY");
  const resolvedByPrecedent = byStatus("AUTO_RESOLVED_PRECEDENT");
  const resolvedByAiGate = byStatus("AUTO_RESOLVED_AI");
  const policyConflicts = byStatus("POLICY_CONFLICT");
  const blocked = byStatus("BLOCKED");
  const auto =
    resolvedDeterministically +
    resolvedByActivePolicy +
    resolvedByPrecedent +
    resolvedByAiGate;

  return {
    decisionCases: cases.length,
    resolvedDeterministically,
    resolvedByActivePolicy,
    resolvedByPrecedent,
    resolvedByAiGate,
    humanReviewRequired,
    humanResolved,
    policyConflicts,
    blocked,
    humanInterventionRate: humanReviewRequired / decisionCases,
    autoResolutionRate: auto / decisionCases,
    policyHitRate: resolvedByActivePolicy / decisionCases,
    precedentHitRate: resolvedByPrecedent / decisionCases,
    aiResolutionRate: resolvedByAiGate / decisionCases,
    humanOverrideRate: 0,
    policyConflictRate: policyConflicts / decisionCases,
  };
}
