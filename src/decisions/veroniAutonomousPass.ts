/**
 * M6.4 application helpers — apply existing DecisionEngine to Veroni cases.
 * Not a new learning architecture.
 */

import { buildDecisionFeatures } from "./features.js";
import { classifyRisk } from "./gate.js";
import {
  VERONI_VAELG_SELV_OPTIONS,
  classifyChoiceLanguageStrength,
  extractEnumeratedOptions,
} from "./choiceLanguage.js";
import type { DecisionStore } from "./store.js";
import type {
  DecisionCase,
  DecisionOutcome,
  DecisionPolicy,
  HumanDecision,
} from "./types.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
} from "./versions.js";
import type { FinalHumanDecision } from "../review/finalReview.js";
import type { CanonicalMenu, CanonicalProduct } from "../domain/schema/canonical.js";
import type { ChoiceOptionsFact } from "./facts.js";

export const VERONI_HOST = "veronipizza.dk";
export const VERONI_PITA_DURUM_CATEGORY = "Durum & Pitabrød";
/** Stable id — do not mint duplicates across M6.2 / M6.3 / M6.4. */
export const VERONI_VAELG_SELV_HUMAN_DECISION_ID =
  "hd_veroni_pita_durum_vaelg_selv";
export const VERONI_VAELG_SELV_POLICY_ID =
  "pol_veroni_pita_durum_valgfrit_vaelg_selv";
export const VERONI_VAELG_SELV_FACT_ID = "cof_veroni_pita_durum_vaelg_selv";

const CHOICE_OPTIONS = [
  {
    id: "product-choice",
    label: "Model as ProductChoice (customer selects one)",
    effect: "Creates choice options on the product; guest must pick.",
  },
  {
    id: "ingredient",
    label: "Treat as fixed ingredients (no choice UI)",
    effect: "Imports text as ingredients only; no modifier.",
  },
  {
    id: "variant",
    label: "Model as variants (separate sellable sizes/options)",
    effect: "Each option becomes a variant with its own price if priced.",
  },
] as const;

export function nowIso(): string {
  return new Date().toISOString();
}

export function caseFromFinal(
  d: FinalHumanDecision,
  opts: {
    runId: string;
    menuNumbers?: string[];
    sourceTextOverride?: string;
    sourceCategory?: string | null;
    decisionCaseId?: string;
  },
): DecisionCase {
  const affected = opts.menuNumbers
    ? d.affectedProducts.filter((p) => opts.menuNumbers!.includes(p.menuNumber))
    : d.affectedProducts;
  const primary = affected[0] ?? d.affectedProducts[0]!;
  const sourceText = opts.sourceTextOverride ?? d.sourceText;
  const restaurantKey = VERONI_HOST;
  const sourceCategory =
    opts.sourceCategory ??
    (/dürüm|durum|pita/i.test(primary.name)
      ? VERONI_PITA_DURUM_CATEGORY
      : /pasta/i.test(d.id) || /pasta/i.test(sourceText)
        ? "Pasta"
        : null);
  const features = buildDecisionFeatures({
    decisionType: d.type,
    sourceText,
    productName: primary.name,
    sourceCategory,
    restaurantKey,
    menuNumber: primary.menuNumber,
    priceOptionLabels:
      d.type === "MENU_PRICE_OPTION_SEMANTICS" ? ["BASE", "Menu"] : [],
  });
  const t = nowIso();
  return {
    decisionCaseId:
      opts.decisionCaseId ??
      `dc_${d.id}_${primary.menuNumber}_${Math.random().toString(16).slice(2, 8)}`,
    runId: opts.runId,
    sourceId: `veroni:${d.id}:${primary.menuNumber}`,
    restaurantId: restaurantKey,
    restaurantKey,
    host: VERONI_HOST,
    menuNumber: primary.menuNumber,
    productName: affected.map((p) => p.name).join("; ") || d.title,
    sourceCategory,
    destinationCategoryCandidate: null,
    decisionType: d.type,
    sourceText,
    normalizedSourceText: sourceText.toLowerCase(),
    contextFeatures: features,
    sourceEvidenceJson: JSON.stringify({
      reviewDecisionId: d.id,
      affected: affected.map((a) => a.menuNumber),
    }),
    currentCanonicalInterpretation: d.currentInterpretation,
    availableOptions: d.options.map((o) => ({
      id: o.id,
      label: o.label,
      effect: o.effect,
    })),
    recommendedOptionId: d.recommendedOptionId,
    recommendedRationale: d.recommendedRationale,
    isSystemRecommendationOnly: true,
    status: "UNRESOLVED",
    riskClass: classifyRisk({ decisionType: d.type, features }),
    resolutionId: null,
    resolutionMethod: null,
    explanationJson: null,
    createdAt: t,
    updatedAt: t,
    decisionEngineVersion: DECISION_ENGINE_VERSION,
    schemaVersion: DECISION_SCHEMA_VERSION,
  };
}

