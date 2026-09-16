/**
 * Apply accepted Bella human decisions via DecisionStore + typed transforms,
 * then rerun RAW → extract → intelligence → quality. No admin writes.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import { runDomainEngine } from "../src/domain/engine.js";
import { normalizeSourceCategoriesByKind } from "../src/learning/categoryKindNaming.js";
import { loadPeerSnapshots } from "../src/learning/peerArtifacts.js";
import { runMenuIntelligence } from "../src/intelligence/menuIntelligenceEngine.js";
import { DecisionStore } from "../src/decisions/store.js";
import { DecisionPolicyRegistry } from "../src/decisions/engine.js";
import { applyChoiceOptionDecision } from "../src/decisions/moneyTransforms.js";
import { buildDecisionFeatures } from "../src/decisions/features.js";
import { classifyRisk } from "../src/decisions/gate.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
} from "../src/decisions/versions.js";
import type {
  CanonicalMenu,
  CanonicalProduct,
} from "../src/domain/schema/canonical.js";
import type {
  DecisionCase,
  DecisionType,
  HumanReviewAnswer,
} from "../src/decisions/types.js";
import type { ChoiceOptionsFact } from "../src/decisions/facts.js";

const root = process.cwd();
const rawPath = resolve(root, "fixtures/golden/bella-kebab/raw-source.jpeg");
const outDir = resolve(root, "runs/bella-recovery-prep");
mkdirSync(outDir, { recursive: true });
mkdirSync(resolve(root, "runs/decisions"), { recursive: true });

const previousTarget = JSON.parse(
  readFileSync(resolve(outDir, "bella-target-menu.json"), "utf8"),
);
const previousHash = createHash("sha256")
  .update(JSON.stringify(previousTarget))
  .digest("hex");

const restaurantKey = "bellakebab.dk";
const restaurantName = "Bella Kebab";
const now = new Date().toISOString();
const operatorId = "operator-recovery-prep";

const decisionDb = resolve(root, "runs/decisions/bella-recovery-decisions.sqlite");
const store = new DecisionStore(decisionDb);
const registry = new DecisionPolicyRegistry(store);

function makeCase(input: {
  decisionCaseId: string;
  decisionType: DecisionType;
  menuNumber: string | null;
  productName: string;
  sourceCategory: string | null;
  sourceEvidence: string;
  options: Array<{ id: string; label: string; effect?: string }>;
  recommendedOptionId: string;
}): DecisionCase {
  const sourceText = input.sourceEvidence;
  const features = buildDecisionFeatures({
    decisionType: input.decisionType,
    sourceText,
    productName: input.productName,
    sourceCategory: input.sourceCategory ?? "Menu",
    restaurantKey,
    menuNumber: input.menuNumber ?? "0",
    priceOptionLabels: [],
  });
  return {
    decisionCaseId: input.decisionCaseId,
    runId: "bella-recovery-prep-accept",
    sourceId: `src:bella:${input.decisionCaseId}`,
    restaurantId: restaurantKey,
    restaurantKey,
    host: restaurantKey,
    menuNumber: input.menuNumber,
    productName: input.productName,
    sourceCategory: input.sourceCategory,
    destinationCategoryCandidate: null,
    decisionType: input.decisionType,
    sourceText,
    normalizedSourceText: sourceText.toLowerCase(),
    contextFeatures: features,
    sourceEvidenceJson: JSON.stringify({ text: input.sourceEvidence }),
    currentCanonicalInterpretation: "pending_operator_accept",
    availableOptions: input.options,
    recommendedOptionId: input.recommendedOptionId,
    recommendedRationale: "Operator ACCEPT of recovery-prep recommendation",
    isSystemRecommendationOnly: true,
    status: "HUMAN_REVIEW_REQUIRED",
    riskClass: classifyRisk({
      decisionType: input.decisionType,
      features,
    }),
    resolutionId: null,
    resolutionMethod: null,
    explanationJson: null,
    createdAt: now,
    updatedAt: now,
    decisionEngineVersion: DECISION_ENGINE_VERSION,
    schemaVersion: DECISION_SCHEMA_VERSION,
  };
}

function recordAccept(input: {
  decisionCaseId: string;
  decisionType: DecisionType;
  menuNumber: string | null;
  productName: string;
  sourceCategory: string | null;
  sourceEvidence: string;
  resolution: string;
  selectedOptionId: string;
  scopePreference: HumanReviewAnswer["scopePreference"];
  options: Array<{ id: string; label: string; effect?: string }>;
}) {
  const c = makeCase({
    decisionCaseId: input.decisionCaseId,
    decisionType: input.decisionType,
    menuNumber: input.menuNumber,
    productName: input.productName,
    sourceCategory: input.sourceCategory,
    sourceEvidence: input.sourceEvidence,
    options: input.options,
    recommendedOptionId: input.selectedOptionId,
  });
  registry.registerCase(c);
  const answer: HumanReviewAnswer = {
    decisionCaseId: input.decisionCaseId,
    resolution: input.resolution,
    selectedOptionId: input.selectedOptionId,
    scopePreference: input.scopePreference,
    operatorId,
    comment: "Operator ACCEPT of recommended recovery-prep decision",
  };
  return registry.recordHumanDecision(c, answer);
}

// 1) Combo contents — restaurant scope
const comboHuman = recordAccept({
  decisionCaseId: `dc_bella_combo_${randomUUID()}`,
  decisionType: "COMBO_SEMANTICS",
  menuNumber: null,
  productName: "Menu combo products",
  sourceCategory: "Menu",
  sourceEvidence:
    "Durum/Lille/Stor pita menus: Kebab, sodavand og pomfritter. Pomfrit+nuggets menu: Ketchup el. salat mayonnaise; title implies fries+nuggets.",
  resolution:
    "FIXED_COMBO_CONTENTS_FROM_SOURCE: durum/pita menus = kebab+sodavand+pomfritter; nuggets menu = pomfritter+nuggets + dressing choice",
  selectedOptionId: "accept_fixed_combo_contents",
  scopePreference: "APPLY_TO_THIS_RESTAURANT",
  options: [
    {
      id: "accept_fixed_combo_contents",
      label: "Accept source-supported fixed combo contents",
      effect: "fixed_combo_contents",
    },
  ],
});

// 2) Durum Kebab ingredients/choice — single product
const durumHuman = recordAccept({
  decisionCaseId: `dc_bella_durum_kebab_${randomUUID()}`,
  decisionType: "PRODUCT_CHOICE",
  menuNumber: "21",
  productName: "Durum Kebab",
  sourceCategory: "Durum",
  sourceEvidence:
    "Printed: Creme fraiche dressing el. tahin dressing under Durum Kebab",
  resolution: "PRODUCT_CHOICE",
  selectedOptionId: "product-choice",
  scopePreference: "APPLY_THIS_CASE_ONLY",
  options: [
    {
      id: "product-choice",
      label: "Dressing ProductChoice + Kebab protein",
      effect: "choice",
    },
  ],
});

const dressingFact: ChoiceOptionsFact = {
  factId: `cof_${randomUUID()}`,
  factVersion: 1,
  restaurantKey,
  sourceCategory: "Durum",
  scope: "EXACT_PRODUCT",
  prompt: "Dressing",
  options: ["Creme fraiche dressing", "Tahin dressing"],
  required: true,
  minSelections: 1,
  maxSelections: 1,
  productTypeHints: ["Durum Kebab"],
  excludedMenuNumbers: [],
  humanDecisionId: durumHuman.human.humanDecisionId,
  knowledgeKind: "BUSINESS_FACT",
  status: "ACTIVE",
  createdAt: now,
  originalOperatorText:
    "ACCEPT bella-review-durum-kebab-ingredients: Kebab + dressing choice",
};
store.facts.insertChoiceOptionsFact(dressingFact);

function patchProduct(
  menu: CanonicalMenu,
  match: (p: CanonicalProduct) => boolean,
  patch: (p: CanonicalProduct) => CanonicalProduct,
): CanonicalMenu {
  return {
    ...menu,
    categories: menu.categories.map((c) => ({
      ...c,
      products: c.products.map((p) => (match(p) ? patch(p) : p)),
    })),
  };
}

function setIngredients(
  p: CanonicalProduct,
  names: string[],
  decisionTag: string,
): CanonicalProduct {
  return {
    ...p,
    ingredients: names.map((display) => ({
      display,
      origin: "HUMAN_CORRECTION" as const,
    })),
    description: names.length
      ? names.length === 1
        ? names[0]!
        : names.length === 2
          ? `${names[0]} og ${names[1]}`
          : `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`
      : p.description,
    evidence: p.evidence
      ? {
          ...p.evidence,
          rawText:
            `${p.evidence.rawText ?? ""} || [human-decision:${decisionTag}]`.slice(
              0,
              900,
            ),
        }
      : p.evidence,
  };
}

const adapter = new PdfSourceAdapter({ restaurantName });
const extraction = await adapter.extractDetailed({
  kind: "image",
  filePath: rawPath,
});
const peers = loadPeerSnapshots(root);
const named = normalizeSourceCategoriesByKind(extraction.sourceMenu, peers);
const domain = runDomainEngine(named);
let menu = domain.menu;

// Apply accepted combo contents via ProductChoices.
// pommes/nuggets/sodavand are classified PRODUCT_NAME and stripped from ingredients by
// completeProductCard — COMBO_STRUCTURE_VALID clears when productChoices.length > 0.
for (const productName of [
  "Durum menu",
  "Lille pita brød menu",
  "Stor pita brød menu",
]) {
  menu = patchProduct(
    menu,
    (p) => p.name.trim().toLowerCase() === productName.toLowerCase(),
    (p) => ({
      ...setIngredients(
        p,
        ["Kebab"],
        "bella-review-combo-contents",
      ),
      isCombo: true,
      productChoices: [
        {
          sourceId: `${p.sourceId}::choice-menu-indhold`,
          prompt: "Menu inkluderer",
          required: true,
          minSelections: 1,
          maxSelections: 1,
          options: [
            {
              productSourceId: `${p.sourceId}::inkl-kebab-soda-pommes`,
              label: "Kebab, sodavand og pomfritter",
            },
          ],
        },
      ],
      evidence: p.evidence
        ? {
            ...p.evidence,
            rawText:
              `${p.evidence.rawText ?? ""} || [human-decision:bella-review-combo-contents:fixed=kebab+sodavand+pomfritter]`.slice(
                0,
                900,
              ),
          }
        : p.evidence,
    }),
  );
}

// Nuggets menu: fries+nuggets implied by title; dressing choice from source
menu = patchProduct(
  menu,
  (p) => /pomfrit og 6 nuggets menu/i.test(p.name),
  (p) => ({
    ...p,
    isCombo: true,
    productChoices: [
      {
        sourceId: `${p.sourceId}::choice-dressing`,
        prompt: "Dressing",
        required: true,
        minSelections: 1,
        maxSelections: 1,
        options: [
          {
            productSourceId: `${p.sourceId}::ketchup`,
            label: "Ketchup",
          },
          {
            productSourceId: `${p.sourceId}::salatmayo`,
            label: "Salat mayonnaise",
          },
        ],
      },
    ],
    evidence: p.evidence
      ? {
          ...p.evidence,
          rawText:
            `${p.evidence.rawText ?? ""} || [human-decision:bella-review-combo-contents:pomfrit+nuggets+dressing]`.slice(
              0,
              900,
            ),
        }
      : p.evidence,
  }),
);

{
  const nuggets = menu.categories
    .flatMap((c) => c.products)
    .find((p) => /pomfrit og 6 nuggets menu/i.test(p.name));
  const num = nuggets?.sourceMenuNumber ?? nuggets?.assignedMenuNumber;
  if (num) {
    menu = applyChoiceOptionDecision({
      menu,
      menuNumber: String(num),
      prompt: "Dressing",
      options: ["Ketchup", "Salat mayonnaise"],
    }).menu;
  }
}

// Durum Kebab: Kebab + dressing ProductChoice
menu = patchProduct(
  menu,
  (p) => /^durum kebab$/i.test(p.name.trim()),
  (p) => {
    const withIng = setIngredients(
      p,
      ["Kebab", "Creme fraiche dressing"],
      "bella-review-durum-kebab-ingredients",
    );
    return {
      ...withIng,
      productChoices: [
        {
          sourceId: `${p.sourceId}::choice-dressing`,
          prompt: "Dressing",
          required: true,
          minSelections: 1,
          maxSelections: 1,
          options: [
            {
              productSourceId: `${p.sourceId}::creme`,
              label: "Creme fraiche dressing",
            },
            {
              productSourceId: `${p.sourceId}::tahin`,
              label: "Tahin dressing",
            },
          ],
        },
      ],
    };
  },
);

// Also apply via menuNumber path for Durum Kebab if numbered
{
  const durum = menu.categories
    .flatMap((c) => c.products)
    .find((p) => /^durum kebab$/i.test(p.name.trim()));
  const num = durum?.sourceMenuNumber ?? durum?.assignedMenuNumber;
  if (num) {
    menu = applyChoiceOptionDecision({
      menu,
      menuNumber: num,
      prompt: "Dressing",
      options: ["Creme fraiche dressing", "Tahin dressing"],
    }).menu;
  }
}

const intelligence = runMenuIntelligence({
  mode: "CREATE_MENU",
  restaurantName,
  restaurantKey,
  canonicalMenu: menu,
  decisionStore: store,
});

const quality = intelligence.quality;
const targetMenu = intelligence.targetMenu;
const targetHash = createHash("sha256")
  .update(JSON.stringify(targetMenu))
  .digest("hex");

const remaining = quality.products.filter((p) => p.status !== "QUALITY_READY");

// Rebuild recovery plan hashes with new target
const planPath = resolve(outDir, "BELLA_RECOVERY_PLAN.json");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
plan.hashes.targetMenuHash = targetHash;
plan.qualityGate = {
  ready: quality.statusAccounting.ready,
  review: quality.statusAccounting.review,
  blocked: quality.statusAccounting.blocked,
  menuStatus: quality.menuStatus,
  writeEligible:
    quality.statusAccounting.review === 0 &&
    quality.statusAccounting.blocked === 0,
};
plan.decisionsReceived = [
  {
    decisionId: "bella-review-combo-contents",
    status: "ACCEPTED",
    humanDecisionId: comboHuman.human.humanDecisionId,
    appliedAt: now,
  },
  {
    decisionId: "bella-review-durum-kebab-ingredients",
    status: "ACCEPTED",
    humanDecisionId: durumHuman.human.humanDecisionId,
    appliedAt: now,
  },
];
plan.remainingReviewOrBlocked = remaining.map((p) => ({
  menuNumber: p.menuNumber,
  name: p.name,
  status: p.status,
  failedChecks: p.checks.filter((c) => !c.pass).map((c) => c.id),
  blockers: p.blockers,
}));
const { recoveryPlanHash: _old, ...hashesWithoutRecovery } = plan.hashes;
void _old;
plan.hashes = hashesWithoutRecovery;
const recoveryPlanHash = createHash("sha256")
  .update(JSON.stringify(plan))
  .digest("hex");
plan.hashes.recoveryPlanHash = recoveryPlanHash;

writeFileSync(planPath, JSON.stringify(plan, null, 2));
writeFileSync(
  resolve(outDir, "bella-target-menu.json"),
  JSON.stringify(targetMenu, null, 2),
);
writeFileSync(
  resolve(outDir, "bella-quality.json"),
  JSON.stringify(quality, null, 2),
);
writeFileSync(
  resolve(outDir, "bella-human-decisions-applied.json"),
  JSON.stringify(
    {
      appliedAt: now,
      comboHumanDecisionId: comboHuman.human.humanDecisionId,
      durumHumanDecisionId: durumHuman.human.humanDecisionId,
      dressingFactId: dressingFact.factId,
      decisionDb,
    },
    null,
    2,
  ),
);

store.close();

console.log(
  JSON.stringify(
    {
      READY: quality.statusAccounting.ready,
      REVIEW: quality.statusAccounting.review,
      BLOCKED: quality.statusAccounting.blocked,
      TARGETMENU_HASH: targetHash,
      RECOVERY_PLAN_HASH: recoveryPlanHash,
      DID_TARGETMENU_CHANGE: targetHash !== previousHash,
      FULL_LIST_OF_ANY_REMAINING_REVIEW_OR_BLOCKED_ITEMS: remaining.map(
        (p) => ({
          menuNumber: p.menuNumber,
          name: p.name,
          status: p.status,
          failed: p.checks
            .filter((c) => !c.pass)
            .map((c) => `${c.id}: ${c.detail ?? ""}`),
        }),
      ),
      PREVIOUS_TARGETMENU_HASH: previousHash,
    },
    null,
    2,
  ),
);
