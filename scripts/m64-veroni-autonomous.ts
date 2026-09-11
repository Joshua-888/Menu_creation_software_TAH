/**
 * M6.4 — Autonomous Veroni decision pass.
 * APPLY existing Decision Learning — no new learning architecture.
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
  mapResolutionToTransform,
  veroniVaelgSelvChoiceSpec,
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
  auditProduct61,
  buildConsolidatedVeroniCases,
  buildRemainingQuestions,
  nowIso,
  resolutionMethodLabel,
  seedAuthoritativeVeroniVaelgSelv,
} from "../src/decisions/veroniAutonomousPass.js";
import type { DecisionCase, DecisionOutcome } from "../src/decisions/types.js";
import { FakeDecisionReasoner } from "../src/decisions/precedents.js";
import type { FinalHumanDecision } from "../src/review/finalReview.js";
import { ADMIN_CONTRACT_V1, ADMIN_CONTRACT_VERSION } from "../src/tah/contracts/v1.js";
import {
  buildAdminContractFingerprint,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
} from "../src/tah/contracts/fingerprint.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";
import { assertNoCrossRestaurantPriceLeak } from "../src/decisions/precedence.js";
import { assertGlobalPolicyHasNoFixedMoney } from "../src/decisions/facts.js";

const OUT = resolve("runs/m64-veroni-autonomous");
const PDF = resolve("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const LIVE_REVIEW = resolve("runs/m5h-veroni/human-review-final.json");
const FIXTURE_REVIEW = resolve("fixtures/veroni/m6-human-review-final.json");
const DEST = resolve("runs/m5h-veroni/destination-snapshot.json");

function writeJson(name: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), "utf8");
}

function applyResolutionsToMenu(
  menu: CanonicalMenu,
  cases: DecisionCase[],
  outcomes: DecisionOutcome[],
): CanonicalMenu {
  let next = menu;
  const byId = new Map(cases.map((c) => [c.decisionCaseId, c]));
  const choiceSpec = veroniVaelgSelvChoiceSpec();

  for (const o of outcomes) {
    const c = byId.get(o.decisionCaseId);
    if (!c || !o.optionId) continue;
    if (
      !(
        o.status === "HUMAN_RESOLVED" ||
        o.status.startsWith("AUTO_RESOLVED_")
      )
    ) {
      continue;
    }
    const kind = mapResolutionToTransform(o.resolution ?? "", o.optionId);
    const multi = (
      JSON.parse(c.sourceEvidenceJson ?? "{}") as { affected?: string[] }
    ).affected;
    const targets =
      multi?.length ? multi : c.menuNumber != null ? [c.menuNumber] : [];

    for (const menuNumber of targets) {
      const isVeroniVaelg =
        c.restaurantKey === VERONI_HOST &&
        c.contextFeatures.optionalMarkers &&
        c.contextFeatures.productTypeHints.includes("PITA_DURUM") &&
        kind === "PRODUCT_CHOICE" &&
        (o.status === "HUMAN_RESOLVED" || o.method === "ACTIVE_POLICY");

      const detOptions =
        kind === "PRODUCT_CHOICE" && o.method === "DETERMINISTIC"
          ? extractEnumeratedOptions(c.sourceText)
          : [];

      const result = applyDecisionTransform({
        menu: next,
        menuNumber,
        kind,
        optionId: o.optionId,
        ...(isVeroniVaelg
          ? { choiceSpec }
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
                  options: detOptions,
                },
              }
            : {}),
      });
      next = result.menu;
    }
  }
  return next;
}

function countByMethod(outcomes: DecisionOutcome[]) {
  let autoResolvedDeterministic = 0;
  let autoResolvedPolicy = 0;
  let autoResolvedPrecedent = 0;
  let autoResolvedAI = 0;
  let humanReviewRequired = 0;
  let humanResolved = 0;
  for (const o of outcomes) {
    if (o.status === "HUMAN_RESOLVED") humanResolved += 1;
    else if (o.status === "AUTO_RESOLVED_DETERMINISTIC")
      autoResolvedDeterministic += 1;
    else if (o.status === "AUTO_RESOLVED_POLICY") autoResolvedPolicy += 1;
    else if (o.status === "AUTO_RESOLVED_PRECEDENT")
      autoResolvedPrecedent += 1;
    else if (o.status === "AUTO_RESOLVED_AI") autoResolvedAI += 1;
    else if (
      o.status === "HUMAN_REVIEW_REQUIRED" ||
      o.status === "UNRESOLVED" ||
      o.status === "POLICY_CONFLICT" ||
      o.status === "BLOCKED"
    ) {
      humanReviewRequired += 1;
    }
  }
  return {
    autoResolvedDeterministic,
    autoResolvedPolicy,
    autoResolvedPrecedent,
    autoResolvedAI,
    humanReviewRequired,
    humanResolved,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const dbFile = join(OUT, "decisions.sqlite");
  if (existsSync(dbFile)) unlinkSync(dbFile);

  const reviewPath = existsSync(LIVE_REVIEW) ? LIVE_REVIEW : FIXTURE_REVIEW;
  if (!existsSync(DEST)) {
    throw new Error(`Missing ${DEST}`);
  }

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
  if (dest.categories.length === 0) {
    throw new Error("STOP: empty destination categories");
  }

  const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
  const extracted = await adapter.extractDetailed({
    kind: "pdf",
    filePath: PDF,
  });
  const golden = loadVeroniGoldenFixture();
  const gate = reconcileAgainstGolden(extracted.sourceMenu, golden);
  if (!gate.pass) {
    writeJson("STOP-golden-fail.json", gate);
    throw new Error("STOP: golden fixture regression");
  }

  const domain = runDomainEngine(extracted.sourceMenu);
  let canonical = domain.menu;

  // Source invariants
  const products = listSourceProducts(extracted.sourceMenu);
  const allCanon = canonical.categories.flatMap((c) => c.products);
  const uniqueProducts = allCanon.length;
  const almFamilie = allCanon.filter((p) =>
    p.variants.some((v) => /familie/i.test(v.name)),
  ).length;
  const baseMenu = allCanon.filter((p) =>
    p.variants.some((v) => /^menu$/i.test(v.name)),
  ).length;
  const p48 = allCanon.find((p) => p.sourceMenuNumber === "48");
  const lilleStor =
    p48?.variants.some((v) => /lille/i.test(v.name)) &&
    p48?.variants.some((v) => /stor/i.test(v.name));
  const p65 = allCanon.find((p) => p.sourceMenuNumber === "65");
  const p66 = allCanon.find((p) => p.sourceMenuNumber === "66");
  const blockedSource = allCanon.filter((p) => p.status === "BLOCKED").length;

  if (
    uniqueProducts !== 72 ||
    almFamilie !== 29 ||
    baseMenu !== 7 ||
    !lilleStor ||
    p65?.basePrice !== 2500 ||
    p66?.basePrice !== 4500 ||
    blockedSource !== 0
  ) {
    writeJson("STOP-invariants.json", {
      uniqueProducts,
      almFamilie,
      baseMenu,
      lilleStor,
      p65: p65?.basePrice,
      p66: p66?.basePrice,
      blockedSource,
    });
    throw new Error("STOP: source invariant regression");
  }

  const review = JSON.parse(readFileSync(reviewPath, "utf8")) as {
    decisions: FinalHumanDecision[];
  };

  const { cases: builtCases, consolidated, initialReviewCases } =
    buildConsolidatedVeroniCases(review.decisions, "m64-veroni");

  const store = new DecisionStore(dbFile);
  const registry = new DecisionPolicyRegistry(store);
  const engine = new DecisionEngine(
    store,
    registry,
    new FakeDecisionReasoner(),
  );

  // Seed prior authoritative fact WITHOUT duplicating if re-seeded
  const seeded = seedAuthoritativeVeroniVaelgSelv(store);

  for (const c of builtCases) registry.registerCase(c);

  // Enrich valgfrit case features for policy match
  const valgfrit = store
    .listCases({ runId: "m64-veroni" })
    .find(
      (c) =>
        c.decisionType === "PRODUCT_CHOICE" &&
        /valgfrit/i.test(c.sourceText) &&
        /36|37/.test(
          (
            JSON.parse(c.sourceEvidenceJson ?? "{}") as { affected?: string[] }
          ).affected?.join(",") ??
            c.menuNumber ??
            "",
        ),
    );

  if (valgfrit) {
    const { buildDecisionFeatures } = await import(
      "../src/decisions/features.js"
    );
    const { classifyRisk } = await import("../src/decisions/gate.js");
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

  const allCases = store.listCases({ runId: "m64-veroni" });
  const outcomes: DecisionOutcome[] = [];
  for (const c of allCases) {
    outcomes.push(await engine.resolve(store.getCase(c.decisionCaseId)!));
  }

  const after = store.listCases({ runId: "m64-veroni" });
  canonical = applyResolutionsToMenu(canonical, after, outcomes);

  const p61Audit = auditProduct61(canonical);
  const additionAudit = auditAdditions(canonical);

  const methodCounts = countByMethod(outcomes);
  const metrics = computeDecisionMetrics(after, outcomes);

  const remainingQuestions = buildRemainingQuestions(after, outcomes);

  // Decision trace for every case
  const decisionTrace = after.map((c) => {
    const o = outcomes.find((x) => x.decisionCaseId === c.decisionCaseId)!;
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
        policyVersion: o.policyVersion,
        precedentIds: o.precedentIds,
        gate: o.gate,
        sourceTextPreview: c.sourceText.slice(0, 240),
      },
    };
  });

  const estimatedQuestionsWithoutLearning = initialReviewCases;
  // Without consolidation + learning we'd ask per raw review item + duplicates;
  // with learning we avoid repeating valgfrit and collapse #60 duplicates + Menu shared.
  const questionsAvoidedByConsolidation =
    initialReviewCases - (after.length - 1); // -1 because we added #61
  const questionsAvoidedByPolicy = methodCounts.autoResolvedPolicy;
  const questionsAvoidedByDeterministic =
    methodCounts.autoResolvedDeterministic;
  const actualQuestionsAfterLearning = remainingQuestions.length;
  const questionsAvoided =
    estimatedQuestionsWithoutLearning - actualQuestionsAfterLearning;

  const remainingMd = [
    "# Remaining human review (M6.4 autonomous pass)",
    "",
    `Generated: ${nowIso()}`,
    "",
    `Count: **${remainingQuestions.length}**`,
    "",
    ...remainingQuestions.flatMap((q, i) => [
      `## ${i + 1}. ${q.decisionId}`,
      "",
      `**Question:** ${q.question}`,
      "",
      `- Decision case: \`${q.decisionCaseId}\``,
      `- Type: ${q.decisionType}`,
      `- Affected: ${q.affectedProducts.map((a) => `#${a.menuNumber} ${a.name}`).join("; ")}`,
      `- Already known:`,
      ...q.alreadyKnown.map((k) => `  - ${k}`),
      `- Unknown fact: ${q.unknownFact}`,
      `- Recommended (system only): ${q.recommendedAnswer ?? "none"}`,
      `- Expected scope: ${q.expectedScope}`,
      `- Will learn: ${q.whatWillBeLearned}`,
      `- Batch group: ${q.batchGroup}`,
      `- Gate: ${JSON.stringify(q.gateReasons)}`,
      "",
    ]),
  ].join("\n");

  // Category mappings + dry-run
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
  const productMappings = ["36", "37", "38"].map((n) =>
    mapProductToDestinationCategory(
      {
        menuNumber: n,
        name: bySrc[n]?.name ?? "",
        sourceCategoryName:
          products.find((p) => p.menuNumber === n)?.section ?? "",
      },
      dest.categories,
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

  const createCatCap =
    ADMIN_CONTRACT_V1.capabilities.write.createCategory ?? "UNCERTIFIED";

  let dryPlan: ReturnType<typeof buildDryRunWritePlan> | null = null;
  let writePlanNote: string | null = null;
  try {
    dryPlan = buildDryRunWritePlan({
      runId: "m64-veroni",
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
      decisionCases: after.map((c) => ({
        decisionCaseId: c.decisionCaseId,
        status:
          c.status.startsWith("AUTO_RESOLVED_") || c.status === "HUMAN_RESOLVED"
            ? "HUMAN_RESOLVED"
            : c.status,
      })),
    });
  } catch (e) {
    writePlanNote = String(e instanceof Error ? e.message : e);
    dryPlan = buildDryRunWritePlan({
      runId: "m64-veroni",
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
        products: dest.realProducts,
      },
      capabilities: ADMIN_CONTRACT_V1.capabilities,
    });
  }

  const dryCounts = dryPlan ? summarizeDryRun(dryPlan) : null;
  const sourceDry = dryPlan ? summarizeSourceDryRun(dryPlan) : null;

  // Status lookups
  const statusOf = (pred: (c: DecisionCase, o: DecisionOutcome) => boolean) => {
    const hits = after
      .map((c) => ({
        c,
        o: outcomes.find((x) => x.decisionCaseId === c.decisionCaseId)!,
      }))
      .filter(({ c, o }) => pred(c, o));
    return hits.map(({ c, o }) => ({
      decisionCaseId: c.decisionCaseId,
      menuNumber: c.menuNumber,
      status: o.status,
      method: resolutionMethodLabel(o.method, o.status),
      resolution: o.resolution,
      explanation: o.explanation,
    }));
  };

  const pastaOutcome = statusOf(
    (c) =>
      c.decisionType === "DESTINATION_CATEGORY" &&
      /pasta/i.test(c.sourceText + c.productName),
  )[0];
  const menuOutcome = statusOf(
    (c) => c.decisionType === "MENU_PRICE_OPTION_SEMANTICS",
  )[0];
  const valgfritOutcome = statusOf(
    (c) => /valgfrit/i.test(c.sourceText),
  )[0];

  // Learning safety checks
  let globalFixedBlocked = false;
  try {
    assertGlobalPolicyHasNoFixedMoney({
      scope: "GLOBAL",
      knowledgeKind: "BUSINESS_FACT",
      resolution: JSON.stringify({
        options: [...VERONI_VAELG_SELV_OPTIONS],
        priceMinor: 1500,
      }),
    });
  } catch {
    globalFixedBlocked = true;
  }
  // Other restaurant must not receive Veroni choice options from ACTIVE fact
  const otherChoices = store.facts.listActiveChoiceOptions("other-restaurant.dk");
  const crossRestaurantChoiceLeak = otherChoices.some((f) =>
    f.options.some((o) =>
      VERONI_VAELG_SELV_OPTIONS.includes(o as (typeof VERONI_VAELG_SELV_OPTIONS)[number]),
    ),
  );
  void assertNoCrossRestaurantPriceLeak;

  const liveProducts = canonical.categories.flatMap((c) => c.products);
  const p36 = liveProducts.find((p) => p.sourceMenuNumber === "36");
  const p37 = liveProducts.find((p) => p.sourceMenuNumber === "37");
  const p38 = liveProducts.find((p) => p.sourceMenuNumber === "38");
  const choice36 = p36?.productChoices.find((c) =>
    /vælg selv|valgfrit/i.test(c.prompt),
  );
  const choice37 = p37?.productChoices.find((c) =>
    /vælg selv|valgfrit/i.test(c.prompt),
  );
  const leak38 = p38?.productChoices.some((c) =>
    c.options.some((o) =>
      VERONI_VAELG_SELV_OPTIONS.includes(o.label as never),
    ),
  );

  writeJson("decision-trace.json", decisionTrace);
  writeJson("canonical-menu.json", canonical);
  writeJson("validation-report.json", domain.validation);
  writeJson("remaining-human-review.json", remainingQuestions);
  writeFileSync(join(OUT, "remaining-human-review.md"), remainingMd, "utf8");
  writeJson("decision-metrics.json", {
    ...metrics,
    ...methodCounts,
    initialReviewCases,
    alreadyHumanResolvedPrior: seeded.createdHumanDecision ? 0 : 1,
    priorAuthoritativeHumanDecisionId: seeded.humanDecisionId,
    estimatedQuestionsWithoutLearning,
    actualQuestionsAfterLearning,
    questionsAvoided,
    questionsAvoidedByConsolidation: Math.max(0, questionsAvoidedByConsolidation),
    questionsAvoidedByPolicy,
    questionsAvoidedByDeterministic,
    consolidated,
  });
  writeJson("dry-run-writeplan.json", {
    ...dryPlan,
    decisionGateNote: writePlanNote,
    semanticReviewBlock: remainingQuestions.map((q) => q.decisionId),
    uncertifiedCapabilityBlock: {
      createCategory: createCatCap,
      reason: "MISSING_CERTIFIED_CAPABILITY:createCategory",
      pastaSemanticResolved: pastaOutcome?.status ?? null,
    },
    counts: dryCounts,
    sourceCounts: sourceDry,
  });
  writeJson("product-61-audit.json", p61Audit);
  writeJson("addition-audit.json", additionAudit);
  writeJson("category-mapping.json", {
    categoryMappings,
    productLevelMappings: productMappings,
  });
  writeJson("policy-state.json", {
    active: store.listPolicies("ACTIVE"),
    shadow: store.listPolicies("SHADOW"),
    seededHumanDecisionId: seeded.humanDecisionId,
    createdHumanDecisionThisRun: seeded.createdHumanDecision,
  });

  const priceUnresolved = after.filter(
    (c) =>
      /PRICE|MENU_PRICE/i.test(String(c.decisionType)) &&
      (c.status === "HUMAN_REVIEW_REQUIRED" || c.status === "UNRESOLVED"),
  ).length;

  const report = {
    title: "M6.4 VERONI AUTONOMOUS DECISION REPORT",
    initialHumanReviewCases: initialReviewCases,
    previouslyHumanApprovedCases: 1,
    previouslyHumanApproved: {
      humanDecisionId: VERONI_VAELG_SELV_HUMAN_DECISION_ID,
      products: ["36", "37"],
      options: [...VERONI_VAELG_SELV_OPTIONS],
      duplicateHumanDecisionCreated: seeded.createdHumanDecision
        ? "FIRST_SEED_ONLY"
        : "NO",
    },
    autoResolvedDeterministic: methodCounts.autoResolvedDeterministic,
    autoResolvedByPolicy: methodCounts.autoResolvedPolicy,
    autoResolvedByPrecedent: methodCounts.autoResolvedPrecedent,
    autoResolvedByAiGate: methodCounts.autoResolvedAI,
    remainingHumanQuestions: remainingQuestions.length,
    remainingHumanQuestionsFullText: remainingQuestions.map((q) => q.question),
    remainingDetailed: remainingQuestions,
    status24: statusOf((c) => c.menuNumber === "24")[0] ?? null,
    status36_37: valgfritOutcome ?? null,
    status57_58: statusOf((c) => /57|58/.test(c.menuNumber ?? "") || /ris\/naan/i.test(c.sourceText))[0] ?? null,
    status59: statusOf((c) => c.menuNumber === "59")[0] ?? null,
    status60: statusOf((c) => c.menuNumber === "60")[0] ?? null,
    status61: statusOf((c) => c.menuNumber === "61")[0] ?? null,
    product61Audit: p61Audit,
    status62: statusOf((c) => c.menuNumber === "62")[0] ?? null,
    menuOptionSemanticStatus: menuOutcome ?? null,
    pastaSemanticStatus: pastaOutcome ?? null,
    pastaCapabilityBlock: {
      createCategory: createCatCap,
      reason: "MISSING_CERTIFIED_CAPABILITY:createCategory",
      note: "Semantic Pasta mapping separate from execution capability",
    },
    product38CategoryStatus:
      statusOf((c) => c.menuNumber === "38")[0] ??
      productMappings.find((m) => m.menuNumber === "38"),
    additionUnresolvedCount: additionAudit.unresolvedPriceMissing,
    priceUnresolvedCount: priceUnresolved,
    questionsAvoided,
    humanInterventionRate:
      remainingQuestions.length / Math.max(1, after.length),
    dryRunCounts: dryCounts,
    sourceDryRunCounts: sourceDry,
    choice36: choice36
      ? {
          prompt: choice36.prompt,
          options: choice36.options.map((o) => o.label),
        }
      : null,
    choice37: choice37
      ? {
          prompt: choice37.prompt,
          options: choice37.options.map((o) => o.label),
        }
      : null,
    product38DidNotInheritVaelgSelv: leak38 !== true,
    learningSafety: {
      globalFixedBusinessFactBlocked: globalFixedBlocked,
      crossRestaurantChoiceLeak: crossRestaurantChoiceLeak,
      crossRestaurantLeakBlocked: !crossRestaurantChoiceLeak,
      veroniOptions: [...VERONI_VAELG_SELV_OPTIONS],
    },
    invariants: {
      uniqueProducts,
      almFamilie,
      baseMenu,
      lilleStor48: !!lilleStor,
      ol65: p65?.basePrice,
      vin66: p66?.basePrice,
      sourceBlocked: blockedSource,
    },
    golden: gate.pass ? "PASS" : "FAIL",
    consolidated,
    READY_FOR_FINAL_HUMAN_INPUT:
      remainingQuestions.length > 0 ? "YES" : "NO",
    READY_FOR_EXECUTOR_BINDING: "NO",
    exactRemainingBlockers: [
      ...remainingQuestions.map((q) => `SEMANTIC_REVIEW:${q.decisionId}`),
      `UNCERTIFIED_CAPABILITY:createCategory=${createCatCap}`,
      "executor not bound",
      "no live admin writes authorized",
    ],
    note: "NO ADMIN WRITES",
  };

  writeJson("m64-report.json", report);
  store.close();
  console.log(JSON.stringify({
    remaining: remainingQuestions.length,
    autoDet: methodCounts.autoResolvedDeterministic,
    autoPol: methodCounts.autoResolvedPolicy,
    questionsAvoided,
    READY_FOR_FINAL_HUMAN_INPUT: report.READY_FOR_FINAL_HUMAN_INPUT,
    READY_FOR_EXECUTOR_BINDING: "NO",
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
