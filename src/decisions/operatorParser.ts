/**
 * Operator natural-language → structured decision proposals (no direct writes).
 */

import { kronerToMinor, normalizeAdditionName } from "./facts.js";
import type { FactScope } from "./facts.js";

export type ProposedOperatorDecision = {
  decisionType: string;
  knowledgeKind: "SEMANTIC_RULE" | "BUSINESS_FACT";
  scope: FactScope;
  restaurantKey: string;
  sourceCategory: string | null;
  menuNumber: string | null;
  additions?: Array<{ name: string; priceMinor: number }>;
  priceCorrection?: {
    menuNumber: string;
    amountMinor: number;
  };
  choiceOptions?: {
    prompt: string;
    options: string[];
  };
  confidence: number;
  ambiguities: string[];
  originalOperatorText: string;
};

export interface OperatorDecisionParserPort {
  parse(input: {
    operatorText: string;
    restaurantKey: string;
    knownCategories: string[];
    knownMenuNumbers?: string[];
  }): Promise<ProposedOperatorDecision[]>;
}

/**
 * Deterministic parser for tests / offline — covers common Danish operator phrases.
 * Ambiguous scope → ambiguities[] (caller must ask).
 */
export class DeterministicOperatorParser implements OperatorDecisionParserPort {
  async parse(input: {
    operatorText: string;
    restaurantKey: string;
    knownCategories: string[];
    knownMenuNumbers?: string[];
  }): Promise<ProposedOperatorDecision[]> {
    const t = input.operatorText.trim();
    const out: ProposedOperatorDecision[] = [];

    // Price correction: "nr. 65 ... 25" / "#65 = 25"
    const corr = t.match(
      /(?:nr\.?|#)\s*(\d+[A-Za-z]?)\D{0,40}?(\d{1,4})\s*(?:kr|dkk)?/i,
    );
    if (/rett|skal være|er\s+\d+|=\s*\d+/i.test(t) && corr && /ol|øl|pris/i.test(t)) {
      out.push({
        decisionType: "PRICE_CORRECTION",
        knowledgeKind: "BUSINESS_FACT",
        scope: "EXACT_PRODUCT",
        restaurantKey: input.restaurantKey,
        sourceCategory: null,
        menuNumber: corr[1]!,
        priceCorrection: {
          menuNumber: corr[1]!,
          amountMinor: kronerToMinor(Number(corr[2])),
        },
        confidence: 0.85,
        ambiguities: [],
        originalOperatorText: t,
      });
    }

    // Category additions: "alle pizzaer ... ekstra ost +15"
    const allPizza = /alle\s+pizza/i.test(t);
    const allDurum = /alle\s+durum|alle\s+pita/i.test(t);
    const onlyNum = t.match(/kun\s+(?:nr\.?|#)?\s*(\d+)/i);

    const additionHits: Array<{ name: string; priceMinor: number }> = [];
    for (const m of t.matchAll(
      /(ekstra\s+[a-zæøå]+|[a-zæøå]+)\s*(?:\+|til\s+)?(\d{1,4})\s*(?:kr)?/gi,
    )) {
      const name = m[1]!.trim();
      if (/^(alle|kun|nr|fra|nu)$/i.test(name)) continue;
      additionHits.push({
        name: capitalize(name),
        priceMinor: kronerToMinor(Number(m[2])),
      });
    }

    if (additionHits.length) {
      let scope: FactScope = "RESTAURANT_CATEGORY";
      let category: string | null = null;
      const ambiguities: string[] = [];
      if (onlyNum) {
        scope = "EXACT_PRODUCT";
        out.push({
          decisionType: "ADDITION_SET",
          knowledgeKind: "BUSINESS_FACT",
          scope,
          restaurantKey: input.restaurantKey,
          sourceCategory: null,
          menuNumber: onlyNum[1]!,
          additions: additionHits,
          confidence: 0.8,
          ambiguities,
          originalOperatorText: t,
        });
        return out;
      }
      if (allPizza) {
        category =
          input.knownCategories.find((c) => /pizza/i.test(c)) ?? "Pizza";
      } else if (allDurum) {
        category =
          input.knownCategories.find((c) => /durum|pita/i.test(c)) ??
          "Durum & Pitabrød";
      } else {
        ambiguities.push("SCOPE_UNCLEAR_ASK_OPERATOR");
        scope = "EXACT_PRODUCT";
      }
      out.push({
        decisionType: "ADDITION_SET",
        knowledgeKind: "BUSINESS_FACT",
        scope,
        restaurantKey: input.restaurantKey,
        sourceCategory: category,
        menuNumber: null,
        additions: additionHits,
        confidence: ambiguities.length ? 0.4 : 0.85,
        ambiguities,
        originalOperatorText: t,
      });
    }

    if (!out.length) {
      out.push({
        decisionType: "SOURCE_AMBIGUITY",
        knowledgeKind: "SEMANTIC_RULE",
        scope: "EXACT_CASE",
        restaurantKey: input.restaurantKey,
        sourceCategory: null,
        menuNumber: null,
        confidence: 0,
        ambiguities: ["UNPARSED_OPERATOR_TEXT"],
        originalOperatorText: t,
      });
    }
    return out;
  }
}

function capitalize(s: string): string {
  const n = normalizeAdditionName(s);
  return n.replace(/\b\w/g, (c) => c.toUpperCase());
}
