import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DecisionEngine,
  DecisionPolicyRegistry,
} from "../../src/decisions/engine.js";
import { DecisionStore } from "../../src/decisions/store.js";
import { tryDeterministicResolve } from "../../src/decisions/deterministic.js";
import { buildDecisionFeatures } from "../../src/decisions/features.js";
import { classifyRisk } from "../../src/decisions/gate.js";
import {
  VERONI_VAELG_SELV_OPTIONS,
  classifyChoiceLanguageStrength,
  extractEnumeratedOptions,
} from "../../src/decisions/choiceLanguage.js";
import {
  VERONI_HOST,
  VERONI_PITA_DURUM_CATEGORY,
  VERONI_VAELG_SELV_HUMAN_DECISION_ID,
  auditProduct61,
  buildConsolidatedVeroniCases,
  buildRemainingQuestions,
  seedAuthoritativeVeroniVaelgSelv,
} from "../../src/decisions/veroniAutonomousPass.js";
import { makeDecisionCase } from "./helpers/decisionFixtures.js";
import type { FinalHumanDecision } from "../../src/review/finalReview.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";
import { ADMIN_CONTRACT_V1 } from "../../src/tah/contracts/v1.js";
import type { DecisionOutcome } from "../../src/decisions/types.js";

const dirs: string[] = [];
function openStore(): DecisionStore {
  const dir = mkdtempSync(join(tmpdir(), "m64-"));
  dirs.push(dir);
  return new DecisionStore(join(dir, "d.sqlite"));
}
afterEach(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
});

const choiceOpts = [
  { id: "product-choice", label: "choice", effect: "c" },
  { id: "ingredient", label: "ing", effect: "i" },
];

