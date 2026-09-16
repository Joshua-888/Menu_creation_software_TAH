import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionStore } from "../../src/decisions/store.js";
import {
  assertGlobalPolicyHasNoFixedMoney,
  kronerToMinor,
} from "../../src/decisions/facts.js";
import { buildAdditionDefinition } from "../../src/decisions/factStore.js";
import { interpretAlmFamilieTotals } from "../../src/decisions/priceSemantics.js";
import {
  resolveEffectivePrice,
  resolveAdditionsForProduct,
  assertNoCrossRestaurantPriceLeak,
} from "../../src/decisions/precedence.js";
import {
  applyAlmFamilieSemantics,
  applyPriceCorrection,
  applyAdditionSetDecision,
  applyChoiceOptionDecision,
  assertMoneyFieldsResolvedForWrite,
} from "../../src/decisions/moneyTransforms.js";
import { DeterministicOperatorParser } from "../../src/decisions/operatorParser.js";
import { applyBatchOperatorAnswer } from "../../src/decisions/batchResolve.js";
import { VERONI_VAELG_SELV_OPTIONS } from "../../src/decisions/choiceLanguage.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";
import { makeDecisionCase } from "./helpers/decisionFixtures.js";

const dirs: string[] = [];
function openStore(): DecisionStore {
  const dir = mkdtempSync(join(tmpdir(), "m63-"));
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

function menuWith(products: Array<{ n: string; name: string }>): CanonicalMenu {
  return {
    restaurantName: "Demo",
    categories: [
      {
        sourceId: "cat-pizza",
        name: "Pizza",
        sourceOrder: 0,
        commonIngredients: [],
        products: products.map((p, i) => ({
          sourceId: `src:${p.n}`,
          categorySourceId: "cat-pizza",
          name: p.name,
          sourceMenuNumber: p.n,
          sourceOrder: i,
          ingredients: [],
          variants: [],
          addOns: [],
          productChoices: [],
          isCombo: false,
          status: "READY" as const,
          issues: [],
          basePrice: 9500,
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

describe("M6.3 price + additions learning", () => {
  it("A — Alm/Familie semantics: 95/185 → base 9500 + Familie 9000", () => {
    const interp = interpretAlmFamilieTotals({
      almTotalKroner: 95,
      familieTotalKroner: 185,
    });
    expect(interp.reconciled).toBe(true);
    expect(interp.basePriceMinor).toBe(9500);
    expect(interp.almSurchargeMinor).toBe(0);
    expect(interp.familieSurchargeMinor).toBe(9000);
    const m = menuWith([{ n: "1", name: "Margherita" }]);
    const r = applyAlmFamilieSemantics({
      menu: m,
      menuNumber: "1",
      almTotalKroner: 95,
      familieTotalKroner: 185,
    });
    expect(r.blocked).toBeUndefined();
    const p = r.menu.categories[0]!.products[0]!;
    expect(p.basePrice).toBe(9500);
    expect(p.variants.find((v) => v.name === "Familie")!.surcharge).toBe(9000);
  });

  it("B — price correction persists and scopes to product only", () => {
    const store = openStore();
    store.facts.insertPriceFact({
      factId: "pf_65",
      factVersion: 1,
      restaurantKey: "veronipizza.dk",
      sourceId: null,
      menuNumber: "65",
      sourceCategory: null,
      destinationCategoryId: null,
      factType: "PRICE_CORRECTION",
      amountMinor: 2500,
      currency: "DKK",
      appliesTo: "menu:65",
      label: "Øl",
      evidenceJson: JSON.stringify({ original: 4500 }),
      humanDecisionId: "hd_1",
      scope: "EXACT_PRODUCT",
      origin: "HUMAN_CORRECTION",
      knowledgeKind: "BUSINESS_FACT",
      supersedesFactId: null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      originalOperatorText: "#65 Øl is 25 kr",
    });
    const hit = resolveEffectivePrice(store.facts, {
      restaurantKey: "veronipizza.dk",
      menuNumber: "65",
      appliesTo: "menu:65",
    });
    expect(hit.amountMinor).toBe(2500);
    expect(hit.source).toBe("EXACT_PRODUCT_FACT");
    const other = resolveEffectivePrice(store.facts, {
      restaurantKey: "other.dk",
      menuNumber: "65",
      appliesTo: "menu:65",
    });
    expect(other.amountMinor).toBeNull();
    let m = menuWith([{ n: "65", name: "Øl" }]);
    m = applyPriceCorrection({
      menu: m,
      menuNumber: "65",
      correctedBaseMinor: 2500,
    }).menu;
    expect(m.categories[0]!.products[0]!.basePrice).toBe(2500);
    store.close();
  });

  it("C — category addition set reuses on matching products", () => {
    const store = openStore();
    store.facts.insertAdditionSet({
      factId: "as_pizza",
      factVersion: 1,
      restaurantKey: "rest-a.dk",
      sourceCategory: "Pizza",
      destinationCategoryId: null,
      scope: "RESTAURANT_CATEGORY",
      additions: [
        buildAdditionDefinition({
          name: "Ekstra ost",
          priceMinor: 1500,
          origin: "HUMAN_PROVIDED_BUSINESS_FACT",
        }),
        buildAdditionDefinition({
          name: "Kebab",
          priceMinor: 2000,
          origin: "HUMAN_PROVIDED_BUSINESS_FACT",
        }),
      ],
      excludedSourceIds: [],
      excludedMenuNumbers: [],
      humanDecisionId: "hd",
      knowledgeKind: "BUSINESS_FACT",
      supersedesFactId: null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      originalOperatorText: "Alle pizzaer: ekstra ost +15, kebab +20",
      evidenceJson: null,
    });
    const r = resolveAdditionsForProduct({
      registry: store.facts,
      restaurantKey: "rest-a.dk",
      sourceCategory: "Pizza",
      sourceId: "src:2",
      menuNumber: "2",
      sourceAdditions: [],
    });
    expect(r.additions.map((a) => a.name)).toEqual(["Ekstra ost", "Kebab"]);
    expect(r.additions[0]!.priceMinor).toBe(1500);
    let m = menuWith([
      { n: "1", name: "Pizza 1" },
      { n: "2", name: "Pizza 2" },
    ]);
    m = applyAdditionSetDecision({
      menu: m,
      menuNumber: "2",
      additions: r.additions,
    }).menu;
    expect(m.categories[0]!.products[1]!.addOns).toHaveLength(2);
    store.close();
  });

  it("D — source price wins over learned fact + conflict recorded", () => {
    const store = openStore();
    store.facts.insertPriceFact({
      factId: "pf_ost",
      factVersion: 1,
      restaurantKey: "rest-a.dk",
      sourceId: null,
      menuNumber: null,
      sourceCategory: "Pizza",
      destinationCategoryId: null,
      factType: "ADDITION_PRICE",
      amountMinor: 1500,
      currency: "DKK",
      appliesTo: "Ekstra ost",
      label: "Ekstra ost",
      evidenceJson: null,
      humanDecisionId: "hd",
      scope: "RESTAURANT_CATEGORY",
      origin: "HUMAN_PROVIDED_BUSINESS_FACT",
      knowledgeKind: "BUSINESS_FACT",
      supersedesFactId: null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      originalOperatorText: null,
    });
    const r = resolveEffectivePrice(store.facts, {
      restaurantKey: "rest-a.dk",
      sourceCategory: "Pizza",
      appliesTo: "Ekstra ost",
      sourceAmountMinor: 2000,
    });
    expect(r.amountMinor).toBe(2000);
    expect(r.source).toBe("CURRENT_EXPLICIT_SOURCE");
    expect(r.conflict?.code).toBe("LEARNED_FACT_CONFLICT_WITH_SOURCE");
    expect(store.facts.listConflicts("rest-a.dk").length).toBeGreaterThan(0);
    store.close();
  });

  it("E — no cross-restaurant fact leak for prices or Veroni options", () => {
    const store = openStore();
    store.facts.insertPriceFact({
      factId: "pf_a",
      factVersion: 1,
      restaurantKey: "rest-a.dk",
      sourceId: null,
      menuNumber: null,
      sourceCategory: "Pizza",
      destinationCategoryId: null,
      factType: "ADDITION_PRICE",
      amountMinor: 1500,
      currency: "DKK",
      appliesTo: "Ekstra ost",
      label: "Ekstra ost",
      evidenceJson: null,
      humanDecisionId: null,
      scope: "RESTAURANT_CATEGORY",
      origin: "HUMAN_PROVIDED_BUSINESS_FACT",
      knowledgeKind: "BUSINESS_FACT",
      supersedesFactId: null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      originalOperatorText: null,
    });
    const b = resolveEffectivePrice(store.facts, {
      restaurantKey: "rest-b.dk",
      sourceCategory: "Pizza",
      appliesTo: "Ekstra ost",
    });
    expect(b.amountMinor).toBeNull();
    expect(() =>
      assertNoCrossRestaurantPriceLeak({
        factsA: store.facts.listActivePriceFacts("rest-a.dk"),
        restaurantB: "rest-b.dk",
        appliesTo: "Ekstra ost",
      }),
    ).toThrow(/CROSS_RESTAURANT/);

    expect(() =>
      assertGlobalPolicyHasNoFixedMoney({
        scope: "GLOBAL",
        knowledgeKind: "BUSINESS_FACT",
        resolution: JSON.stringify({ amountMinor: 1500 }),
        amountMinor: 1500,
      }),
    ).toThrow(/GLOBAL_FIXED_BUSINESS_FACT_NOT_ALLOWED/);

    // Veroni options stay restaurant-scoped
    store.facts.insertChoiceOptionsFact({
      factId: "co_veroni",
      factVersion: 1,
      restaurantKey: "veronipizza.dk",
      sourceCategory: "Durum & Pitabrød",
      scope: "RESTAURANT_CATEGORY",
      prompt: "Vælg selv",
      options: [...VERONI_VAELG_SELV_OPTIONS],
      required: true,
      minSelections: 1,
      maxSelections: 1,
      productTypeHints: ["PITA_DURUM"],
      excludedMenuNumbers: ["38"],
      humanDecisionId: "hd_m62",
      knowledgeKind: "BUSINESS_FACT",
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      originalOperatorText: "Vælg selv options",
    });
    const otherChoices = store.facts.listActiveChoiceOptions("other.dk");
    expect(otherChoices).toHaveLength(0);
    store.close();
  });

  it("F — batch operator answer resolves multiple open cases", async () => {
    const store = openStore();
    const open = ["10", "11", "12"].map((n) =>
      makeDecisionCase({
        decisionCaseId: `dc_${n}`,
        decisionType: "ADDITION_SET",
        restaurantKey: "rest-a.dk",
        menuNumber: n,
        productName: `Pizza ${n}`,
        sourceText: "missing additions",
        sourceCategory: "Pizza",
      }),
    );
    for (const c of open) store.upsertCase(c);
    const batch = await applyBatchOperatorAnswer({
      store,
      facts: store.facts,
      parser: new DeterministicOperatorParser(),
      operatorText:
        "Alle pizzaer har ekstra ost til 15 kr og bacon til 20 kr.",
      restaurantKey: "rest-a.dk",
      knownCategories: ["Pizza", "Grill"],
      openCases: open,
    });
    expect(batch.ambiguities).not.toContain("SCOPE_UNCLEAR_ASK_OPERATOR");
    expect(batch.casesResolved.length).toBe(3);
    expect(batch.questionsAvoided).toBe(2);
    expect(store.facts.listActiveAdditionSets("rest-a.dk").length).toBe(1);
    store.close();
  });

  it("explicit +15 surcharge interprets as 1500 minor — not product total", () => {
    expect(kronerToMinor(15)).toBe(1500);
  });

  it("WritePlan blocks unresolved addition prices", () => {
    expect(() =>
      assertMoneyFieldsResolvedForWrite({
        products: [
          {
            sourceId: "x",
            basePrice: 1000,
            addOns: [{ name: "Ost" }],
          },
        ],
      }),
    ).toThrow(/WRITEPLAN_BLOCKED_UNRESOLVED_MONEY/);
  });

  it("choice option transform applies Veroni five without touching #38", () => {
    let m = menuWith([
      { n: "36", name: "Dürüm" },
      { n: "38", name: "Hvidløgsbrød" },
    ]);
    m = applyChoiceOptionDecision({
      menu: m,
      menuNumber: "36",
      prompt: "Vælg selv",
      options: [...VERONI_VAELG_SELV_OPTIONS],
    }).menu;
    expect(
      m.categories[0]!.products.find((p) => p.sourceMenuNumber === "36")!
        .productChoices[0]!.options,
    ).toHaveLength(5);
    expect(
      m.categories[0]!.products.find((p) => p.sourceMenuNumber === "38")!
        .productChoices,
    ).toHaveLength(0);
  });
});
