import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { FinalHumanDecision } from "../review/finalReview.js";
import { buildDecisionFeatures } from "./features.js";
import { classifyRisk } from "./gate.js";
import type { DecisionCase, DecisionOption } from "./types.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
} from "./versions.js";

/**
 * Load Veroni human-review-final decisions as UNRESOLVED DecisionCases.
 * recommendedOptionId is a SYSTEM recommendation — NOT a human approval.
 */
export function loadVeroniUnresolvedDecisionCases(input: {
  reviewPath?: string;
  runId?: string;
  restaurantKey?: string;
  host?: string;
}): DecisionCase[] {
  const path =
    input.reviewPath ?? "fixtures/veroni/m6-human-review-final.json";
  if (!existsSync(path)) {
    throw new Error(`Veroni review fixture missing: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    decisions: FinalHumanDecision[];
  };
  const runId = input.runId ?? `m6-veroni-fixture`;
  const restaurantKey = input.restaurantKey ?? "veronipizza.dk";
  const host = input.host ?? "veronipizza.dk";
  const now = new Date().toISOString();

  return raw.decisions.map((d) => {
    const primary = d.affectedProducts[0];
    const sourceText = d.sourceText;
    const features = buildDecisionFeatures({
      decisionType: d.type,
      sourceText,
      productName: primary?.name ?? d.title,
      sourceCategory: null,
      restaurantKey,
      menuNumber: primary?.menuNumber ?? null,
      priceOptionLabels: d.type.includes("MENU")
        ? ["BASE", "Menu"]
        : [],
    });
    const options: DecisionOption[] = d.options.map((o) => ({
      id: o.id,
      label: o.label,
      effect: o.effect,
    }));
    return {
      decisionCaseId: `dc_${d.id}_${randomUUID().slice(0, 8)}`,
      runId,
      sourceId: `veroni:${d.id}`,
      restaurantId: restaurantKey,
      restaurantKey,
      host,
      menuNumber: primary?.menuNumber ?? null,
      productName:
        d.affectedProducts.map((p) => p.name).join("; ") || d.title,
      sourceCategory: null,
      destinationCategoryCandidate: null,
      decisionType: d.type,
      sourceText,
      normalizedSourceText: sourceText.toLowerCase(),
      contextFeatures: features,
      sourceEvidenceJson: JSON.stringify({ reviewDecisionId: d.id }),
      currentCanonicalInterpretation: d.currentInterpretation,
      availableOptions: options,
      recommendedOptionId: d.recommendedOptionId,
      recommendedRationale: d.recommendedRationale,
      isSystemRecommendationOnly: true,
      status: "UNRESOLVED" as const,
      riskClass: classifyRisk({
        decisionType: d.type,
        features,
      }),
      resolutionId: null,
      resolutionMethod: null,
      explanationJson: null,
      createdAt: now,
      updatedAt: now,
      decisionEngineVersion: DECISION_ENGINE_VERSION,
      schemaVersion: DECISION_SCHEMA_VERSION,
    };
  });
}

/** Guard: recommendations must never be persisted as HumanDecision. */
export function assertRecommendationsAreNotApprovals(
  cases: DecisionCase[],
): void {
  for (const c of cases) {
    if (!c.isSystemRecommendationOnly) {
      throw new Error(
        `Fixture case ${c.decisionCaseId} must be system-recommendation-only until human approves`,
      );
    }
    if (c.status === "HUMAN_RESOLVED") {
      throw new Error(
        `Fixture case ${c.decisionCaseId} must not be HUMAN_RESOLVED without operator capture`,
      );
    }
  }
}
