import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DecisionEngine,
  DecisionPolicyRegistry,
} from "../../src/decisions/engine.js";
import { DecisionStore } from "../../src/decisions/store.js";
import { applyProductChoiceSpec } from "../../src/decisions/transforms.js";
import {
  VERONI_HOST,
  VERONI_PITA_DURUM_CATEGORY,
  seedAuthoritativeVeroniVaelgSelv,
} from "../../src/decisions/veroniAutonomousPass.js";
import { VERONI_VAELG_SELV_OPTIONS } from "../../src/decisions/choiceLanguage.js";
import { makeDecisionCase } from "./helpers/decisionFixtures.js";
import { mapProductToDestinationCategory } from "../../src/planning/categoryMapping.js";
import { promoteCandidateToShadow } from "../../src/decisions/learning.js";
import { assertGlobalPolicyHasNoFixedMoney } from "../../src/decisions/facts.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";
import { buildDecisionFeatures } from "../../src/decisions/features.js";
import { classifyRisk } from "../../src/decisions/gate.js";
import type { PolicyCandidate } from "../../src/decisions/types.js";

const dirs: string[] = [];
function openStore(): DecisionStore {
  const dir = mkdtempSync(join(tmpdir(), "m65-"));
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

function bareMenu(
  products: Array<{ n: string; name: string }>,
): CanonicalMenu {
  return {
    restaurantName: "Veroni Pizza",
    categories: [
      {
        sourceId: "cat",
        name: "Test",
        sourceOrder: 0,
        commonIngredients: [],
        products: products.map((p, i) => ({
          sourceId: `src:${p.n}`,
          categorySourceId: "cat",
          name: p.name,
          sourceMenuNumber: p.n,
          sourceOrder: i,
          ingredients: [],
          variants: [
            {
              sourceId: `src:${p.n}::v`,
              name: "Alm.",
              nameOrigin: "SOURCE" as const,
              surcharge: 0,
              surchargeOrigin: "SOURCE" as const,
              isBase: true,
              sourceTotalPrice: 10000,
            },
          ],
          addOns: [],
          productChoices: [],
          isCombo: false,
          status: "READY" as const,
          issues: [],
          basePrice: 10000,
          basePriceOrigin: "SOURCE" as const,
        })),
      },
    ],
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
    status: "READY",
    issues: [],
  };
}

const choiceOpts = [
  { id: "product-choice", label: "choice", effect: "c" },
  { id: "ingredient", label: "ing", effect: "i" },
  { id: "durum", label: "Durum", effect: "d" },
];

describe("M6.5 Veroni final decision lock", () => {
  it("applies #24 Skinke/Kebab ProductChoice via typed transform", () => {
    let menu = bareMenu([{ n: "24", name: "Calzone - Karan" }]);
    menu = applyProductChoiceSpec(menu, "24", {
      prompt: "Vælg",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: ["Skinke", "Kebab"],
    });
    const p = menu.categories[0]!.products[0]!;
    expect(p.productChoices[0]!.options.map((o) => o.label)).toEqual([
      "Skinke",
      "Kebab",
    ]);
    expect(p.productChoices[0]!.required).toBe(true);
  });

  it("applies #57/#58 Ris/Naanbrød ProductChoice without leaking to #55", () => {
    let menu = bareMenu([
      { n: "57", name: "Butter chicken" },
      { n: "58", name: "Chicken Tikka-Masala" },
      { n: "55", name: "Samosa" },
    ]);
    const spec = {
      prompt: "Vælg tilbehør",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: ["Ris", "Naanbrød"],
    };
    menu = applyProductChoiceSpec(menu, "57", spec);
    menu = applyProductChoiceSpec(menu, "58", spec);
    expect(
      menu.categories[0]!.products
        .find((p) => p.sourceMenuNumber === "57")!
        .productChoices[0]!.options.map((o) => o.label),
    ).toEqual(["Ris", "Naanbrød"]);
    expect(
      menu.categories[0]!.products.find((p) => p.sourceMenuNumber === "55")!
        .productChoices,
    ).toHaveLength(0);
  });

  it("applies #60 three-choice and #61 four-choice without cross-copy", () => {
    let menu = bareMenu([
      { n: "60", name: "Fried noodles" },
      { n: "61", name: "Kottu rotti" },
    ]);
    menu = applyProductChoiceSpec(menu, "60", {
      prompt: "Vælg",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: ["Kylling", "Okse", "Vegetar"],
    });
    menu = applyProductChoiceSpec(menu, "61", {
      prompt: "Vælg",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: ["Kylling", "Okse", "Grøntsager", "Rejer"],
    });
    const p60 = menu.categories[0]!.products.find(
      (p) => p.sourceMenuNumber === "60",
    )!;
    const p61 = menu.categories[0]!.products.find(
      (p) => p.sourceMenuNumber === "61",
    )!;
    expect(p60.productChoices[0]!.options.map((o) => o.label)).toEqual([
      "Kylling",
      "Okse",
      "Vegetar",
    ]);
    expect(p61.productChoices[0]!.options.map((o) => o.label)).toEqual([
      "Kylling",
      "Okse",
      "Grøntsager",
      "Rejer",
    ]);
    expect(p60.productChoices[0]!.options).not.toEqual(
      p61.productChoices[0]!.options,
    );
  });

  it("maps #38 to Durum & Pitabrød id 6 via human-approved override", () => {
    const m = mapProductToDestinationCategory(
      {
        menuNumber: "38",
        name: "Hjemmelavet hvidløgsbrød",
        sourceCategoryName: "UNLABELLED",
      },
      [{ databaseId: "6", name: "Durum & Pitabrød" }, { databaseId: "7", name: "Grill" }],
      {
        humanApprovedByMenuNumber: {
          "38": {
            destinationCategoryId: "6",
            destinationCategoryName: "Durum & Pitabrød",
          },
        },
      },
    );
    expect(m.outcome).toBe("SAFE_MAPPED_MATCH");
    expect(m.destinationCategoryId).toBe("6");
  });

  it("batch human interaction resolves 5 cases with one operator interaction metric", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    seedAuthoritativeVeroniVaelgSelv(store);
    const keys = ["24", "57", "60", "61", "38"];
    const humans = [];
    for (const k of keys) {
      const c = makeDecisionCase({
        decisionCaseId: `dc_m65_${k}`,
        decisionType: k === "38" ? "DESTINATION_CATEGORY" : "PRODUCT_CHOICE",
        restaurantKey: VERONI_HOST,
        menuNumber: k,
        productName: `P${k}`,
        sourceText:
          k === "57"
            ? "Ris/naanbrød"
            : k === "24"
              ? "skinke/kebab"
              : k === "60"
                ? "kylling/okse/vegetar"
                : k === "61"
                  ? "kylling/okse/grøntsager/rejer"
                  : "hvidløgsbrød",
        sourceCategory: k === "57" ? "Indisk" : VERONI_PITA_DURUM_CATEGORY,
        options: choiceOpts,
        recommendedOptionId: k === "38" ? "durum" : "product-choice",
      });
      registry.registerCase(c);
      const { human } = registry.recordHumanDecision(c, {
        decisionCaseId: c.decisionCaseId,
        resolution: "PRODUCT_CHOICE",
        selectedOptionId: k === "38" ? "durum" : "product-choice",
        scopePreference: "APPLY_THIS_CASE_ONLY",
        operatorId: "operator",
        comment: "OPERATOR_BATCH:m65-veroni-final-lock|test",
      });
      humans.push(human);
    }
    expect(humans).toHaveLength(5);
    const interactions = new Set(
      humans.map((h) => h.comment?.match(/OPERATOR_BATCH:([^|]+)/)?.[1]),
    );
    expect(interactions.size).toBe(1);
    expect([...interactions][0]).toBe("m65-veroni-final-lock");
    store.close();
  });

  it("does not slash-globalize: GLOBAL fixed option BUSINESS_FACT blocked", () => {
    expect(() =>
      assertGlobalPolicyHasNoFixedMoney({
        scope: "GLOBAL",
        knowledgeKind: "BUSINESS_FACT",
        resolution: JSON.stringify({ options: ["Skinke", "Kebab"] }),
      }),
    ).toThrow(/GLOBAL_FIXED_BUSINESS_FACT_NOT_ALLOWED/);
  });

  it("category mapping #38 does not leak to other restaurant garlic bread", () => {
    const other = mapProductToDestinationCategory(
      {
        menuNumber: "99",
        name: "Hvidløgsbrød",
        sourceCategoryName: "Sides",
      },
      [{ databaseId: "6", name: "Durum & Pitabrød" }],
      {
        humanApprovedByMenuNumber: {
          "38": {
            destinationCategoryId: "6",
            destinationCategoryName: "Durum & Pitabrød",
          },
        },
      },
    );
    expect(other.outcome).not.toBe("SAFE_MAPPED_MATCH");
  });

  it("Veroni option sets do not leak cross-restaurant via ACTIVE policy", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);
    seedAuthoritativeVeroniVaelgSelv(store);
    const other = makeDecisionCase({
      decisionCaseId: "dc_other_valgfrit",
      decisionType: "PRODUCT_CHOICE",
      restaurantKey: "other.dk",
      menuNumber: "1",
      productName: "Dürüm",
      sourceText: "Valgfrit kød",
      sourceCategory: VERONI_PITA_DURUM_CATEGORY,
      options: choiceOpts,
    });
    other.contextFeatures = buildDecisionFeatures({
      decisionType: "PRODUCT_CHOICE",
      sourceText: "Valgfrit kød",
      productName: "Dürüm",
      sourceCategory: VERONI_PITA_DURUM_CATEGORY,
      restaurantKey: "other.dk",
      menuNumber: "1",
    });
    other.riskClass = classifyRisk({
      decisionType: other.decisionType,
      features: other.contextFeatures,
    });
    registry.registerCase(other);
    const o = await engine.resolve(other);
    expect(o.status).not.toBe("AUTO_RESOLVED_POLICY");
    expect(o.method).not.toBe("ACTIVE_POLICY");
    store.close();
  });

  it("tomat/ost slash does not become ProductChoice from protein slash SHADOW", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);
    const cand: PolicyCandidate = {
      candidateId: "pcand_test_slash",
      proposedScope: "RESTAURANT_CATEGORY",
      scopeRestaurant: VERONI_HOST,
      scopeCategory: "Indisk",
      decisionType: "PRODUCT_CHOICE",
      conditions: {
        all: [
          { field: "decisionType", op: "eq", value: "PRODUCT_CHOICE" },
          { field: "restaurantKey", op: "eq", value: VERONI_HOST },
          { field: "slashSeparatedOptions", op: "eq", value: true },
        ],
      },
      resolution: JSON.stringify({ kind: "PRODUCT_CHOICE_SEMANTIC" }),
      resolutionOptionId: "product-choice",
      supportingDecisionIds: ["hd_a", "hd_b"],
      examplesMatched: [],
      examplesExcluded: [],
      potentialConflicts: [],
      inventsMissingFacts: false,
      createdAt: new Date().toISOString(),
    };
    // Keep SHADOW — not ACTIVE — so tomat/ost cannot auto-resolve
    promoteCandidateToShadow(store, cand, "test");
    const c = makeDecisionCase({
      decisionCaseId: "dc_tomat",
      decisionType: "PRODUCT_CHOICE",
      restaurantKey: VERONI_HOST,
      menuNumber: "1",
      productName: "Test",
      sourceText: "tomat/ost",
      sourceCategory: "Pizza",
      options: choiceOpts,
    });
    registry.registerCase(c);
    const o = await engine.resolve(c);
    expect(o.status).toBe("HUMAN_REVIEW_REQUIRED");
    store.close();
  });

  it("resolved ProductChoices survive regeneration-style re-apply", () => {
    let menu = bareMenu([
      { n: "36", name: "Dürüm rulle" },
      { n: "37", name: "Pitabrød" },
      { n: "38", name: "Hvidløgsbrød" },
    ]);
    const spec = {
      prompt: "Vælg selv",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: [...VERONI_VAELG_SELV_OPTIONS],
    };
    menu = applyProductChoiceSpec(menu, "36", spec);
    menu = applyProductChoiceSpec(menu, "37", spec);
    // regenerate-style second apply
    menu = applyProductChoiceSpec(menu, "36", spec);
    menu = applyProductChoiceSpec(menu, "37", spec);
    const p36 = menu.categories[0]!.products.find(
      (p) => p.sourceMenuNumber === "36",
    )!;
    const p38 = menu.categories[0]!.products.find(
      (p) => p.sourceMenuNumber === "38",
    )!;
    expect(p36.productChoices).toHaveLength(1);
    expect(p36.productChoices[0]!.options.map((o) => o.label)).toEqual([
      ...VERONI_VAELG_SELV_OPTIONS,
    ]);
    expect(p38.productChoices).toHaveLength(0);
  });
});