export function buildProduct61Case(runId: string): DecisionCase {
  const sourceText =
    "#61 Kottu rotti\nIndisk brodmix, kylling/okse/grøntsager/rejer\nblandet m. grøntsager og æg";
  const features = buildDecisionFeatures({
    decisionType: "PRODUCT_CHOICE",
    sourceText,
    productName: "Kottu rotti",
    sourceCategory: "INDISK / Hovedretter",
    restaurantKey: VERONI_HOST,
    menuNumber: "61",
  });
  const t = nowIso();
  return {
    decisionCaseId: `dc_D-CHOICE-61_61_${Math.random().toString(16).slice(2, 8)}`,
    runId,
    sourceId: "veroni:D-CHOICE-61:61",
    restaurantId: VERONI_HOST,
    restaurantKey: VERONI_HOST,
    host: VERONI_HOST,
    menuNumber: "61",
    productName: "Kottu rotti",
    sourceCategory: "INDISK / Hovedretter",
    destinationCategoryCandidate: null,
    decisionType: "PRODUCT_CHOICE",
    sourceText,
    normalizedSourceText: sourceText.toLowerCase(),
    contextFeatures: features,
    sourceEvidenceJson: JSON.stringify({
      reviewDecisionId: "D-CHOICE-61",
      affected: ["61"],
      pageEvidence: "kylling/okse/grøntsager/rejer",
      note: "Omitted from older 9-item review pack; audited in M6.4",
    }),
    currentCanonicalInterpretation:
      "Source enumerates kylling/okse/grøntsager/rejer; CanonicalMenu currently has empty productChoices (ingredients also missing from OCR row).",
    availableOptions: [...CHOICE_OPTIONS],
    recommendedOptionId: "product-choice",
    recommendedRationale:
      "Four-way protein/veg slash list most often means guest chooses one — still requires confirmation (slash-only).",
    isSystemRecommendationOnly: true,
    status: "UNRESOLVED",
    riskClass: classifyRisk({ decisionType: "PRODUCT_CHOICE", features }),
    resolutionId: null,
    resolutionMethod: null,
    explanationJson: null,
    createdAt: t,
    updatedAt: t,
    decisionEngineVersion: DECISION_ENGINE_VERSION,
    schemaVersion: DECISION_SCHEMA_VERSION,
  };
}