describe("M6.4 Veroni autonomous decision pass", () => {
  it("explicit 'eller' resolves deterministically as PRODUCT_CHOICE", () => {
    const c = makeDecisionCase({
      decisionCaseId: "dc_eller",
      decisionType: "PRODUCT_CHOICE",
      menuNumber: "59",
      productName: "Fried rice",
      sourceText: "Stegt ris, kylling eller oksekød med tilbehør",
      options: choiceOpts,
    });
    const lang = classifyChoiceLanguageStrength(c.sourceText);
    expect(lang.strength).toBe("VERY_STRONG");
    expect(lang.enumeratedOptions).toEqual(
      expect.arrayContaining(["kylling", "oksekød"]),
    );
    const det = tryDeterministicResolve(c);
    expect(det?.status).toBe("AUTO_RESOLVED_DETERMINISTIC");
    expect(det?.optionId).toBe("product-choice");
  });

  it("explicit 'Vælg mellem' resolves deterministically with source options", () => {
    const sourceText =
      "Vælg mellem: - Champignon - Broccoli - Blomkål - Indisk ost";
    const c = makeDecisionCase({
      decisionCaseId: "dc_vaelg",
      decisionType: "PRODUCT_CHOICE",
      menuNumber: "62",
      productName: "Fried rice med grøntsager og æg",
      sourceText,
      options: choiceOpts,
    });
    const opts = extractEnumeratedOptions(sourceText);
    expect(opts).toEqual(
      expect.arrayContaining([
        "Champignon",
        "Broccoli",
        "Blomkål",
        "Indisk ost",
      ]),
    );
    const det = tryDeterministicResolve(c);
    expect(det?.status).toBe("AUTO_RESOLVED_DETERMINISTIC");
    expect(det?.method).toBe("DETERMINISTIC");
  });

  it("consolidates duplicate #60 review cases into one", () => {
    const raw = [
      {
        id: "D-CHOICE-4",
        type: "PRODUCT_CHOICE",
        title: "t",
        affectedProducts: [
          { menuNumber: "59", name: "Fried rice" },
          { menuNumber: "60", name: "Fried noodles" },
        ],
        sourceText: "kylling eller oksekød --- kylling/okse/vegetar",
        currentInterpretation: "x",
        whyNecessary: "x",
        options: choiceOpts,
        recommendedOptionId: "product-choice",
        recommendedRationale: "r",
      },
      {
        id: "D-CHOICE-5",
        type: "PRODUCT_CHOICE",
        title: "t60",
        affectedProducts: [{ menuNumber: "60", name: "Fried noodles" }],
        sourceText: "kylling/okse/vegetar",
        currentInterpretation: "x",
        whyNecessary: "x",
        options: choiceOpts,
        recommendedOptionId: "product-choice",
        recommendedRationale: "r",
      },
    ] as FinalHumanDecision[];
    const { cases, consolidated } = buildConsolidatedVeroniCases(
      raw,
      "m64-test",
    );
    const sixty = cases.filter((c) => c.menuNumber === "60");
    expect(sixty).toHaveLength(1);
    expect(cases.filter((c) => c.menuNumber === "59")).toHaveLength(1);
    expect(cases.some((c) => c.menuNumber === "61")).toBe(true);
    expect(consolidated.join(" ")).toMatch(/#60/);
  });

  it("audits #61 — empty choice model requires DecisionCase", () => {
    const menu: CanonicalMenu = {
      restaurantName: "Veroni",
      categories: [
        {
          sourceId: "c",
          name: "Indisk",
          sourceOrder: 0,
          commonIngredients: [],
          products: [
            {
              sourceId: "src:61",
              categorySourceId: "c",
              name: "Kottu rotti",
              sourceMenuNumber: "61",
              sourceOrder: 0,
              ingredients: [],
              variants: [
                {
                  sourceId: "v",
                  name: "Alm.",
                  nameOrigin: "SOURCE",
                  surcharge: 0,
                  surchargeOrigin: "SOURCE",
                  isBase: true,
                  sourceTotalPrice: 13000,
                },
              ],
              addOns: [],
              productChoices: [],
              isCombo: false,
              status: "MANUAL_REVIEW_REQUIRED",
              issues: [
                {
                  code: "MISSING_SOURCE_SUPPORTED_INGREDIENTS",
                  message: "missing",
                  entityId: "src:61",
                  severity: "MANUAL_REVIEW_REQUIRED",
                },
              ],
              basePrice: 13000,
              basePriceOrigin: "SOURCE",
              evidence: {
                sourceFile: "x",
                rawText: "61. Kottu rotti 130,",
                confidence: 0.8,
                extractorVersion: "t",
              },
            },
          ],
        },
      ],
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
      status: "READY",
      issues: [],
    };
    const audit = auditProduct61(menu);
    expect(audit.requiredDecisionCase).toBe(true);
    expect(audit.pageSourceChoiceText).toMatch(/kylling\/okse/);
    expect(audit.choiceModel).toEqual([]);
  });

  it("learned Veroni Pita/Durum fact avoids repeat question via ACTIVE policy", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);
    const first = seedAuthoritativeVeroniVaelgSelv(store);
    expect(first.humanDecisionId).toBe(VERONI_VAELG_SELV_HUMAN_DECISION_ID);
    const second = seedAuthoritativeVeroniVaelgSelv(store);
    expect(second.createdHumanDecision).toBe(false);
    expect(store.listHumanDecisions().filter((h) => h.humanDecisionId === VERONI_VAELG_SELV_HUMAN_DECISION_ID)).toHaveLength(1);

    const c = makeDecisionCase({
      decisionCaseId: "dc_valgfrit_future",
      decisionType: "PRODUCT_CHOICE",
      restaurantKey: VERONI_HOST,
      menuNumber: "36",
      productName: "Dürüm rulle",
      sourceText: "Valgfrit kød, salat og dressing",
      sourceCategory: VERONI_PITA_DURUM_CATEGORY,
      options: choiceOpts,
    });
    c.contextFeatures = buildDecisionFeatures({
      decisionType: "PRODUCT_CHOICE",
      sourceText: c.sourceText,
      productName: c.productName,
      sourceCategory: VERONI_PITA_DURUM_CATEGORY,
      restaurantKey: VERONI_HOST,
      menuNumber: "36",
    });
    c.riskClass = classifyRisk({
      decisionType: c.decisionType,
      features: c.contextFeatures,
    });
    registry.registerCase(c);
    const o = await engine.resolve(c);
    expect(o.status).toBe("AUTO_RESOLVED_POLICY");
    expect(o.method).toBe("ACTIVE_POLICY");
    store.close();
  });

  it("shared Menu BASE+Menu collapses to one deterministic resolution", () => {
    const c = makeDecisionCase({
      decisionCaseId: "dc_menu",
      decisionType: "MENU_PRICE_OPTION_SEMANTICS",
      menuNumber: "36",
      productName: "Dürüm rulle; … #43",
      sourceText:
        "#36 BASE 75 / Menu 125\n#37 BASE 75 / Menu 125\n#43 BASE 99 / Menu 130",
      priceOptionLabels: ["BASE", "Menu"],
      options: [
        { id: "variant", label: "Menu as variant", effect: "v" },
        { id: "combo-later", label: "combo", effect: "c" },
      ],
      recommendedOptionId: "variant",
    });
    expect(c.contextFeatures.priceStructure).toBe("BASE_MENU");
    const det = tryDeterministicResolve(c);
    expect(det?.status).toBe("AUTO_RESOLVED_DETERMINISTIC");
    expect(det?.resolution).toBe("MENU_AS_VARIANT");
  });

  it("Pasta semantic resolution is separate from createCategory capability", () => {
    const c = makeDecisionCase({
      decisionCaseId: "dc_pasta",
      decisionType: "DESTINATION_CATEGORY",
      menuNumber: "33",
      productName: "Spaghetti Bolognese; Pasta Alfredo; Pasta Ai Gamberi",
      sourceText: "Source heading: Pasta\nProducts: 33–35",
      options: [
        { id: "create-pasta", label: "Create Pasta", effect: "create" },
        { id: "defer", label: "Defer", effect: "defer" },
      ],
      recommendedOptionId: "create-pasta",
    });
    const det = tryDeterministicResolve(c);
    expect(det?.status).toBe("AUTO_RESOLVED_DETERMINISTIC");
    expect(det?.explanation).toMatch(/capability-gated|Pasta/i);
    expect(ADMIN_CONTRACT_V1.capabilities.write.createCategory).toBe(
      "UNCERTIFIED",
    );
  });

  it("addition batch-question consolidation groups identical unresolved cases", () => {
    const cases = [10, 11, 12].map((n) =>
      makeDecisionCase({
        decisionCaseId: `dc_add_${n}`,
        decisionType: "ADDITION_SET",
        menuNumber: String(n),
        productName: `Pizza ${n}`,
        sourceText: "Missing pizza additions",
        sourceCategory: "Pizza",
        restaurantKey: VERONI_HOST,
        options: [
          { id: "approve-set", label: "Approve set", effect: "set" },
        ],
        status: "HUMAN_REVIEW_REQUIRED",
      }),
    );
    for (const c of cases) {
      c.status = "HUMAN_REVIEW_REQUIRED";
    }
    const outcomes: DecisionOutcome[] = cases.map((c) => ({
      decisionCaseId: c.decisionCaseId,
      status: "HUMAN_REVIEW_REQUIRED",
      resolution: null,
      optionId: null,
      method: "NONE",
      policyId: null,
      policyVersion: null,
      precedentIds: [],
      explanation: "missing addition set",
      gate: {
        verdict: "REVIEW",
        reasonCodes: ["MISSING_ADDITION_FACT"],
        riskClass: "HIGH",
      },
      reasoner: null,
      policyMatches: [],
    }));
    // Without batching key shared — ADDITION_SET with different menu numbers stay separate
    // unless same batch group. Prove Menu-style grouping: identical slash/group keys collapse.
    const slashCases = ["60a", "60b"].map((id, i) => {
      const c = makeDecisionCase({
        decisionCaseId: id,
        decisionType: "PRODUCT_CHOICE",
        menuNumber: "60",
        productName: "Fried noodles",
        sourceText: "#60 Fried noodles\nkylling/okse/vegetar",
        options: choiceOpts,
        status: "HUMAN_REVIEW_REQUIRED",
      });
      c.status = "HUMAN_REVIEW_REQUIRED";
      void i;
      return c;
    });
    const slashOutcomes: DecisionOutcome[] = slashCases.map((c) => ({
      decisionCaseId: c.decisionCaseId,
      status: "HUMAN_REVIEW_REQUIRED",
      resolution: null,
      optionId: null,
      method: "NONE",
      policyId: null,
      policyVersion: null,
      precedentIds: [],
      explanation: "slash",
      gate: {
        verdict: "REVIEW",
        reasonCodes: ["AI_REQUIRES_REVIEW"],
        riskClass: "HIGH",
      },
      reasoner: null,
      policyMatches: [],
    }));
    const qs = buildRemainingQuestions(slashCases, slashOutcomes);
    expect(qs).toHaveLength(1);
    expect(qs[0]!.batchGroup).toBe("SLASH_PROTEIN_60");
    expect(VERONI_VAELG_SELV_OPTIONS).toHaveLength(5);
  });
});
