/**
 * Test helpers for M6 decision engine scenarios.
 */
import { buildDecisionFeatures } from "../../../src/decisions/features.js";
import { classifyRisk } from "../../../src/decisions/gate.js";
import type { DecisionCase, DecisionOption } from "../../../src/decisions/types.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
} from "../../../src/decisions/versions.js";

export function makeDecisionCase(partial: {
  decisionCaseId: string;
  decisionType?: string;
  restaurantKey?: string;
  menuNumber?: string | null;
  productName?: string;
  sourceText?: string;
  sourceCategory?: string | null;
  priceOptionLabels?: string[];
  options?: DecisionOption[];
  recommendedOptionId?: string | null;
  status?: DecisionCase["status"];
  runId?: string;
}): DecisionCase {
  const restaurantKey = partial.restaurantKey ?? "demo.restaurant";
  const decisionType = partial.decisionType ?? "PRODUCT_CHOICE";
  const sourceText =
    partial.sourceText ?? "Vælg mellem kebab eller kylling";
  const productName = partial.productName ?? "Demo produkt";
  const features = buildDecisionFeatures({
    decisionType,
    sourceText,
    productName,
    sourceCategory: partial.sourceCategory ?? "Burgers",
    restaurantKey,
    menuNumber: partial.menuNumber ?? "10",
    priceOptionLabels: partial.priceOptionLabels ?? [],
  });
  const options =
    partial.options ??
    ([
      { id: "product-choice", label: "Product choice", effect: "choice" },
      { id: "ingredient", label: "Ingredient", effect: "ingredient" },
    ] as DecisionOption[]);
  const now = new Date().toISOString();
  return {
    decisionCaseId: partial.decisionCaseId,
    runId: partial.runId ?? "test-run",
    sourceId: `src_${partial.decisionCaseId}`,
    restaurantId: restaurantKey,
    restaurantKey,
    host: restaurantKey,
    menuNumber: partial.menuNumber ?? "10",
    productName,
    sourceCategory: partial.sourceCategory ?? "Burgers",
    destinationCategoryCandidate: null,
    decisionType,
    sourceText,
    normalizedSourceText: sourceText.toLowerCase(),
    contextFeatures: features,
    sourceEvidenceJson: "{}",
    currentCanonicalInterpretation: "pending",
    availableOptions: options,
    recommendedOptionId: partial.recommendedOptionId ?? "product-choice",
    recommendedRationale: "system recommendation only",
    isSystemRecommendationOnly: true,
    status: partial.status ?? "UNRESOLVED",
    riskClass: classifyRisk({ decisionType, features }),
    resolutionId: null,
    resolutionMethod: null,
    explanationJson: null,
    createdAt: now,
    updatedAt: now,
    decisionEngineVersion: DECISION_ENGINE_VERSION,
    schemaVersion: DECISION_SCHEMA_VERSION,
  };
}