/** Consolidate overlapping #60 cases; split #59/#60; add #61 audit case. */
export function buildConsolidatedVeroniCases(
  raw: FinalHumanDecision[],
  runId: string,
): { cases: DecisionCase[]; consolidated: string[]; initialReviewCases: number } {
  const consolidated: string[] = [];
  const cases: DecisionCase[] = [];
  const initialReviewCases = raw.length;

  for (const d of raw) {
    if (d.id === "D-CHOICE-5") {
      consolidated.push("D-CHOICE-5→merged-into-#60-single-case");
      continue;
    }
    if (d.id === "D-CHOICE-4") {
      const d59 = d.affectedProducts.find((p) => p.menuNumber === "59");
      const d60 = d.affectedProducts.find((p) => p.menuNumber === "60");
      if (d59) {
        cases.push(
          caseFromFinal(d, {
            runId,
            menuNumbers: ["59"],
            sourceTextOverride:
              "#59 Fried rice\nkylling eller oksekød\nStegt ris, kylling eller oksekød med tilbehør",
          }),
        );
      }
      if (d60) {
        cases.push(
          caseFromFinal(
            {
              ...d,
              id: "D-CHOICE-60",
              title: "Does “kylling/okse/vegetar” represent a customer choice?",
              affectedProducts: [d60],
              sourceText:
                "#60 Fried noodles\nStegte nudler, kylling/okse/vegetar og tilbehør",
            },
            { runId, menuNumbers: ["60"] },
          ),
        );
        consolidated.push("D-CHOICE-4+#60 + D-CHOICE-5 → one #60 slash case");
      }
      continue;
    }
    if (d.id === "D-CHOICE-6") {
      cases.push(
        caseFromFinal(d, {
          runId,
          sourceCategory: VERONI_PITA_DURUM_CATEGORY,
          // Keep valgfrit wording only — do NOT inject slash that invents fake options
          sourceTextOverride:
            "#36 Dürüm rulle\nValgfrit kød, salat og dressing\n---\n#37 Hjemmelavet pitabrød\nValgfrit kød, salat og dressing",
        }),
      );
      continue;
    }
    if (d.id === "D-MENU-OPTION") {
      // Keep ONE shared case for all BASE+Menu products
      cases.push(caseFromFinal(d, { runId }));
      consolidated.push("D-MENU-OPTION → one shared BASE+Menu semantic case");
      continue;
    }
    if (d.id === "D-CAT-PASTA") {
      cases.push(
        caseFromFinal(d, {
          runId,
          sourceCategory: "Pasta",
          sourceTextOverride:
            "Source heading: Pasta\nProducts: 33 Spaghetti Bolognese, 34 Pasta Alfredo med Kylling, 35 Pasta Ai Gamberi",
        }),
      );
      continue;
    }
    cases.push(caseFromFinal(d, { runId }));
  }

  cases.push(buildProduct61Case(runId));
  consolidated.push("D-CHOICE-61 added — semantic audit for #61 Kottu rotti");

  return { cases, consolidated, initialReviewCases };
}

/**
 * Seed authoritative Veroni Pita/Durum Vælg selv fact + ACTIVE policy.
 * Does NOT create a duplicate HumanDecision if the stable id already exists.
 */
