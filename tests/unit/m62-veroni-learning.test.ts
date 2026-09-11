import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionEngine, DecisionPolicyRegistry } from "../../src/decisions/engine.js";
import { DecisionStore } from "../../src/decisions/store.js";
import { buildDecisionFeatures } from "../../src/decisions/features.js";
import { classifyRisk } from "../../src/decisions/gate.js";
import {
  VERONI_VAELG_SELV_OPTIONS,
  classifyChoiceLanguageStrength,
} from "../../src/decisions/choiceLanguage.js";
import {
  applyProductChoiceSpec,
  veroniVaelgSelvChoiceSpec,
} from "../../src/decisions/transforms.js";
import { tryDeterministicResolve } from "../../src/decisions/deterministic.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";
import { makeDecisionCase } from "./helpers/decisionFixtures.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
} from "../../src/decisions/versions.js";

const dirs: string[] = [];
function openStore(): DecisionStore {
  const dir = mkdtempSync(join(tmpdir(), "m62-"));
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

function emptyMenu(products: Array<{
  menuNumber: string;
  name: string;
  sourceId: string;
}>): CanonicalMenu {
  return {
    restaurantName: "Veroni Pizza",
    categories: [
      {
        sourceId: "cat1",
        name: "Durum & Pitabrød",
        sourceOrder: 0,
        commonIngredients: [],
        products: products.map((p, i) => ({
          sourceId: p.sourceId,
          categorySourceId: "cat1",
          name: p.name,
          sourceMenuNumber: p.menuNumber,
          sourceOrder: i,
          ingredients: [],
          variants: [
            {
              sourceId: `${p.sourceId}::v`,
              name: "Alm.",
              nameOrigin: "SOURCE" as const,
              surcharge: 0,
              surchargeOrigin: "SOURCE" as const,
              isBase: true,
              sourceTotalPrice: 7500,
            },
          ],
          addOns: [],
          productChoices: [],
          isCombo: false,
          status: "READY" as const,
          issues: [],
          basePrice: 7500,
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

describe("M6.2 Veroni learned Vælg selv", () => {
  it("applies exactly five required choose-one options to #36/#37 only", () => {
    let menu = emptyMenu([
      { menuNumber: "36", name: "Dürüm rulle", sourceId: "src:36" },
      { menuNumber: "37", name: "Hjemmelavet pitabrød", sourceId: "src:37" },
      { menuNumber: "38", name: "Hjemmelavet hvidløgsbrød", sourceId: "src:38" },
    ]);
    const spec = veroniVaelgSelvChoiceSpec();
    menu = applyProductChoiceSpec(menu, "36", spec);
    menu = applyProductChoiceSpec(menu, "37", spec);
    const p36 = menu.categories[0]!.products.find((p) => p.sourceMenuNumber === "36")!;
    const p37 = menu.categories[0]!.products.find((p) => p.sourceMenuNumber === "37")!;
    const p38 = menu.categories[0]!.products.find((p) => p.sourceMenuNumber === "38")!;
    expect(p36.productChoices[0]!.options.map((o) => o.label)).toEqual([
      ...VERONI_VAELG_SELV_OPTIONS,
    ]);
    expect(p37.productChoices[0]!.options).toHaveLength(5);
    expect(p36.productChoices[0]!.required).toBe(true);
    expect(p36.productChoices[0]!.minSelections).toBe(1);
    expect(p36.productChoices[0]!.maxSelections).toBe(1);
    expect(p38.productChoices).toHaveLength(0);
  });

  it("A — same Veroni Pita/Durum valgfrit auto-resolves via ACTIVE policy", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);
    store.insertPolicyVersion({
      policyId: "pol_veroni_test",
      policyVersion: 1,
      decisionType: "PRODUCT_CHOICE",
      scope: "RESTAURANT_CATEGORY",
      scopeRestaurant: "veronipizza.dk",
      scopeCategory: "Durum & Pitabrød",
      conditions: {
        all: [
          { field: "decisionType", op: "eq", value: "PRODUCT_CHOICE" },
          { field: "restaurantKey", op: "eq", value: "veronipizza.dk" },
          { field: "explicitChoiceMarkers", op: "contains", value: "VALGFRIT" },
          { field: "productTypeHints", op: "containsAny", value: ["PITA_DURUM"] },
        ],
      },
      resolution: "PRODUCT_CHOICE",
      resolutionOptionId: "product-choice",
      status: "ACTIVE",
      createdFromDecisionIds: ["hd_test"],
      confidenceEvidence: "test",
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
      deprecatedAt: null,
      createdBy: "test",
      validationSummary: null,
      inventsMissingFacts: false,
    });
    const c = makeDecisionCase({
      decisionCaseId: "dc_a",
      decisionType: "PRODUCT_CHOICE",
      restaurantKey: "veronipizza.dk",
      productName: "Dürüm rulle",
      sourceText: "Valgfrit kød",
      sourceCategory: "Durum & Pitabrød",
      menuNumber: "99",
    });
    // rebuild features with hints
    c.contextFeatures = buildDecisionFeatures({
      decisionType: "PRODUCT_CHOICE",
      sourceText: "Valgfrit kød",
      productName: "Dürüm rulle",
      sourceCategory: "Durum & Pitabrød",
      restaurantKey: "veronipizza.dk",
      menuNumber: "99",
    });
    c.riskClass = classifyRisk({
      decisionType: c.decisionType,
      features: c.contextFeatures,
    });
    registry.registerCase(c);
    const o = await engine.resolve(c);
    expect(o.status).toBe("AUTO_RESOLVED_POLICY");
    expect(o.optionId).toBe("product-choice");
    store.close();
  });

  it("B — garlic bread same category without valgfrit does NOT get five options", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);
    store.insertPolicyVersion({
      policyId: "pol_veroni_test2",
      policyVersion: 1,
      decisionType: "PRODUCT_CHOICE",
      scope: "RESTAURANT_CATEGORY",
      scopeRestaurant: "veronipizza.dk",
      scopeCategory: "Durum & Pitabrød",
      conditions: {
        all: [
          { field: "decisionType", op: "eq", value: "PRODUCT_CHOICE" },
          { field: "explicitChoiceMarkers", op: "contains", value: "VALGFRIT" },
          { field: "productTypeHints", op: "containsAny", value: ["PITA_DURUM"] },
        ],
      },
      resolution: "PRODUCT_CHOICE",
      resolutionOptionId: "product-choice",
      status: "ACTIVE",
      createdFromDecisionIds: ["hd"],
      confidenceEvidence: null,
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
      deprecatedAt: null,
      createdBy: "t",
      validationSummary: null,
      inventsMissingFacts: false,
    });
    const c = makeDecisionCase({
      decisionCaseId: "dc_b",
      decisionType: "PRODUCT_CHOICE",
      restaurantKey: "veronipizza.dk",
      productName: "Hjemmelavet hvidløgsbrød",
      sourceText: "Hvidløgsbrød med ost",
      sourceCategory: "Durum & Pitabrød",
      menuNumber: "38",
    });
    c.contextFeatures = buildDecisionFeatures({
      decisionType: "PRODUCT_CHOICE",
      sourceText: "Hvidløgsbrød med ost",
      productName: "Hjemmelavet hvidløgsbrød",
      sourceCategory: "Durum & Pitabrød",
      restaurantKey: "veronipizza.dk",
      menuNumber: "38",
    });
    registry.registerCase(c);
    const o = await engine.resolve(c);
    expect(o.status).not.toBe("AUTO_RESOLVED_POLICY");
    store.close();
  });

  it("C/D — other restaurant valgfrit does not copy Veroni five-option ACTIVE fact", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);
    store.insertPolicyVersion({
      policyId: "pol_veroni_only",
      policyVersion: 1,
      decisionType: "PRODUCT_CHOICE",
      scope: "RESTAURANT_CATEGORY",
      scopeRestaurant: "veronipizza.dk",
      scopeCategory: "Durum & Pitabrød",
      conditions: {
        all: [
          { field: "restaurantKey", op: "eq", value: "veronipizza.dk" },
          { field: "explicitChoiceMarkers", op: "contains", value: "VALGFRIT" },
        ],
      },
      resolution: JSON.stringify({ options: [...VERONI_VAELG_SELV_OPTIONS] }),
      resolutionOptionId: "product-choice",
      status: "ACTIVE",
      createdFromDecisionIds: ["hd"],
      confidenceEvidence: null,
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
      deprecatedAt: null,
      createdBy: "t",
      validationSummary: null,
      inventsMissingFacts: false,
    });
    const c = makeDecisionCase({
      decisionCaseId: "dc_c",
      decisionType: "PRODUCT_CHOICE",
      restaurantKey: "other.dk",
      productName: "Pita",
      sourceText: "Valgfrit kød",
      menuNumber: "1",
    });
    c.contextFeatures = buildDecisionFeatures({
      decisionType: "PRODUCT_CHOICE",
      sourceText: "Valgfrit kød",
      productName: "Pita",
      restaurantKey: "other.dk",
      menuNumber: "1",
    });
    registry.registerCase(c);
    const o = await engine.resolve(c);
    expect(o.method).not.toBe("ACTIVE_POLICY");
    store.close();
  });

  it("deterministic: vælg mellem + enumerated options auto-resolves", () => {
    const c = makeDecisionCase({
      decisionCaseId: "dc_62",
      decisionType: "PRODUCT_CHOICE",
      sourceText:
        "Vælg mellem: - Champignon - Broccoli - Blomkål - Indisk ost",
      productName: "Fried rice",
    });
    const o = tryDeterministicResolve(c);
    expect(o?.status).toBe("AUTO_RESOLVED_DETERMINISTIC");
    expect(o?.optionId).toBe("product-choice");
  });

  it("deterministic: eller options auto-resolve; slash-only does not", () => {
    const eller = makeDecisionCase({
      decisionCaseId: "dc_59",
      decisionType: "PRODUCT_CHOICE",
      sourceText: "kylling eller oksekød",
    });
    expect(tryDeterministicResolve(eller)?.status).toBe(
      "AUTO_RESOLVED_DETERMINISTIC",
    );
    const slash = makeDecisionCase({
      decisionCaseId: "dc_24",
      decisionType: "PRODUCT_CHOICE",
      sourceText: "skinke/kebab",
    });
    expect(tryDeterministicResolve(slash)).toBeNull();
    expect(classifyChoiceLanguageStrength("skinke/kebab").strength).toBe("WEAK");
  });

  it("MENU BASE+Menu structure resolves without inventing contents", () => {
    const c = makeDecisionCase({
      decisionCaseId: "dc_menu",
      decisionType: "MENU_PRICE_OPTION_SEMANTICS",
      sourceText: "BASE 75 / Menu 125",
      priceOptionLabels: ["BASE", "Menu"],
      options: [
        { id: "variant", label: "Menu variant", effect: "v" },
        { id: "combo-later", label: "combo", effect: "c" },
      ],
    });
    c.contextFeatures = buildDecisionFeatures({
      decisionType: "MENU_PRICE_OPTION_SEMANTICS",
      sourceText: "BASE 75 / Menu 125",
      productName: "X",
      restaurantKey: "veronipizza.dk",
      priceOptionLabels: ["BASE", "Menu"],
    });
    const o = tryDeterministicResolve(c);
    expect(o?.optionId).toBe("variant");
    expect(o?.explanation).toMatch(/not invented/i);
  });
});
