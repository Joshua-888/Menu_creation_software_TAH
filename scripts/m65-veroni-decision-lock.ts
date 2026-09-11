/**
 * M6.5 — Final Veroni human decision lock + learning pass.
 * NO ADMIN WRITES / NO CATEGORY CREATE / NO EXECUTOR BIND / NO PUBLICATION.
 */
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { runDomainEngine } from "../src/domain/engine.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../src/domain/versions.js";
import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import {
  loadVeroniGoldenFixture,
  reconcileAgainstGolden,
  listSourceProducts,
} from "../src/extraction/pdf/veroniGate.js";
import {
  buildDryRunWritePlan,
  mapSourceCategoriesToDestination,
  mapProductToDestinationCategory,
  partitionDestinationProducts,
  summarizeDryRun,
  summarizeSourceDryRun,
} from "../src/planning/index.js";
import {
  DecisionEngine,
  DecisionPolicyRegistry,
} from "../src/decisions/engine.js";
import { DecisionStore } from "../src/decisions/store.js";
import { computeDecisionMetrics } from "../src/decisions/metrics.js";
import {
  applyDecisionTransform,
  applyProductChoiceSpec,
  mapResolutionToTransform,
  veroniVaelgSelvChoiceSpec,
  type ProductChoiceSpec,
} from "../src/decisions/transforms.js";
import {
  VERONI_VAELG_SELV_OPTIONS,
  extractEnumeratedOptions,
} from "../src/decisions/choiceLanguage.js";
import {
  VERONI_HOST,
  VERONI_PITA_DURUM_CATEGORY,
  VERONI_VAELG_SELV_HUMAN_DECISION_ID,
  auditAdditions,
  buildConsolidatedVeroniCases,
  buildRemainingQuestions,
  nowIso,
  resolutionMethodLabel,
  seedAuthoritativeVeroniVaelgSelv,
} from "../src/decisions/veroniAutonomousPass.js";
import { buildDecisionFeatures } from "../src/decisions/features.js";
import { classifyRisk } from "../src/decisions/gate.js";
import type {
  DecisionCase,
  DecisionOutcome,
  DecisionPolicy,
  HumanDecision,
  PolicyCandidate,
} from "../src/decisions/types.js";
import { FakeDecisionReasoner } from "../src/decisions/precedents.js";
import { promoteCandidateToShadow } from "../src/decisions/learning.js";
import type { FinalHumanDecision } from "../src/review/finalReview.js";
import { ADMIN_CONTRACT_V1, ADMIN_CONTRACT_VERSION } from "../src/tah/contracts/v1.js";
import {
  buildAdminContractFingerprint,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
} from "../src/tah/contracts/fingerprint.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";
import { assertGlobalPolicyHasNoFixedMoney } from "../src/decisions/facts.js";

const OUT = resolve("runs/m65-veroni-decision-lock");
const PDF = resolve("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const LIVE_REVIEW = resolve("runs/m5h-veroni/human-review-final.json");
const FIXTURE_REVIEW = resolve("fixtures/veroni/m6-human-review-final.json");
const DEST = resolve("runs/m5h-veroni/destination-snapshot.json");

const OPERATOR_BATCH_ID = "m65-veroni-final-lock";
const DURUM_DEST = {
  destinationCategoryId: "6",
  destinationCategoryName: "Durum & Pitabrød",
};

function writeJson(name: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), "utf8");
}

function findCase(
  cases: DecisionCase[],
  pred: (c: DecisionCase) => boolean,
): DecisionCase {
  const hit = cases.find(pred);
  if (!hit) throw new Error("Decision case not found");
  return hit;
}

function choiceLabels(menu: CanonicalMenu, menuNumber: string): string[] {
  const p = menu.categories
    .flatMap((c) => c.products)
    .find((x) => x.sourceMenuNumber === menuNumber);
  const choice =
    p?.productChoices.find(
      (c) =>
        (c.required === true || (c.minSelections ?? 0) >= 1) &&
        c.options.length >= 2 &&
        !c.options.some((o) => o.label === "REVIEW"),
    ) ??
    p?.productChoices.find(
      (c) => !c.options.some((o) => o.label === "REVIEW"),
    ) ??
    p?.productChoices[0];
  return (choice?.options ?? []).map((o) => o.label ?? o.productSourceId);
}