export function seedAuthoritativeVeroniVaelgSelv(
  store: DecisionStore,
): {
  policy: DecisionPolicy;
  humanDecisionId: string;
  createdHumanDecision: boolean;
  fact: ChoiceOptionsFact;
} {
  const existing = store
    .listHumanDecisions()
    .find((h) => h.humanDecisionId === VERONI_VAELG_SELV_HUMAN_DECISION_ID);
  const t = nowIso();
  let createdHumanDecision = false;
  const priorCaseId = "dc_prior_veroni_valgfrit";

  if (!existing) {
    // FK: human_decisions.decisionCaseId → decision_cases
    if (!store.getCase(priorCaseId)) {
      const feats = buildDecisionFeatures({
        decisionType: "PRODUCT_CHOICE",
        sourceText: "Valgfrit kød",
        productName: "Dürüm rulle",
        sourceCategory: VERONI_PITA_DURUM_CATEGORY,
        restaurantKey: VERONI_HOST,
        menuNumber: "36",
      });
      store.upsertCase({
        decisionCaseId: priorCaseId,
        runId: "m62-veroni-prior",
        sourceId: "veroni:D-CHOICE-6:prior",
        restaurantId: VERONI_HOST,
        restaurantKey: VERONI_HOST,
        host: VERONI_HOST,
        menuNumber: "36",
        productName: "Dürüm rulle; Hjemmelavet pitabrød",
        sourceCategory: VERONI_PITA_DURUM_CATEGORY,
        destinationCategoryCandidate: null,
        decisionType: "PRODUCT_CHOICE",
        sourceText: "Valgfrit kød / Vælg selv",
        normalizedSourceText: "valgfrit kod / vaelg selv",
        contextFeatures: feats,
        sourceEvidenceJson: JSON.stringify({ affected: ["36", "37"] }),
        currentCanonicalInterpretation: "Prior authoritative operator decision",
        availableOptions: [...CHOICE_OPTIONS],
        recommendedOptionId: "product-choice",
        recommendedRationale: null,
        isSystemRecommendationOnly: false,
        status: "HUMAN_RESOLVED",
        riskClass: classifyRisk({
          decisionType: "PRODUCT_CHOICE",
          features: feats,
        }),
        resolutionId: "product-choice",
        resolutionMethod: "HUMAN",
        explanationJson: JSON.stringify({
          humanDecisionId: VERONI_VAELG_SELV_HUMAN_DECISION_ID,
        }),
        createdAt: t,
        updatedAt: t,
        decisionEngineVersion: DECISION_ENGINE_VERSION,
        schemaVersion: DECISION_SCHEMA_VERSION,
      });
    }
    const human: HumanDecision = {
      humanDecisionId: VERONI_VAELG_SELV_HUMAN_DECISION_ID,
      decisionCaseId: priorCaseId,
      selectedResolution: JSON.stringify({
        kind: "PRODUCT_CHOICE",
        choiceGroup: "Vælg selv",
        options: [...VERONI_VAELG_SELV_OPTIONS],
      }),
      selectedOptionId: "product-choice",
      operatorId: "operator",
      decisionType: "PRODUCT_CHOICE",
      scopeRequested: "APPLY_TO_THIS_RESTAURANT_CATEGORY",
      scopeApproved: "RESTAURANT_CATEGORY",
      comment:
        "OPERATOR (prior M6.2): Veroni Pita/Durum Vælg selv = Kebab, Kylling, Skinke, Falafel, Mix",
      sourceEvidenceSnapshot: JSON.stringify({
        products: ["36", "37"],
        category: VERONI_PITA_DURUM_CATEGORY,
      }),
      decisionFeaturesSnapshot: JSON.stringify(
        buildDecisionFeatures({
          decisionType: "PRODUCT_CHOICE",
          sourceText: "Valgfrit kød",
          productName: "Dürüm rulle",
          sourceCategory: VERONI_PITA_DURUM_CATEGORY,
          restaurantKey: VERONI_HOST,
          menuNumber: "36",
        }),
      ),
      canonicalBeforeJson: null,
      canonicalAfterJson: null,
      createdAt: t,
      engineVersion: DECISION_ENGINE_VERSION,
      schemaVersion: DECISION_SCHEMA_VERSION,
      supersedesHumanDecisionId: null,
    };
    store.insertHumanDecision(human);
    createdHumanDecision = true;
  }

  const priorPolicies = store
    .listPolicies()
    .filter((p) => p.policyId === VERONI_VAELG_SELV_POLICY_ID);
  let policy = priorPolicies.find((p) => p.status === "ACTIVE");
  if (!policy) {
    policy = {
      policyId: VERONI_VAELG_SELV_POLICY_ID,
      policyVersion: (priorPolicies[0]?.policyVersion ?? 0) + 1 || 1,
      decisionType: "PRODUCT_CHOICE",
      scope: "RESTAURANT_CATEGORY",
      scopeRestaurant: VERONI_HOST,
      scopeCategory: VERONI_PITA_DURUM_CATEGORY,
      conditions: {
        all: [
          { field: "decisionType", op: "eq", value: "PRODUCT_CHOICE" },
          { field: "restaurantKey", op: "eq", value: VERONI_HOST },
          { field: "explicitChoiceMarkers", op: "contains", value: "VALGFRIT" },
          {
            field: "productTypeHints",
            op: "containsAny",
            value: ["PITA_DURUM"],
          },
        ],
      },
      resolution: JSON.stringify({
        kind: "PRODUCT_CHOICE",
        choiceGroup: "Vælg selv",
        required: true,
        minSelections: 1,
        maxSelections: 1,
        options: [...VERONI_VAELG_SELV_OPTIONS],
        businessFactRestaurant: VERONI_HOST,
        knowledgeKind: "BUSINESS_FACT",
      }),
      resolutionOptionId: "product-choice",
      status: "ACTIVE",
      createdFromDecisionIds: [VERONI_VAELG_SELV_HUMAN_DECISION_ID],
      confidenceEvidence:
        "OPERATOR_AUTHORITATIVE_BUSINESS_FACT: Veroni Pita/Durum Vælg selv fillings",
      createdAt: t,
      activatedAt: t,
      deprecatedAt: null,
      createdBy: "operator:m62",
      validationSummary:
        "Authoritative operator input — restaurant-scoped ACTIVE (seeded for M6.4)",
      inventsMissingFacts: false,
      knowledgeKind: "BUSINESS_FACT",
    };
    store.insertPolicyVersion(policy);
  }

  const existingFacts = store.facts.listActiveChoiceOptions(VERONI_HOST);
  let fact = existingFacts.find((f) => f.factId === VERONI_VAELG_SELV_FACT_ID);
  if (!fact) {
    fact = {
      factId: VERONI_VAELG_SELV_FACT_ID,
      factVersion: 1,
      restaurantKey: VERONI_HOST,
      sourceCategory: VERONI_PITA_DURUM_CATEGORY,
      scope: "RESTAURANT_CATEGORY",
      prompt: "Vælg selv",
      options: [...VERONI_VAELG_SELV_OPTIONS],
      required: true,
      minSelections: 1,
      maxSelections: 1,
      productTypeHints: ["PITA_DURUM"],
      excludedMenuNumbers: ["38"],
      humanDecisionId: VERONI_VAELG_SELV_HUMAN_DECISION_ID,
      knowledgeKind: "BUSINESS_FACT",
      status: "ACTIVE",
      createdAt: t,
      originalOperatorText:
        "For Veroni Pita/Durum Vælg selv: Kebab, Kylling, Skinke, Falafel, Mix",
    };
    store.facts.insertChoiceOptionsFact(fact);
  }

  return {
    policy,
    humanDecisionId: VERONI_VAELG_SELV_HUMAN_DECISION_ID,
    createdHumanDecision,
    fact,
  };
}

