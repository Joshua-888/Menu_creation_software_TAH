import type {
  DecisionCase,
  DecisionFeatures,
  DecisionPolicy,
  PrecedentConsensus,
  PrecedentHit,
  ReasonerOutput,
} from "./types.js";
import { featureSimilarity } from "./features.js";
import type { DecisionStore } from "./store.js";

export interface DecisionReasonerPort {
  reason(input: {
    decisionCase: DecisionCase;
    features: DecisionFeatures;
    policies: DecisionPolicy[];
    precedents: PrecedentHit[];
    consensus: PrecedentConsensus | null;
  }): Promise<ReasonerOutput>;
}

/** Deterministic fake adapter for tests — never treats recommendations as approvals. */
export class FakeDecisionReasoner implements DecisionReasonerPort {
  constructor(
    private readonly impl?: (
      input: Parameters<DecisionReasonerPort["reason"]>[0],
    ) => ReasonerOutput,
  ) {}

  async reason(
    input: Parameters<DecisionReasonerPort["reason"]>[0],
  ): Promise<ReasonerOutput> {
    if (this.impl) return this.impl(input);
    // Default: always defer to human — safe
    return {
      proposedResolution: "DEFER",
      proposedOptionId:
        input.decisionCase.availableOptions[0]?.id ?? "review",
      reasonCode: "FAKE_REASONER_DEFER",
      evidenceUsed: [],
      precedentIds: input.precedents.map((p) => p.humanDecisionId),
      uncertainties: ["no_live_model"],
      modelConfidence: 0,
      requiresHumanReview: true,
      providerVersion: "fake-reasoner@1",
    };
  }
}

/**
 * Structured-first precedent retrieval. Only HUMAN_RESOLVED cases.
 * Embeddings are NOT required; feature filtering is primary.
 */
export function retrievePrecedents(
  store: DecisionStore,
  features: DecisionFeatures,
  topN = 10,
): PrecedentHit[] {
  const humans = store.listHumanDecisions({
    decisionType: String(features.decisionType),
  });
  const hits: PrecedentHit[] = [];
  for (const h of humans) {
    // Ignore superseded? Keep all historical — consensus weighs them
    const c = store.getCase(h.decisionCaseId);
    if (!c || c.status !== "HUMAN_RESOLVED") continue;
    // CRITICAL: never use system recommendations as precedents
    if (c.isSystemRecommendationOnly && c.status !== "HUMAN_RESOLVED") {
      continue;
    }
    const feats = JSON.parse(h.decisionFeaturesSnapshot) as DecisionFeatures;
    const { score, breakdown } = featureSimilarity(features, feats);
    if (score < 3) continue;
    hits.push({
      humanDecisionId: h.humanDecisionId,
      decisionCaseId: h.decisionCaseId,
      decisionType: h.decisionType,
      resolution: h.selectedResolution,
      resolutionOptionId: h.selectedOptionId,
      restaurantKey: c.restaurantKey,
      score,
      breakdown,
      features: feats,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topN);
}

export function evaluatePrecedentConsensus(
  hits: PrecedentHit[],
): PrecedentConsensus {
  if (!hits.length) {
    return {
      agreement: 0,
      dominantResolution: null,
      dominantOptionId: null,
      count: 0,
      restaurantCount: 0,
      conflicting: false,
      hits: [],
    };
  }
  const byRes = new Map<string, number>();
  const restaurants = new Set<string>();
  for (const h of hits) {
    const key = `${h.resolution}::${h.resolutionOptionId}`;
    byRes.set(key, (byRes.get(key) ?? 0) + 1);
    restaurants.add(h.restaurantKey);
  }
  const ranked = [...byRes.entries()].sort((a, b) => b[1] - a[1]);
  const [topKey, topCount] = ranked[0]!;
  const conflicting = ranked.length > 1;
  const [resolution, optionId] = topKey.split("::");
  return {
    agreement: topCount / hits.length,
    dominantResolution: resolution ?? null,
    dominantOptionId: optionId ?? null,
    count: hits.length,
    restaurantCount: restaurants.size,
    conflicting,
    hits,
  };
}