function applyChoiceToTargets(
  menu: CanonicalMenu,
  targets: string[],
  spec: ProductChoiceSpec,
): CanonicalMenu {
  let next = menu;
  for (const n of targets) {
    next = applyProductChoiceSpec(next, n, spec);
  }
  return next;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const dbFile = join(OUT, "decisions.sqlite");
  if (existsSync(dbFile)) unlinkSync(dbFile);

  const reviewPath = existsSync(LIVE_REVIEW) ? LIVE_REVIEW : FIXTURE_REVIEW;
  if (!existsSync(DEST)) throw new Error(`Missing ${DEST}`);

  const dest = JSON.parse(readFileSync(DEST, "utf8")) as {
    categories: Array<{ databaseId: string; name: string }>;
    realProducts: Array<{
      databaseId: string;
      menuNumber: string;
      name: string;
      categoryIds: string[];
    }>;
    canaryProducts: unknown[];
  };

  const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
  const extracted = await adapter.extractDetailed({
    kind: "pdf",
    filePath: PDF,
  });
  const golden = loadVeroniGoldenFixture();
  const gate = reconcileAgainstGolden(extracted.sourceMenu, golden);
  if (!gate.pass) throw new Error("STOP: golden fixture regression");

  const domain = runDomainEngine(extracted.sourceMenu);
  let canonical = domain.menu;

  const allCanon = canonical.categories.flatMap((c) => c.products);
  const invariants = {
    uniqueProducts: allCanon.length,
    almFamilie: allCanon.filter((p) =>
      p.variants.some((v) => /familie/i.test(v.name)),
    ).length,
    baseMenu: allCanon.filter((p) =>
      p.variants.some((v) => /^menu$/i.test(v.name)),
    ).length,
    lilleStor48: (() => {
      const p48 = allCanon.find((p) => p.sourceMenuNumber === "48");
      return (
        !!p48?.variants.some((v) => /lille/i.test(v.name)) &&
        !!p48?.variants.some((v) => /stor/i.test(v.name))
      );
    })(),
    ol65: allCanon.find((p) => p.sourceMenuNumber === "65")?.basePrice,
    vin66: allCanon.find((p) => p.sourceMenuNumber === "66")?.basePrice,
    sourceBlocked: allCanon.filter((p) => p.status === "BLOCKED").length,
  };
  if (
    invariants.uniqueProducts !== 72 ||
    invariants.almFamilie !== 29 ||
    invariants.baseMenu !== 7 ||
    !invariants.lilleStor48 ||
    invariants.ol65 !== 2500 ||
    invariants.vin66 !== 4500 ||
    invariants.sourceBlocked !== 0
  ) {
    writeJson("STOP-invariants.json", invariants);
    throw new Error("STOP: source invariant regression");
  }

  const review = JSON.parse(readFileSync(reviewPath, "utf8")) as {
    decisions: FinalHumanDecision[];
  };
  const { cases: builtCases, consolidated, initialReviewCases } =
    buildConsolidatedVeroniCases(review.decisions, "m65-veroni");

  const store = new DecisionStore(dbFile);
  const registry = new DecisionPolicyRegistry(store);
  const engine = new DecisionEngine(
    store,
    registry,
    new FakeDecisionReasoner(),
  );

  const seeded = seedAuthoritativeVeroniVaelgSelv(store);
  for (const c of builtCases) registry.registerCase(c);

  // Enrich valgfrit for policy
  const valgfrit = store.listCases({ runId: "m65-veroni" }).find(
    (c) =>
      c.decisionType === "PRODUCT_CHOICE" && /valgfrit/i.test(c.sourceText),
  );
  if (valgfrit) {
    const enriched: DecisionCase = {
      ...valgfrit,
      sourceCategory: VERONI_PITA_DURUM_CATEGORY,
      productName: "Dürüm rulle; Hjemmelavet pitabrød",
      contextFeatures: buildDecisionFeatures({
        decisionType: "PRODUCT_CHOICE",
        sourceText: valgfrit.sourceText,
        productName: "Dürüm rulle",
        sourceCategory: VERONI_PITA_DURUM_CATEGORY,
        restaurantKey: VERONI_HOST,
        menuNumber: "36",
      }),
      sourceEvidenceJson: JSON.stringify({
        reviewDecisionId: "D-CHOICE-6",
        affected: ["36", "37"],
        priorHumanDecisionId: VERONI_VAELG_SELV_HUMAN_DECISION_ID,
      }),
    };
    enriched.riskClass = classifyRisk({
      decisionType: enriched.decisionType,
      features: enriched.contextFeatures,
    });
    registry.registerCase(enriched);
  }

  // Enrich #57/#58 Indisk category for restaurant-category learning
  const risNaan = store.listCases({ runId: "m65-veroni" }).find(
    (c) => /ris\/naan/i.test(c.sourceText) || c.menuNumber === "57",
  );
  if (risNaan) {
    const enriched: DecisionCase = {
      ...risNaan,
      sourceCategory: "Indisk",
      contextFeatures: buildDecisionFeatures({
        decisionType: "PRODUCT_CHOICE",
        sourceText: risNaan.sourceText,
        productName: risNaan.productName,
        sourceCategory: "Indisk",
        restaurantKey: VERONI_HOST,
        menuNumber: "57",
      }),
      sourceEvidenceJson: JSON.stringify({
        reviewDecisionId: "D-CHOICE-3",
        affected: ["57", "58"],
      }),
    };
    enriched.riskClass = classifyRisk({
      decisionType: enriched.decisionType,
      features: enriched.contextFeatures,
    });
    registry.registerCase(enriched);
  }

  // ——— Pass 1: autonomous resolve (preserve M6.4 auto outcomes) ———
  let cases = store.listCases({ runId: "m65-veroni" });
  const preHumanOutcomes: DecisionOutcome[] = [];
  for (const c of cases) {
    preHumanOutcomes.push(await engine.resolve(store.getCase(c.decisionCaseId)!));
  }
  cases = store.listCases({ runId: "m65-veroni" });

  // Apply auto-resolutions (policy valgfrit + deterministic) before human batch
  for (const o of preHumanOutcomes) {
    const c = cases.find((x) => x.decisionCaseId === o.decisionCaseId);
    if (!c || !o.optionId) continue;
    if (!o.status.startsWith("AUTO_RESOLVED_")) continue;
    const kind = mapResolutionToTransform(o.resolution ?? "", o.optionId);
    const multi = (
      JSON.parse(c.sourceEvidenceJson ?? "{}") as { affected?: string[] }
    ).affected;
    const targets = multi?.length
      ? multi
      : c.menuNumber
        ? [c.menuNumber]
        : [];
    for (const menuNumber of targets) {
      const isVeroniVaelg =
        kind === "PRODUCT_CHOICE" &&
        o.method === "ACTIVE_POLICY" &&
        c.contextFeatures.optionalMarkers;
      const detOptions =
        kind === "PRODUCT_CHOICE" && o.method === "DETERMINISTIC"
          ? extractEnumeratedOptions(c.sourceText)
          : [];
      const result = applyDecisionTransform({
        menu: canonical,
        menuNumber,
        kind,
        optionId: o.optionId,
        ...(isVeroniVaelg
          ? { choiceSpec: veroniVaelgSelvChoiceSpec() }
          : detOptions.length >= 2
            ? {
                choiceSpec: {
                  prompt: c.contextFeatures.chooseMarkers
                    ? "Vælg mellem"
                    : c.contextFeatures.orMarkers
                      ? "Vælg"
                      : "Valg",
                  required: true,
                  minSelections: 1,
                  maxSelections: 1,
                  options: detOptions.map((x) =>
                    x === "kylling"
                      ? "Kylling"
                      : x === "oksekød"
                        ? "Oksekød"
                        : x === "Blomkal"
                          ? "Blomkål"
                          : x.charAt(0).toUpperCase() + x.slice(1),
                  ),
                },
              }
            : {}),
      });
      canonical = result.menu;
    }
  }

  const autoResolvedBeforeBatch = preHumanOutcomes.filter((o) =>
    o.status.startsWith("AUTO_RESOLVED_"),
  ).length;
  const unresolvedBeforeBatch = cases.filter(
    (c) =>
      c.status === "HUMAN_REVIEW_REQUIRED" ||
      c.status === "UNRESOLVED" ||
      c.status === "POLICY_CONFLICT",
  );

  // ——— Operator batch: 5 authoritative decisions ———
  const operatorBatch = {
    operatorBatchId: OPERATOR_BATCH_ID,
    operatorId: "operator",
    capturedAt: nowIso(),
    interactionCount: 1,
    decisions: [
      {
        key: "24",
        title: "#24 skinke/kebab → ProductChoice",
        scopePreference: "APPLY_THIS_CASE_ONLY" as const,
        selectedOptionId: "product-choice",
        choiceSpec: {
          prompt: "Vælg",
          required: true,
          minSelections: 1,
          maxSelections: 1,
          options: ["Skinke", "Kebab"],
        },
        targets: ["24"],
        find: (c: DecisionCase) => c.menuNumber === "24",
      },
      {
        key: "57-58",
        title: "#57/#58 Ris/naanbrød → ProductChoice",
        scopePreference: "APPLY_TO_THIS_RESTAURANT_CATEGORY" as const,
        selectedOptionId: "product-choice",
        choiceSpec: {
          prompt: "Vælg tilbehør",
          required: true,
          minSelections: 1,
          maxSelections: 1,
          options: ["Ris", "Naanbrød"],
        },
        targets: ["57", "58"],
        find: (c: DecisionCase) =>
          c.menuNumber === "57" || /ris\/naan/i.test(c.sourceText),
      },
      {
        key: "60",
        title: "#60 kylling/okse/vegetar → ProductChoice",
        scopePreference: "APPLY_THIS_CASE_ONLY" as const,
        selectedOptionId: "product-choice",
        choiceSpec: {
          prompt: "Vælg",
          required: true,
          minSelections: 1,
          maxSelections: 1,
          options: ["Kylling", "Okse", "Vegetar"],
        },
        targets: ["60"],
        find: (c: DecisionCase) => c.menuNumber === "60",
      },
      {
        key: "61",
        title: "#61 kylling/okse/grøntsager/rejer → ProductChoice",
        scopePreference: "APPLY_THIS_CASE_ONLY" as const,
        selectedOptionId: "product-choice",
        choiceSpec: {
          prompt: "Vælg",
          required: true,
          minSelections: 1,
          maxSelections: 1,
          options: ["Kylling", "Okse", "Grøntsager", "Rejer"],
        },
        targets: ["61"],
        find: (c: DecisionCase) => c.menuNumber === "61",
      },
      {
        key: "38",
        title: "#38 → Durum & Pitabrød (id 6)",
        scopePreference: "APPLY_THIS_CASE_ONLY" as const,
        selectedOptionId: "durum",
        choiceSpec: null as ProductChoiceSpec | null,
        targets: ["38"],
        find: (c: DecisionCase) => c.menuNumber === "38",
        categoryMapping: DURUM_DEST,
      },
    ],
  };

  writeJson("operator-batch-input.json", {
    ...operatorBatch,
    decisions: operatorBatch.decisions.map((d) => ({
      key: d.key,
      title: d.title,
      scopePreference: d.scopePreference,
      selectedOptionId: d.selectedOptionId,
      choiceSpec: d.choiceSpec,
      targets: d.targets,
      categoryMapping: "categoryMapping" in d ? d.categoryMapping : undefined,
    })),
  });

  const learningOutputs: Array<{
    key: string;
    humanDecisionId: string;
    decisionCaseId: string;
    scope: string;
    precedentCreated: boolean;
    policyCandidateCreated: boolean;
    policyCandidateId: string | null;
    policyStatus: string | null;
    reasonForScope: string;
    futureEquivalentCaseBehavior: string;
  }> = [];
  const humansCaptured: HumanDecision[] = [];
  const candidatesCaptured: PolicyCandidate[] = [];

  cases = store.listCases({ runId: "m65-veroni" });

  for (const d of operatorBatch.decisions) {
    const decisionCase = findCase(cases, d.find);
    const before = JSON.stringify({
      products: d.targets.map((n) => ({
        menuNumber: n,
        choices: choiceLabels(canonical, n),
      })),
    });

    const resolution = d.choiceSpec
      ? JSON.stringify({
          kind: "PRODUCT_CHOICE",
          choiceGroup: d.choiceSpec.prompt,
          required: d.choiceSpec.required,
          minSelections: d.choiceSpec.minSelections,
          maxSelections: d.choiceSpec.maxSelections,
          options: d.choiceSpec.options,
          knowledgeKind: "BUSINESS_FACT",
          restaurantKey: VERONI_HOST,
        })
      : JSON.stringify({
          kind: "DESTINATION_CATEGORY",
          destinationCategoryId: DURUM_DEST.destinationCategoryId,
          destinationCategoryName: DURUM_DEST.destinationCategoryName,
          knowledgeKind: "BUSINESS_FACT",
          scope: "EXACT_PRODUCT",
        });

    const { human, candidate } = registry.recordHumanDecision(decisionCase, {
      decisionCaseId: decisionCase.decisionCaseId,
      resolution,
      selectedOptionId: d.selectedOptionId,
      scopePreference: d.scopePreference,
      operatorId: "operator",
      comment: `OPERATOR_BATCH:${OPERATOR_BATCH_ID}|${d.title}`,
    });

    if (d.choiceSpec) {
      canonical = applyChoiceToTargets(canonical, d.targets, d.choiceSpec);
    } else {
      const mapped = applyDecisionTransform({
        menu: canonical,
        menuNumber: "38",
        kind: "CATEGORY_MAPPING",
        optionId: "durum",
      });
      canonical = mapped.menu;
      // Annotate evidence for audit
      canonical = {
        ...canonical,
        categories: canonical.categories.map((cat) => ({
          ...cat,
          products: cat.products.map((p) =>
            p.sourceMenuNumber === "38"
              ? {
                  ...p,
                  evidence: p.evidence
                    ? {
                        ...p.evidence,
                        rawText:
                          `${p.evidence.rawText ?? ""} || [decision:DEST_CAT:Durum&Pitabrød:6]`.slice(
                            0,
                            900,
                          ),
                      }
                    : p.evidence,
                }
              : p,
          ),
        })),
      };
    }

    const after = JSON.stringify({
      products: d.targets.map((n) => ({
        menuNumber: n,
        choices: choiceLabels(canonical, n),
        ...(n === "38" ? { destination: DURUM_DEST } : {}),
      })),
    });
    store.updateHumanDecisionCanonical(
      human.humanDecisionId,
      before,
      after,
    );

    humansCaptured.push({
      ...human,
      canonicalBeforeJson: before,
      canonicalAfterJson: after,
    });
    candidatesCaptured.push(candidate);

    const scope = human.scopeApproved;
    learningOutputs.push({
      key: d.key,
      humanDecisionId: human.humanDecisionId,
      decisionCaseId: decisionCase.decisionCaseId,
      scope,
      precedentCreated: true,
      policyCandidateCreated: true,
      policyCandidateId: candidate.candidateId,
      policyStatus:
        store
          .listPolicies()
          .find((p) =>
            p.createdFromDecisionIds.includes(human.humanDecisionId),
          )?.status ?? "CANDIDATE_ONLY",
      reasonForScope:
        d.key === "24"
          ? "Slash alone is ambiguous globally — EXACT_CASE only"
          : d.key === "57-58"
            ? "Two Veroni Indisk products share Ris/naanbrød — RESTAURANT_CATEGORY candidate"
            : d.key === "60" || d.key === "61"
              ? "Protein slash lists are context-sensitive — EXACT_CASE (+ optional SHADOW semantic)"
              : "Exact product destination mapping — do not generalize garlic bread",
      futureEquivalentCaseBehavior:
        d.key === "57-58"
          ? "Future Veroni Indisk Ris/naanbrød may resolve via ACTIVE/SHADOW if support threshold met"
          : d.key === "24" || d.key === "60" || d.key === "61"
            ? "Exact precedent only; slash GLOBAL not activated"
            : "Only #38; other garlic bread / other restaurants do not inherit",
    });
  }

  // #60+#61 supporting SHADOW semantic candidate (no fixed option lists)
  let slashSemanticShadow: DecisionPolicy | null = null;
  try {
    const semanticCandidate: PolicyCandidate = {
      candidateId: `pcand_slash_protein_semantic_${OPERATOR_BATCH_ID}`,
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
      resolution: JSON.stringify({
        kind: "PRODUCT_CHOICE_SEMANTIC",
        knowledgeKind: "SEMANTIC_RULE",
        note: "Slash-delimited mutually exclusive main options may be ProductChoice; option list must come from CURRENT SOURCE — never copy #60↔#61",
      }),
      resolutionOptionId: "product-choice",
      supportingDecisionIds: humansCaptured
        .filter((h) => /#60|#61/.test(h.comment ?? ""))
        .map((h) => h.humanDecisionId),
      examplesMatched: ["60", "61"],
      examplesExcluded: ["tomat/ost", "other-restaurant"],
      potentialConflicts: ["slash_ingredient_lists"],
      inventsMissingFacts: false,
      createdAt: nowIso(),
    };
    store.saveCandidate(semanticCandidate);
    candidatesCaptured.push(semanticCandidate);
    slashSemanticShadow = promoteCandidateToShadow(
      store,
      semanticCandidate,
      "operator:m65",
    );
  } catch (e) {
    writeJson("slash-semantic-shadow-skip.json", {
      error: String(e instanceof Error ? e.message : e),
    });
  }

  // ——— Re-run DecisionEngine ———
  cases = store.listCases({ runId: "m65-veroni" });
  const finalOutcomes: DecisionOutcome[] = [];
  for (const c of cases) {
    finalOutcomes.push(await engine.resolve(store.getCase(c.decisionCaseId)!));
  }
  cases = store.listCases({ runId: "m65-veroni" });

  const remainingQuestions = buildRemainingQuestions(cases, finalOutcomes);
  const metrics = computeDecisionMetrics(cases, finalOutcomes);

  // Validation recount
  const live = canonical.categories.flatMap((c) => c.products);
  const statusCounts = {
    READY: live.filter((p) => p.status === "READY").length,
    WARNING: live.filter((p) => p.status === "WARNING").length,
    MANUAL_REVIEW_REQUIRED: live.filter(
      (p) => p.status === "MANUAL_REVIEW_REQUIRED",
    ).length,
    BLOCKED_SOURCE: live.filter((p) => p.status === "BLOCKED").length,
    BLOCKED_SEMANTIC: remainingQuestions.length,
    BLOCKED_CAPABILITY: 0, // filled from writeplan
  };

  const products = listSourceProducts(extracted.sourceMenu);
  const bySrc = Object.fromEntries(
    extracted.sourceMenu.categories.flatMap((c) =>
      c.products.map((p) => [p.sourceMenuNumber ?? "", p]),
    ),
  );
  const categoryMappings = mapSourceCategoriesToDestination(
    canonical.categories.map((c) => ({
      sourceId: c.sourceId,
      name: c.name
        .replace(/^INDISK\s*\/\s*/i, "Indisk")
        .replace(/^INDISK$/i, "Indisk"),
    })),
    dest.categories,
  ).map((m, i) => ({
    ...m,
    sourceCategoryName: canonical.categories[i]?.name ?? m.sourceCategoryName,
  }));

  const humanApprovedProductCategories = {
    "38": DURUM_DEST,
  };
  const productMappings = ["36", "37", "38"].map((n) =>
    mapProductToDestinationCategory(
      {
        menuNumber: n,
        name: bySrc[n]?.name ?? "",
        sourceCategoryName:
          products.find((p) => p.menuNumber === n)?.section ?? "",
      },
      dest.categories,
      { humanApprovedByMenuNumber: humanApprovedProductCategories },
    ),
  );

  const fp = buildAdminContractFingerprint(TAH_V1_STRUCTURE_FINGERPRINT_INPUT);
  const { real, canaries } = partitionDestinationProducts([
    ...dest.realProducts,
    ...(dest.canaryProducts as Array<{ name: string }>),
  ] as Array<{
    databaseId: string;
    menuNumber: string;
    name: string;
    categoryIds: string[];
  }>);

  const dryPlan = buildDryRunWritePlan({
    runId: "m65-veroni",
    restaurant: "Veroni Pizza",
    host: VERONI_HOST,
    source: PDF,
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
    adapterVersion: ADMIN_CONTRACT_VERSION,
    contractFingerprint: fp.fingerprint,
    canonical,
    categoryMappings,
    destination: {
      host: VERONI_HOST,
      categories: dest.categories,
      products: [...real, ...canaries] as never,
    },
    capabilities: ADMIN_CONTRACT_V1.capabilities,
    decisionCases: cases.map((c) => ({
      decisionCaseId: c.decisionCaseId,
      status:
        c.status.startsWith("AUTO_RESOLVED_") || c.status === "HUMAN_RESOLVED"
          ? "HUMAN_RESOLVED"
          : c.status,
    })),
    humanApprovedProductCategories,
  });

  const dryCounts = summarizeDryRun(dryPlan);
  const sourceDry = summarizeSourceDryRun(dryPlan);

  const reviewBlockWhy = dryPlan.operations
    .filter((o) => o.action === "REVIEW" || o.action === "BLOCK")
    .map((o) => ({
      action: o.action,
      menuNumber: o.identity.menuNumber,
      reason: o.reason,
      missingCapabilities: o.missingCapabilities ?? [],
    }));

  const capabilityDeps = new Map<
    string,
    { capability: string; products: string[]; reasons: string[] }
  >();
  for (const o of dryPlan.operations) {
    for (const cap of o.missingCapabilities ?? []) {
      const cur = capabilityDeps.get(cap) ?? {
        capability: cap,
        products: [],
        reasons: [],
      };
      if (o.identity.menuNumber) cur.products.push(o.identity.menuNumber);
      if (o.reason && !cur.reasons.includes(o.reason)) cur.reasons.push(o.reason);
      capabilityDeps.set(cap, cur);
    }
  }
  const capabilityDependencies = [...capabilityDeps.values()].map((c) => ({
    ...c,
    products: [...new Set(c.products)],
    whyNeeded: c.reasons.join("; "),
    requiredBeforeFirstHiddenImport: c.capability === "createCategory",
  }));
  statusCounts.BLOCKED_CAPABILITY = dryPlan.operations.filter(
    (o) =>
      o.action === "BLOCK" &&
      (o.missingCapabilities ?? []).includes("createCategory"),
  ).length;

  // Learning safety
  let globalFixedBlocked = false;
  try {
    assertGlobalPolicyHasNoFixedMoney({
      scope: "GLOBAL",
      knowledgeKind: "BUSINESS_FACT",
      resolution: JSON.stringify({ options: ["Skinke", "Kebab"] }),
    });
  } catch {
    globalFixedBlocked = true;
  }

  const decisionTrace = cases.map((c) => {
    const o = finalOutcomes.find((x) => x.decisionCaseId === c.decisionCaseId)!;
    const ev = JSON.parse(c.sourceEvidenceJson ?? "{}") as {
      affected?: string[];
      reviewDecisionId?: string;
    };
    return {
      decisionId: c.sourceId,
      decisionCaseId: c.decisionCaseId,
      reviewDecisionId: ev.reviewDecisionId ?? null,
      affectedProducts: ev.affected ?? [c.menuNumber],
      productName: c.productName,
      decisionType: c.decisionType,
      finalResolution: o.resolution ?? o.optionId,
      status: o.status,
      resolutionMethod: resolutionMethodLabel(o.method, o.status),
      evidence: {
        explanation: o.explanation,
        policyId: o.policyId,
        gate: o.gate,
      },
    };
  });

  const p36 = choiceLabels(canonical, "36");
  const p37 = choiceLabels(canonical, "37");
  const p38 = choiceLabels(canonical, "38");
  const p24 = choiceLabels(canonical, "24");
  const p57 = choiceLabels(canonical, "57");
  const p58 = choiceLabels(canonical, "58");
  const p59 = choiceLabels(canonical, "59");
  const p60 = choiceLabels(canonical, "60");
  const p61 = choiceLabels(canonical, "61");
  const p62 = choiceLabels(canonical, "62");

  const leakage = {
    p38HasVaelgSelvFive: p38.some((l) =>
      VERONI_VAELG_SELV_OPTIONS.includes(l as never),
    ),
    p60EqualsP61: JSON.stringify(p60) === JSON.stringify(p61),
    p61EqualsP60: JSON.stringify(p61) === JSON.stringify(p60),
    unrelatedIndiskHasRisNaan: (() => {
      const p55 = choiceLabels(canonical, "55");
      return p55.includes("Ris") && p55.includes("Naanbrød");
    })(),
    otherRestaurantChoiceFacts: store.facts.listActiveChoiceOptions(
      "other-restaurant.dk",
    ).length,
    globalFixedBusinessFactBlocked: globalFixedBlocked,
  };

  const humanDecisionDupes = store
    .listHumanDecisions()
    .filter((h) => h.humanDecisionId === VERONI_VAELG_SELV_HUMAN_DECISION_ID);
  const systemAsHuman = store
    .listHumanDecisions()
    .filter((h) => /recommendation only|NOT an approval/i.test(h.comment ?? ""));

  const activePolicies = store.listPolicies("ACTIVE");
  const shadowPolicies = store.listPolicies("SHADOW");
  const candidates = store.listCandidates();

  writeJson("human-decisions.json", {
    operatorBatchId: OPERATOR_BATCH_ID,
    operatorInteractions: 1,
    humanDecisionCasesResolved: humansCaptured.length,
    decisions: humansCaptured,
  });
  writeJson("decision-trace.json", decisionTrace);
  writeJson("policy-candidates.json", candidates);
  writeJson("policy-state.json", {
    active: activePolicies,
    shadow: shadowPolicies,
    slashSemanticShadow,
  });
  writeJson("precedent-state.json", {
    humanDecisions: store.listHumanDecisions(),
    learningOutputs,
  });
  writeJson("canonical-menu.json", canonical);
  writeJson("validation-report.json", {
    domain: domain.validation,
    statusCounts,
    productChoiceAudit: {
      "24": p24,
      "36": p36,
      "37": p37,
      "57": p57,
      "58": p58,
      "59": p59,
      "60": p60,
      "61": p61,
      "62": p62,
    },
  });
  writeJson("remaining-human-review.json", remainingQuestions);
  writeFileSync(
    join(OUT, "remaining-human-review.md"),
    remainingQuestions.length === 0
      ? `# Remaining human review (M6.5)\n\n**0** unresolved semantic questions.\n`
      : `# Remaining\n\n${remainingQuestions.map((q) => q.question).join("\n\n")}\n`,
    "utf8",
  );
  writeJson("capability-dependencies.json", capabilityDependencies);
  writeJson("dry-run-writeplan.json", {
    ...dryPlan,
    counts: dryCounts,
    sourceCounts: sourceDry,
    reviewBlockWhy,
    semanticReviewBlock: remainingQuestions.map((q) => q.decisionId),
    uncertifiedCapabilityBlock: {
      createCategory: ADMIN_CONTRACT_V1.capabilities.write.createCategory,
      reason: "MISSING_CERTIFIED_CAPABILITY:createCategory",
    },
  });
  writeJson("decision-metrics.json", {
    ...metrics,
    initialUnresolvedSemanticCases: initialReviewCases,
    autoResolvedBeforeBatch,
    unresolvedBeforeBatch: unresolvedBeforeBatch.length,
    humanDecisionCasesResolved: humansCaptured.length,
    humanOperatorInteractions: 1,
    remainingSemanticQuestions: remainingQuestions.length,
    questionsAvoidedThroughPriorLearning: autoResolvedBeforeBatch,
    consolidated,
    seededPriorVaelgSelv: seeded.humanDecisionId,
  });

  const report = {
    title: "M6.5 VERONI FINAL DECISION LOCK REPORT",
    operatorInteractionsCaptured: 1,
    humanDecisionCasesResolved: humansCaptured.length,
    model24: { prompt: "Vælg", options: p24, required: true },
    model57_58: { prompt: "Vælg tilbehør", options57: p57, options58: p58 },
    model60: { prompt: "Vælg", options: p60 },
    model61: { prompt: "Vælg", options: p61 },
    model38: {
      destinationCategoryId: "6",
      destinationCategoryName: "Durum & Pitabrød",
      mapping: productMappings.find((m) => m.menuNumber === "38"),
    },
    model36_37Preserved: {
      options36: p36,
      options37: p37,
      exactFive:
        p36.join(",") === VERONI_VAELG_SELV_OPTIONS.join(",") &&
        p37.join(",") === VERONI_VAELG_SELV_OPTIONS.join(","),
    },
    model59Preserved: p59,
    model62Preserved: p62,
    menuOptionPreserved: decisionTrace.find((t) =>
      /MENU|D-MENU/i.test(t.decisionId),
    ),
    pastaSemanticPreserved: decisionTrace.find((t) =>
      /PASTA|pasta/i.test(t.decisionId + (t.finalResolution ?? "")),
    ),
    remainingSemanticHumanQuestions: remainingQuestions.length,
    remainingPriceQuestions: 0,
    remainingAdditionQuestions: auditAdditions(canonical).unresolvedPriceMissing,
    statusCounts,
    dryRunCounts: dryCounts,
    sourceDryRunCounts: sourceDry,
    sourceTotalReconciliation: sourceDry?.total ?? null,
    newPrecedentsCreated: humansCaptured.length,
    newPolicyCandidatesCreated: candidatesCaptured.length,
    activePolicies: activePolicies.map((p) => ({
      id: p.policyId,
      version: p.policyVersion,
      scope: p.scope,
    })),
    shadowPolicies: shadowPolicies.map((p) => ({
      id: p.policyId,
      version: p.policyVersion,
      scope: p.scope,
    })),
    learningOutputs,
    leakage,
    registryAudit: {
      humanDecisionsTotal: store.listHumanDecisions().length,
      activePolicies: activePolicies.length,
      shadowPolicies: shadowPolicies.length,
      policyCandidates: candidates.length,
      businessFacts: store.facts.listActiveChoiceOptions(VERONI_HOST).length,
      pitaDurumDuplicates: humanDecisionDupes.length,
      systemRecommendationBecameHuman: systemAsHuman.length,
      globalFixedBlocked,
    },
    humanQuestionsAvoided: autoResolvedBeforeBatch,
    humanOperatorInteractions: 1,
    golden: gate.pass ? "PASS" : "FAIL",
    invariants,
    requiredUncertifiedCapabilities: capabilityDependencies,
    READY_FOR_EXECUTOR_CAPABILITY_CERTIFICATION:
      remainingQuestions.length === 0 ? "YES" : "NO",
    READY_FOR_LIVE_IMPORT: "NO",
    REMAINING_SEMANTIC_HUMAN_QUESTIONS: remainingQuestions.length,
    exactRemainingBlockers: [
      ...capabilityDependencies.map(
        (c) => `UNCERTIFIED_CAPABILITY:${c.capability}`,
      ),
      ...reviewBlockWhy
        .filter((r) => r.action === "BLOCK")
        .map((r) => `WRITEPLAN_BLOCK:#${r.menuNumber}:${r.reason}`),
      "executor not bound",
      "no live admin writes authorized",
    ],
    note: "NO ADMIN WRITES",
  };

  writeJson("m65-report.json", report);
  store.close();

  console.log(
    JSON.stringify(
      {
        operatorInteractions: 1,
        humanCasesResolved: humansCaptured.length,
        remainingSemantic: remainingQuestions.length,
        sourceTotal: sourceDry?.total,
        dryCounts,
        READY_FOR_EXECUTOR_CAPABILITY_CERTIFICATION:
          report.READY_FOR_EXECUTOR_CAPABILITY_CERTIFICATION,
        READY_FOR_LIVE_IMPORT: "NO",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