export type Product61Audit = {
  menuNumber: "61";
  name: string;
  currentInterpretation: string;
  validationStatus: string;
  choiceModel: unknown;
  issues: unknown[];
  rawEvidence: string | null;
  pageSourceChoiceText: string;
  whyDecisionCase: string;
  requiredDecisionCase: boolean;
};

export function auditProduct61(menu: CanonicalMenu): Product61Audit {
  const p = findProduct(menu, "61");
  const choices = p?.productChoices ?? [];
  const required =
    choices.length === 0 ||
    !choices.some((c) =>
      c.options.some((o) =>
        /kylling|okse|grøntsager|rejer/i.test(o.label ?? ""),
      ),
    );
  return {
    menuNumber: "61",
    name: p?.name ?? "Kottu rotti",
    currentInterpretation:
      choices.length === 0
        ? "No ProductChoice modeled; OCR row dropped protein slash list into separate layout tokens"
        : `productChoices=${JSON.stringify(choices)}`,
    validationStatus: p?.status ?? "MISSING",
    choiceModel: choices,
    issues: p?.issues ?? [],
    rawEvidence: p?.evidence?.rawText ?? null,
    pageSourceChoiceText: "kylling/okse/grøntsager/rejer",
    whyDecisionCase: required
      ? "Source page enumerates alternative mains; CanonicalMenu does not yet represent the choice — DecisionEngine must evaluate (was omitted from older 9-item pack)"
      : "Choice already represented in CanonicalMenu",
    requiredDecisionCase: required,
  };
}

function findProduct(
  menu: CanonicalMenu,
  menuNumber: string,
): CanonicalProduct | undefined {
  return menu.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === menuNumber);
}

export type RemainingHumanQuestion = {
  decisionId: string;
  decisionCaseId: string;
  decisionType: string;
  affectedProducts: Array<{ menuNumber: string | null; name: string }>;
  alreadyKnown: string[];
  unknownFact: string;
  question: string;
  recommendedAnswer: string | null;
  expectedScope: string;
  whatWillBeLearned: string;
  languageStrength: string;
  resolutionMethod: string;
  gateReasons: string[];
  batchGroup: string;
};

