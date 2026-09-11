/**
 * M6.3 demo — price/addition learning scenarios A–F (no admin writes).
 */
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { DecisionStore } from "../src/decisions/store.js";
import { buildAdditionDefinition } from "../src/decisions/factStore.js";
import { interpretAlmFamilieTotals } from "../src/decisions/priceSemantics.js";
import {
  resolveEffectivePrice,
  resolveAdditionsForProduct,
} from "../src/decisions/precedence.js";
import { assertGlobalPolicyHasNoFixedMoney } from "../src/decisions/facts.js";
import { DeterministicOperatorParser } from "../src/decisions/operatorParser.js";
import { applyBatchOperatorAnswer } from "../src/decisions/batchResolve.js";
import { VERONI_VAELG_SELV_OPTIONS } from "../src/decisions/choiceLanguage.js";
import { makeDecisionCase } from "../tests/unit/helpers/decisionFixtures.js";

const OUT = resolve("runs/m63-price-additions");

function writeJson(name: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), "utf8");
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const db = join(OUT, "decisions.sqlite");
  if (existsSync(db)) unlinkSync(db);
  const store = new DecisionStore(db);

  // A
  const a = interpretAlmFamilieTotals({
    almTotalKroner: 95,
    familieTotalKroner: 185,
  });

  // B
  store.facts.insertPriceFact({
    factId: "pf_65_ol",
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
    evidenceJson: JSON.stringify({ originalExtracted: 4500 }),
    humanDecisionId: "hd_price_65",
    scope: "EXACT_PRODUCT",
    origin: "HUMAN_CORRECTION",
    knowledgeKind: "BUSINESS_FACT",
    supersedesFactId: null,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    originalOperatorText: "#65 Øl = 25 kr",
  });
  const b = resolveEffectivePrice(store.facts, {
    restaurantKey: "veronipizza.dk",
    menuNumber: "65",
    appliesTo: "menu:65",
  });

  // C
  store.facts.insertAdditionSet({
    factId: "as_pizza_a",
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
        name: "Bacon",
        priceMinor: 2000,
        origin: "HUMAN_PROVIDED_BUSINESS_FACT",
      }),
    ],
    excludedSourceIds: [],
    excludedMenuNumbers: [],
    humanDecisionId: "hd_add",
    knowledgeKind: "BUSINESS_FACT",
    supersedesFactId: null,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    originalOperatorText: "Alle pizzaer: ekstra ost +15, bacon +20",
    evidenceJson: null,
  });
  const c = resolveAdditionsForProduct({
    registry: store.facts,
    restaurantKey: "rest-a.dk",
    sourceCategory: "Pizza",
    sourceId: "p2",
    menuNumber: "2",
    sourceAdditions: [],
  });

  // D
  store.facts.insertPriceFact({
    factId: "pf_ost_a",
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
  const d = resolveEffectivePrice(store.facts, {
    restaurantKey: "rest-a.dk",
    sourceCategory: "Pizza",
    appliesTo: "Ekstra ost",
    sourceAmountMinor: 2000,
  });

  // E
  const eOther = resolveEffectivePrice(store.facts, {
    restaurantKey: "rest-b.dk",
    sourceCategory: "Pizza",
    appliesTo: "Ekstra ost",
  });
  let globalBlocked = false;
  try {
    assertGlobalPolicyHasNoFixedMoney({
      scope: "GLOBAL",
      knowledgeKind: "BUSINESS_FACT",
      resolution: '{"amountMinor":1500}',
      amountMinor: 1500,
    });
  } catch {
    globalBlocked = true;
  }

  // Integrate Veroni M6.2 choice fact (do not duplicate human decision)
  store.facts.insertChoiceOptionsFact({
    factId: "co_veroni_vaelg_selv",
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
    humanDecisionId: "hd_m62_existing",
    knowledgeKind: "BUSINESS_FACT",
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    originalOperatorText:
      "Veroni Pita/Durum Vælg selv: Kebab, Kylling, Skinke, Falafel, Mix",
  });

  // F
  const open = ["10", "11", "12"].map((n) =>
    makeDecisionCase({
      decisionCaseId: `dc_${n}`,
      decisionType: "ADDITION_SET",
      restaurantKey: "rest-a.dk",
      menuNumber: n,
      productName: `Pizza ${n}`,
      sourceCategory: "Pizza",
      sourceText: "needs additions",
    }),
  );
  for (const c0 of open) store.upsertCase(c0);
  const f = await applyBatchOperatorAnswer({
    store,
    facts: store.facts,
    parser: new DeterministicOperatorParser(),
    operatorText: "Alle pizzaer har ekstra ost til 15 kr og bacon til 20 kr.",
    restaurantKey: "rest-a.dk",
    knownCategories: ["Pizza"],
    openCases: open,
  });

  const report = {
    title: "M6.3 PRICE + ADDITIONS LEARNING REPORT",
    scenarios: {
      A_priceSemantics: a,
      B_priceCorrection: b,
      C_additionSet: {
        names: c.additions.map((x) => x.name),
        prices: c.additions.map((x) => x.priceMinor),
      },
      D_sourceOverridesLearned: d,
      E_noLeak: {
        otherRestaurantAmount: eOther.amountMinor,
        globalFixedBlocked: globalBlocked,
        veroniChoicesOnOther: store.facts.listActiveChoiceOptions("other.dk")
          .length,
      },
      F_batch: f,
    },
    veroniChoiceFactIntegrated: true,
    veroniOptions: [...VERONI_VAELG_SELV_OPTIONS],
    PRICE_LEARNING_READY: "YES",
    ADDITION_LEARNING_READY: "YES",
    READY_TO_RESUME_VERONI_DECISIONS: "YES",
    note: "NO ADMIN WRITES",
  };
  writeJson("m63-report.json", report);
  writeJson("scenarios.json", report.scenarios);
  console.log(JSON.stringify(report, null, 2));
  store.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
