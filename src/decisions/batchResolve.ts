/**
 * Batch operator answer → facts + resolve matching open cases in current run.
 */

import { randomUUID } from "node:crypto";
import type { DecisionStore } from "./store.js";
import type { FactRegistry } from "./factStore.js";
import { buildAdditionDefinition } from "./factStore.js";
import type { AdditionSetFact, PriceFact } from "./facts.js";
import { assertGlobalPolicyHasNoFixedMoney } from "./facts.js";
import type {
  OperatorDecisionParserPort,
  ProposedOperatorDecision,
} from "./operatorParser.js";
import type { DecisionCase } from "./types.js";

export type BatchAnswerResult = {
  proposals: ProposedOperatorDecision[];
  factsCreated: string[];
  casesResolved: string[];
  questionsAvoided: number;
  ambiguities: string[];
};

export async function applyBatchOperatorAnswer(input: {
  store: DecisionStore;
  facts: FactRegistry;
  parser: OperatorDecisionParserPort;
  operatorText: string;
  restaurantKey: string;
  knownCategories: string[];
  openCases: DecisionCase[];
}): Promise<BatchAnswerResult> {
  const proposals = await input.parser.parse({
    operatorText: input.operatorText,
    restaurantKey: input.restaurantKey,
    knownCategories: input.knownCategories,
  });

  const ambiguities = proposals.flatMap((p) => p.ambiguities);
  if (ambiguities.includes("SCOPE_UNCLEAR_ASK_OPERATOR")) {
    return {
      proposals,
      factsCreated: [],
      casesResolved: [],
      questionsAvoided: 0,
      ambiguities,
    };
  }

  const factsCreated: string[] = [];
  const casesResolved: string[] = [];
  const now = new Date().toISOString();

  for (const p of proposals) {
    try {
      assertGlobalPolicyHasNoFixedMoney({
        scope: p.scope,
        knowledgeKind: p.knowledgeKind,
        resolution: JSON.stringify(p),
        amountMinor: p.priceCorrection?.amountMinor ?? null,
      });
    } catch {
      ambiguities.push("GLOBAL_FIXED_BUSINESS_FACT_NOT_ALLOWED");
      continue;
    }

    if (p.decisionType === "PRICE_CORRECTION" && p.priceCorrection) {
      const factId = `pf_corr_${p.priceCorrection.menuNumber}`;
      const fact: PriceFact = {
        factId,
        factVersion: 1,
        restaurantKey: input.restaurantKey,
        sourceId: null,
        menuNumber: p.priceCorrection.menuNumber,
        sourceCategory: null,
        destinationCategoryId: null,
        factType: "PRICE_CORRECTION",
        amountMinor: p.priceCorrection.amountMinor,
        currency: "DKK",
        appliesTo: `menu:${p.priceCorrection.menuNumber}`,
        label: null,
        evidenceJson: null,
        humanDecisionId: null,
        scope: "EXACT_PRODUCT",
        origin: "HUMAN_CORRECTION",
        knowledgeKind: "BUSINESS_FACT",
        supersedesFactId: null,
        status: "ACTIVE",
        createdAt: now,
        originalOperatorText: p.originalOperatorText,
      };
      input.facts.insertPriceFact(fact);
      factsCreated.push(factId);
      for (const c of input.openCases) {
        if (c.menuNumber === p.priceCorrection.menuNumber) {
          input.store.upsertCase({
            ...c,
            status: "HUMAN_RESOLVED",
            isSystemRecommendationOnly: false,
            resolutionId: "price-correction",
            resolutionMethod: "HUMAN",
            updatedAt: now,
          });
          casesResolved.push(c.decisionCaseId);
        }
      }
    }

    if (p.decisionType === "ADDITION_SET" && p.additions?.length) {
      const factId = `as_${randomUUID().slice(0, 8)}`;
      const set: AdditionSetFact = {
        factId,
        factVersion: 1,
        restaurantKey: input.restaurantKey,
        sourceCategory: p.sourceCategory,
        destinationCategoryId: null,
        scope: p.scope,
        additions: p.additions.map((a) =>
          buildAdditionDefinition({
            name: a.name,
            priceMinor: a.priceMinor,
            origin: "HUMAN_PROVIDED_BUSINESS_FACT",
          }),
        ),
        excludedSourceIds: [],
        excludedMenuNumbers: p.menuNumber ? [] : [],
        humanDecisionId: null,
        knowledgeKind: "BUSINESS_FACT",
        supersedesFactId: null,
        status: "ACTIVE",
        createdAt: now,
        originalOperatorText: p.originalOperatorText,
        evidenceJson: null,
      };
      // Exact product scope: encode menu in excluded inverse via evidence
      if (p.scope === "EXACT_PRODUCT" && p.menuNumber) {
        set.evidenceJson = JSON.stringify({ menuNumber: p.menuNumber });
      }
      input.facts.insertAdditionSet(set);
      factsCreated.push(factId);

      for (const c of input.openCases) {
        const matchCat =
          p.scope === "RESTAURANT_CATEGORY" &&
          p.sourceCategory &&
          (c.sourceCategory === p.sourceCategory ||
            /pizza/i.test(c.productName) ||
            /pizza/i.test(c.sourceText));
        const matchExact =
          p.scope === "EXACT_PRODUCT" && c.menuNumber === p.menuNumber;
        if (matchCat || matchExact) {
          input.store.upsertCase({
            ...c,
            status: "HUMAN_RESOLVED",
            isSystemRecommendationOnly: false,
            resolutionId: "addition-set",
            resolutionMethod: "HUMAN",
            updatedAt: now,
          });
          casesResolved.push(c.decisionCaseId);
        }
      }
    }
  }

  const uniqueResolved = [...new Set(casesResolved)];
  return {
    proposals,
    factsCreated,
    casesResolved: uniqueResolved,
    questionsAvoided: Math.max(0, uniqueResolved.length - 1),
    ambiguities,
  };
}