export function buildRemainingQuestions(
  cases: DecisionCase[],
  outcomes: DecisionOutcome[],
): RemainingHumanQuestion[] {
  const remaining = cases.filter((c) => {
    const o = outcomes.find((x) => x.decisionCaseId === c.decisionCaseId);
    const status = o?.status ?? c.status;
    return (
      status === "HUMAN_REVIEW_REQUIRED" ||
      status === "UNRESOLVED" ||
      status === "POLICY_CONFLICT" ||
      status === "BLOCKED"
    );
  });

  // Batch-group identical underlying business decisions
  const groups = new Map<string, DecisionCase[]>();
  for (const c of remaining) {
    const key = batchGroupKey(c);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const out: RemainingHumanQuestion[] = [];
  for (const [group, groupCases] of groups) {
    // One question per group (consolidate)
    const primary = groupCases[0]!;
    const o = outcomes.find((x) => x.decisionCaseId === primary.decisionCaseId);
    const lang = classifyChoiceLanguageStrength(primary.sourceText);
    const affected = groupCases.flatMap((c) => {
      const ev = JSON.parse(c.sourceEvidenceJson ?? "{}") as {
        affected?: string[];
      };
      if (ev.affected?.length) {
        return ev.affected.map((n) => ({
          menuNumber: n,
          name: c.productName,
        }));
      }
      return [{ menuNumber: c.menuNumber, name: c.productName }];
    });
    // Deduplicate by menu number
    const seen = new Set<string>();
    const affectedUnique = affected.filter((a) => {
      const k = a.menuNumber ?? a.name;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    out.push(formatQuestion(primary, o, lang.strength, affectedUnique, group));
  }
  return out;
}

function batchGroupKey(c: DecisionCase): string {
  if (c.decisionType === "MENU_PRICE_OPTION_SEMANTICS") {
    return "MENU_BASE_OPTION";
  }
  if (c.menuNumber === "24" || /skinke\/kebab/i.test(c.sourceText)) {
    return "SLASH_SKINKE_KEBAB";
  }
  if (/ris\/naan/i.test(c.sourceText)) return "SLASH_RIS_NAAN";
  if (c.menuNumber === "60") return "SLASH_PROTEIN_60";
  if (c.menuNumber === "61") return "SLASH_PROTEIN_61";
  if (c.menuNumber === "38") return "CAT_38";
  if (/pasta/i.test(String(c.decisionType) + c.sourceText)) return "CAT_PASTA";
  return `${c.decisionType}:${c.menuNumber ?? c.sourceId}`;
}

function formatQuestion(
  c: DecisionCase,
  o: DecisionOutcome | undefined,
  strength: string,
  affected: Array<{ menuNumber: string | null; name: string }>,
  batchGroup: string,
): RemainingHumanQuestion {
  const opts = extractEnumeratedOptions(c.sourceText);
  let unknownFact = "Operator confirmation of semantic interpretation";
  let question = `Please resolve ${c.decisionType} for ${c.productName}.`;
  let recommended: string | null = c.recommendedOptionId
    ? `System recommendation (NOT approval): ${c.recommendedOptionId}`
    : null;
  let expectedScope = "EXACT_PRODUCT";
  let whatLearned = "Scoped business fact / semantic rule for matching cases";
  const alreadyKnown: string[] = [
    `Source text available`,
    `Language strength: ${strength}`,
  ];
  if (opts.length) alreadyKnown.push(`Enumerated from source: ${opts.join(", ")}`);

  if (c.menuNumber === "24") {
    unknownFact =
      "Whether “skinke/kebab” is a guest choose-one ProductChoice or fixed simultaneous ingredients";
    question =
      "#24 Calzone - Karan contains “skinke/kebab”. Does the guest choose one of Skinke or Kebab, or are both fixed ingredients?";
    recommended =
      "Defensible: ProductChoice (Skinke | Kebab) — common on Danish calzone menus, but slash alone is weak evidence.";
    expectedScope = "EXACT_PRODUCT";
    whatLearned =
      "PRODUCT_CHOICE or INGREDIENT fact for Veroni #24 only (unless you widen scope)";
  } else if (/ris\/naan/i.test(c.sourceText)) {
    unknownFact =
      "Whether “Ris/naanbrød” means choose rice OR naan, or both are served";
    question =
      "#57 Butter chicken and #58 Chicken Tikka-Masala list “Ris/naanbrød”. Does the guest choose Ris or Naanbrød, or is that a fixed accompaniment description?";
    recommended =
      "Ambiguous — do not auto-force ProductChoice from slash alone.";
    expectedScope = "RESTAURANT_CATEGORY (Indisk hovedretter) if you confirm choice";
    whatLearned = "Choice vs ingredient rule for this Indisk accompaniment pattern";
    alreadyKnown.push("Affected: #57, #58");
  } else if (c.menuNumber === "60") {
    unknownFact =
      "Whether kylling/okse/vegetar is a required choose-one ProductChoice";
    question =
      "#60 Fried noodles lists “kylling/okse/vegetar”. Should the guest choose exactly one of Kylling, Okse, or Vegetar?";
    recommended =
      "Likely ProductChoice with source options [Kylling, Okse, Vegetar] — still needs confirmation (slash-only).";
    expectedScope = "EXACT_PRODUCT";
    whatLearned = "PRODUCT_CHOICE options for Veroni #60 from source enumeration";
  } else if (c.menuNumber === "61") {
    unknownFact =
      "Whether kylling/okse/grøntsager/rejer is a choose-one ProductChoice";
    question =
      "#61 Kottu rotti source lists “kylling/okse/grøntsager/rejer”. Should the guest choose exactly one of Kylling, Okse, Grøntsager, or Rejer?";
    recommended =
      "Likely ProductChoice with those four source options — slash-only so gate requires operator.";
    expectedScope = "EXACT_PRODUCT";
    whatLearned = "PRODUCT_CHOICE options for Veroni #61; also helps backfill missing ingredients/choice on CanonicalMenu";
  } else if (c.menuNumber === "38") {
    unknownFact =
      "Destination category for #38 Hjemmelavet hvidløgsbrød";
    question =
      "#38 Hjemmelavet hvidløgsbrød sits with #36–37 before the GRILL heading. Live destination has “Durum & Pitabrød”. Should #38 map to Durum & Pitabrød, Grill, or another existing category? (Do not invent a new category.)";
    recommended =
      "Durum & Pitabrød is defensible by layout adjacency, but garlic bread may also belong under Grill/sides — operator must confirm.";
    expectedScope = "EXACT_PRODUCT";
    whatLearned = "Destination category mapping for Veroni #38";
    alreadyKnown.push(
      "Destination categories include Durum & Pitabrød and Grill",
      "No dedicated Tilbehør/Hvidløg destination category",
    );
  } else if (c.decisionType === "MENU_PRICE_OPTION_SEMANTICS") {
    unknownFact = "How to represent BASE+Menu when contents are unknown";
    question =
      "Products #36–43 show BASE and Menu prices without Menu contents. Keep Menu as a priced variant (surcharge = Menu−BASE) without inventing contents?";
    recommended = "variant — preserves exact source prices";
    expectedScope = "RESTAURANT (shared semantic pattern)";
    whatLearned = "MENU_AS_VARIANT semantic rule for BASE+Menu";
  }

  return {
    decisionId: c.sourceId,
    decisionCaseId: c.decisionCaseId,
    decisionType: String(c.decisionType),
    affectedProducts: affected,
    alreadyKnown,
    unknownFact,
    question,
    recommendedAnswer: recommended,
    expectedScope,
    whatWillBeLearned: whatLearned,
    languageStrength: strength,
    resolutionMethod: o?.method ?? "NONE",
    gateReasons: o?.gate?.reasonCodes ?? [o?.explanation ?? "pending"],
    batchGroup,
  };
}

export function resolutionMethodLabel(
  method: DecisionOutcome["method"] | null | undefined,
  status: string,
): string {
  if (status === "HUMAN_RESOLVED") return "HUMAN";
  if (method === "DETERMINISTIC") return "DETERMINISTIC";
  if (method === "ACTIVE_POLICY") return "ACTIVE_POLICY";
  if (method === "PRECEDENT") return "PRECEDENT";
  if (method === "AI_GATE" || String(method) === "AI") return "AI_GATE";
  if (status === "HUMAN_REVIEW_REQUIRED") return "HUMAN_REVIEW_REQUIRED";
  return method ?? status;
}

export function auditAdditions(menu: CanonicalMenu): {
  productsWithAdditions: number;
  unresolvedPriceMissing: number;
  unresolvedScopeUnclear: number;
  autoResolvableFromSource: number;
  notes: string[];
} {
  let productsWithAdditions = 0;
  let unresolvedPriceMissing = 0;
  let autoResolvableFromSource = 0;
  const notes: string[] = [];
  for (const cat of menu.categories) {
    for (const p of cat.products) {
      if (!p.addOns.length) continue;
      productsWithAdditions += 1;
      for (const a of p.addOns) {
        if (a.price == null) {
          unresolvedPriceMissing += 1;
          notes.push(
            `${p.sourceMenuNumber}: addition "${a.name}" missing price`,
          );
        } else {
          autoResolvableFromSource += 1;
        }
      }
    }
  }
  return {
    productsWithAdditions,
    unresolvedPriceMissing,
    unresolvedScopeUnclear: 0,
    autoResolvableFromSource,
    notes,
  };
}
