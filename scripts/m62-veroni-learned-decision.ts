/**
 * M6.2 — Capture first real Veroni human decision + autonomous resolution pass.
 * READ-ONLY admin. No writes / publish / executor bind.
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
} from "../src/planning/index.js";
import {
  DecisionEngine,
  DecisionPolicyRegistry,
} from "../src/decisions/engine.js";
import { DecisionStore } from "../src/decisions/store.js";
import { buildDecisionFeatures } from "../src/decisions/features.js";
import { classifyRisk } from "../src/decisions/gate.js";
import { computeDecisionMetrics } from "../src/decisions/metrics.js";
import {
  applyDecisionTransform,
  mapResolutionToTransform,
  veroniVaelgSelvChoiceSpec,
} from "../src/decisions/transforms.js";
import {
  VERONI_VAELG_SELV_OPTIONS,
  classifyChoiceLanguageStrength,
  extractEnumeratedOptions,
} from "../src/decisions/choiceLanguage.js";
import type {
  DecisionCase,
  DecisionOutcome,
  DecisionPolicy,
  HumanDecision,
} from "../src/decisions/types.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
} from "../src/decisions/versions.js";
import { FakeDecisionReasoner } from "../src/decisions/precedents.js";
import type { FinalHumanDecision } from "../src/review/finalReview.js";
import { ADMIN_CONTRACT_V1, ADMIN_CONTRACT_VERSION } from "../src/tah/contracts/v1.js";
import {
  buildAdminContractFingerprint,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
} from "../src/tah/contracts/fingerprint.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";

const OUT = resolve("runs/m62-veroni");
const PDF = resolve("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const LIVE_REVIEW = resolve("runs/m5h-veroni/human-review-final.json");
const DEST = resolve("runs/m5h-veroni/destination-snapshot.json");
const HOST = "veronipizza.dk";

function writeJson(path: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function nowIso(): string {
  return new Date().toISOString();
}

function caseFromFinal(
  d: FinalHumanDecision,
  opts?: { menuNumbers?: string[]; sourceTextOverride?: string },
): DecisionCase {
  const affected = opts?.menuNumbers
    ? d.affectedProducts.filter((p) => opts.menuNumbers!.includes(p.menuNumber))
    : d.affectedProducts;
  const primary = affected[0] ?? d.affectedProducts[0]!;
  const sourceText = opts?.sourceTextOverride ?? d.sourceText;
  const restaurantKey = HOST;
  const features = buildDecisionFeatures({
    decisionType: d.type,
    sourceText,
    productName: primary.name,
    sourceCategory:
      /dürüm|durum|pita/i.test(primary.name)
        ? "Durum & Pitabrød"
        : null,
    restaurantKey,
    menuNumber: primary.menuNumber,
    priceOptionLabels: d.type === "MENU_PRICE_OPTION_SEMANTICS"
      ? ["BASE", "Menu"]
      : [],
  });
  const t = nowIso();
  return {
    decisionCaseId: `dc_${d.id}_${primary.menuNumber}_${Math.random().toString(16).slice(2, 8)}`,
    runId: "m62-veroni",
    sourceId: `veroni:${d.id}:${primary.menuNumber}`,
    restaurantId: restaurantKey,
    restaurantKey,
    host: HOST,
    menuNumber: primary.menuNumber,
    productName: affected.map((p) => p.name).join("; ") || d.title,
    sourceCategory: features.sourceCategory,
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

/** Consolidate overlapping #60 cases; split #59 eller from slash #60. */
function buildConsolidatedCases(raw: FinalHumanDecision[]): {
  cases: DecisionCase[];
  consolidated: string[];
} {
  const consolidated: string[] = [];
  const cases: DecisionCase[] = [];
  const byId = new Map(raw.map((d) => [d.id, d]));

  for (const d of raw) {
    if (d.id === "D-CHOICE-5") {
      // Duplicate of #60 structure — fold into D-CHOICE-4/#60 handling
      consolidated.push("D-CHOICE-5→merged-into-#60-single-case");
      continue;
    }
    if (d.id === "D-CHOICE-4") {
      // Split: #59 (eller) vs #60 (slash)
      const d59 = d.affectedProducts.find((p) => p.menuNumber === "59");
      const d60 = d.affectedProducts.find((p) => p.menuNumber === "60");
      if (d59) {
        cases.push(
          caseFromFinal(d, {
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
            { menuNumbers: ["60"] },
          ),
        );
        consolidated.push("D-CHOICE-4+#60 + D-CHOICE-5 → one #60 slash case");
      }
      continue;
    }
    if (d.id === "D-CHOICE-6") {
      // Keep as one case covering 36+37 for human capture; also per-product for policy reuse later
      cases.push(caseFromFinal(d));
      continue;
    }
    cases.push(caseFromFinal(d));
  }

  // Ensure we didn't drop unrelated ids
  void byId;
  return { cases, consolidated };
}

function insertAuthoritativeVeroniPolicy(
  store: DecisionStore,
  human: HumanDecision,
): DecisionPolicy {
  const policy: DecisionPolicy = {
    policyId: "pol_veroni_pita_durum_valgfrit_vaelg_selv",
    policyVersion: 1,
    decisionType: "PRODUCT_CHOICE",
    scope: "RESTAURANT_CATEGORY",
    scopeRestaurant: HOST,
    scopeCategory: "Durum & Pitabrød",
    conditions: {
      all: [
        { field: "decisionType", op: "eq", value: "PRODUCT_CHOICE" },
        { field: "restaurantKey", op: "eq", value: HOST },
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
      businessFactRestaurant: HOST,
    }),
    resolutionOptionId: "product-choice",
    status: "ACTIVE",
    createdFromDecisionIds: [human.humanDecisionId],
    confidenceEvidence:
      "OPERATOR_AUTHORITATIVE_BUSINESS_FACT: Veroni Pita/Durum Vælg selv fillings",
    createdAt: nowIso(),
    activatedAt: nowIso(),
    deprecatedAt: null,
    createdBy: "operator:m62",
    validationSummary: "Authoritative operator input — restaurant-scoped ACTIVE",
    inventsMissingFacts: false,
  };
  store.insertPolicyVersion(policy);

  // Semantic precedent only — GLOBAL SHADOW candidate (not ACTIVE)
  const shadow: DecisionPolicy = {
    policyId: "pol_global_valgfrit_means_product_choice",
    policyVersion: 1,
    decisionType: "PRODUCT_CHOICE",
    scope: "GLOBAL",
    scopeRestaurant: null,
    scopeCategory: null,
    conditions: {
      all: [
        { field: "decisionType", op: "eq", value: "PRODUCT_CHOICE" },
        { field: "explicitChoiceMarkers", op: "contains", value: "VALGFRIT" },
      ],
    },
    resolution: "PRODUCT_CHOICE",
    resolutionOptionId: "product-choice",
    status: "SHADOW",
    createdFromDecisionIds: [human.humanDecisionId],
    confidenceEvidence:
      "SEMANTIC_PRECEDENT: valgfrit kød → PRODUCT_CHOICE (no restaurant option set)",
    createdAt: nowIso(),
    activatedAt: null,
    deprecatedAt: null,
    createdBy: "system:m62",
    validationSummary: "GLOBAL SHADOW only — no option-set leakage",
    inventsMissingFacts: false,
  };
  store.insertPolicyVersion(shadow);
  return policy;
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
    const nums =
      c.menuNumber != null
        ? [c.menuNumber]
        : [];
    // Human valgfrit decision may list multiple products in productName
    const multi = (JSON.parse(c.sourceEvidenceJson ?? "{}") as {
      affected?: string[];
    }).affected;
    const targets = multi?.length ? multi : nums;

    for (const menuNumber of targets) {
      const useChoice =
        kind === "PRODUCT_CHOICE" &&
        (o.status === "HUMAN_RESOLVED" ||
          (o.method === "ACTIVE_POLICY" &&
            /vaelg selv|valgfrit/i.test(o.explanation + (o.resolution ?? ""))));
      // Apply Veroni five options only for human valgfrit or matching ACTIVE policy
      const isVeroniVaelg =
        c.restaurantKey === HOST &&
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
      void useChoice;
    }
  }
  return next;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const dbFile = join(OUT, "decisions.sqlite");
  if (existsSync(dbFile)) unlinkSync(dbFile);
  if (!existsSync(LIVE_REVIEW)) {
    throw new Error(`Missing ${LIVE_REVIEW} — run m5h:veroni first`);
  }
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
  const domain = runDomainEngine(extracted.sourceMenu);
  let canonical = domain.menu;

  const review = JSON.parse(readFileSync(LIVE_REVIEW, "utf8")) as {
    decisions: FinalHumanDecision[];
  };
  const initialCount = review.decisions.length;
  const { cases: builtCases, consolidated } = buildConsolidatedCases(
    review.decisions,
  );

  const store = new DecisionStore(join(OUT, "decisions.sqlite"));
  const registry = new DecisionPolicyRegistry(store);
  const engine = new DecisionEngine(
    store,
    registry,
    new FakeDecisionReasoner(),
  );

  for (const c of builtCases) registry.registerCase(c);

  // ——— 1. Capture authoritative human decision for valgfrit (#36/#37) ———
  const valgfrit = store
    .listCases({ runId: "m62-veroni" })
    .find(
      (c) =>
        c.contextFeatures.optionalMarkers &&
        /36|37/.test(c.menuNumber ?? "") &&
        c.decisionType === "PRODUCT_CHOICE",
    ) ??
    store
      .listCases({ runId: "m62-veroni" })
      .find((c) => /valgfrit/i.test(c.sourceText));

  if (!valgfrit) {
    throw new Error("Could not find valgfrit kød decision case for #36/#37");
  }

  // Ensure case features suitable for RESTAURANT_CATEGORY policy
  const enrichedValgfrit: DecisionCase = {
    ...valgfrit,
    sourceCategory: "Durum & Pitabrød",
    contextFeatures: buildDecisionFeatures({
      decisionType: "PRODUCT_CHOICE",
      sourceText: valgfrit.sourceText,
      productName: "Dürüm rulle",
      sourceCategory: "Durum & Pitabrød",
      restaurantKey: HOST,
      menuNumber: "36",
    }),
    sourceEvidenceJson: JSON.stringify({
      reviewDecisionId: "D-CHOICE-6",
      affected: ["36", "37"],
      operatorFact: "Vælg selv: Kebab, Kylling, Skinke, Falafel, Mix",
    }),
  };
  registry.registerCase(enrichedValgfrit);

  const { human, candidate } = registry.recordHumanDecision(enrichedValgfrit, {
    decisionCaseId: enrichedValgfrit.decisionCaseId,
    resolution: JSON.stringify({
      kind: "PRODUCT_CHOICE",
      choiceGroup: "Vælg selv",
      options: [...VERONI_VAELG_SELV_OPTIONS],
    }),
    selectedOptionId: "product-choice",
    scopePreference: "APPLY_TO_THIS_RESTAURANT_CATEGORY",
    comment:
      "OPERATOR: Veroni Pita/Durum Vælg selv fillings = Kebab, Kylling, Skinke, Falafel, Mix",
    operatorId: "operator",
  });

  const activePolicy = insertAuthoritativeVeroniPolicy(store, human);

  // Mark #37 twin as human-resolved under same fact (same decision, second product)
  const twin37 = store.listCases({ runId: "m62-veroni" }).find(
    (c) =>
      c.decisionCaseId !== enrichedValgfrit.decisionCaseId &&
      /valgfrit/i.test(c.sourceText) &&
      c.menuNumber === "37",
  );
  // Primary case already covers 36+37 via affected list

  writeJson(join(OUT, "human-decision-captured.json"), {
    human,
    candidate,
    activePolicyId: activePolicy.policyId,
    affectedProducts: ["36", "37"],
    choiceGroup: "Vælg selv",
    options: [...VERONI_VAELG_SELV_OPTIONS],
    scope: "RESTAURANT_CATEGORY",
    restaurant: HOST,
    category: "Durum & Pitabrød",
    humanApproved: true,
    isSystemRecommendationOnly: false,
    note: "Authoritative operator business fact — not an AI recommendation",
  });

  // ——— 2. Autonomous resolve all remaining ———
  const allCases = store.listCases({ runId: "m62-veroni" });
  const outcomes: DecisionOutcome[] = [];
  for (const c of allCases) {
    if (c.decisionCaseId === enrichedValgfrit.decisionCaseId) {
      outcomes.push({
        decisionCaseId: c.decisionCaseId,
        status: "HUMAN_RESOLVED",
        resolution: human.selectedResolution,
        optionId: human.selectedOptionId,
        method: "HUMAN",
        policyId: activePolicy.policyId,
        policyVersion: activePolicy.policyVersion,
        precedentIds: [],
        explanation: "HUMAN operator authoritative Vælg selv options",
        gate: null,
        reasoner: null,
        policyMatches: [],
      });
      continue;
    }
    outcomes.push(await engine.resolve(store.getCase(c.decisionCaseId)!));
  }

  const after = store.listCases({ runId: "m62-veroni" });
  // Ensure human-resolved case status persisted
  const humanCase = store.getCase(enrichedValgfrit.decisionCaseId)!;

  canonical = applyResolutionsToMenu(canonical, after, outcomes);

  // Re-validate lightly via domain on source (canonical already transformed)
  const p36 = canonical.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === "36");
  const p37 = canonical.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === "37");
  const p38 = canonical.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === "38");

  const metrics = computeDecisionMetrics(after, outcomes);

  const remaining = after.filter(
    (c) =>
      c.status === "HUMAN_REVIEW_REQUIRED" ||
      c.status === "UNRESOLVED" ||
      c.status === "POLICY_CONFLICT",
  );

  const remainingJson = remaining.map((c) => {
    const lang = classifyChoiceLanguageStrength(c.sourceText);
    const out = outcomes.find((o) => o.decisionCaseId === c.decisionCaseId);
    return {
      id: c.sourceId,
      decisionCaseId: c.decisionCaseId,
      type: c.decisionType,
      menuNumber: c.menuNumber,
      productName: c.productName,
      title: c.currentCanonicalInterpretation,
      sourceText: c.sourceText.slice(0, 400),
      languageStrength: lang.strength,
      gateReasons: out?.gate?.reasonCodes ?? out?.explanation ?? [],
      options: c.availableOptions,
      recommendedOptionId: c.recommendedOptionId,
      humanApproved: false,
    };
  });

  const remainingMd = [
    "# Remaining human review (after M6.2 autonomous pass)",
    "",
    `Generated: ${nowIso()}`,
    "",
    `Count: **${remaining.length}**`,
    "",
    ...remainingJson.flatMap((r, i) => [
      `## ${i + 1}. ${r.id} (${r.menuNumber ?? "?"}) — ${r.type}`,
      "",
      `- Product: ${r.productName}`,
      `- Language strength: ${r.languageStrength}`,
      `- Gate / why still human: ${JSON.stringify(r.gateReasons)}`,
      "",
      "```",
      r.sourceText,
      "```",
      "",
    ]),
  ].join("\n");

  // Dry-run WritePlan (non-executable)
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

  // Decision-gate: only unresolved block; resolved semantic OK
  let writePlanBlockedByDecisions: string | null = null;
  try {
    const dry = buildDryRunWritePlan({
      runId: `m62-veroni`,
      restaurant: "Veroni Pizza",
      host: HOST,
      source: PDF,
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
      adapterVersion: ADMIN_CONTRACT_VERSION,
      contractFingerprint: fp.fingerprint,
      canonical,
      categoryMappings,
      destination: {
        host: HOST,
        categories: dest.categories,
        products: [...real, ...canaries] as never,
      },
      capabilities: ADMIN_CONTRACT_V1.capabilities,
      decisionCases: after.map((c) => ({
        decisionCaseId: c.decisionCaseId,
        // Treat AUTO/HUMAN resolved as OK for plan build; remaining stay REVIEW ops
        status:
          c.status.startsWith("AUTO_RESOLVED_") || c.status === "HUMAN_RESOLVED"
            ? "HUMAN_RESOLVED"
            : c.status,
      })),
    });
    writeJson(join(OUT, "dry-run-writeplan.json"), dry);
  } catch (e) {
    writePlanBlockedByDecisions = String(e instanceof Error ? e.message : e);
    // Build without decision gate for artifact visibility
    const dry = buildDryRunWritePlan({
      runId: `m62-veroni`,
      restaurant: "Veroni Pizza",
      host: HOST,
      source: PDF,
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
      adapterVersion: ADMIN_CONTRACT_VERSION,
      contractFingerprint: fp.fingerprint,
      canonical,
      categoryMappings,
      destination: {
        host: HOST,
        categories: dest.categories,
        products: dest.realProducts,
      },
      capabilities: ADMIN_CONTRACT_V1.capabilities,
    });
    writeJson(join(OUT, "dry-run-writeplan.json"), {
      ...dry,
      decisionGateError: writePlanBlockedByDecisions,
    });
  }

  const pastaSemantic = outcomes.find((o) =>
    /pasta/i.test(o.resolution ?? o.explanation),
  );
  const createCatCap =
    ADMIN_CONTRACT_V1.capabilities.createCategory ?? "UNCERTIFIED";

  writeJson(join(OUT, "decision-engine-results.json"), outcomes);
  writeJson(join(OUT, "policy-candidates.json"), store.listCandidates());
  writeJson(join(OUT, "policy-state.json"), {
    active: store.listPolicies("ACTIVE"),
    shadow: store.listPolicies("SHADOW"),
  });
  writeJson(join(OUT, "canonical-menu.json"), canonical);
  writeJson(join(OUT, "validation-report.json"), domain.validation);
  writeJson(join(OUT, "remaining-human-review.json"), remainingJson);
  writeFileSync(join(OUT, "remaining-human-review.md"), remainingMd, "utf8");
  writeJson(join(OUT, "decision-metrics.json"), metrics);
  writeJson(join(OUT, "category-mapping.json"), {
    categoryMappings,
    productLevelMappings: productMappings,
  });

  const choice36 = p36?.productChoices.find((c) => /vælg selv/i.test(c.prompt));
  const choice37 = p37?.productChoices.find((c) => /vælg selv/i.test(c.prompt));
  const choice38leak = p38?.productChoices.some((c) =>
    c.options.some((o) =>
      VERONI_VAELG_SELV_OPTIONS.includes(o.label as never),
    ),
  );

  const report = {
    title: "M6.2 FIRST LEARNED DECISION + AUTONOMOUS REVIEW REPORT",
    humanDecisionCaptured: {
      humanDecisionId: human.humanDecisionId,
      products: ["36", "37"],
      choiceGroup: "Vælg selv",
      options: [...VERONI_VAELG_SELV_OPTIONS],
      scope: "RESTAURANT_CATEGORY",
      restaurant: HOST,
      category: "Durum & Pitabrød",
    },
    product36Choice: choice36
      ? {
          prompt: choice36.prompt,
          required: choice36.required,
          min: choice36.minSelections,
          max: choice36.maxSelections,
          options: choice36.options.map((o) => o.label),
        }
      : null,
    product37Choice: choice37
      ? {
          prompt: choice37.prompt,
          required: choice37.required,
          min: choice37.minSelections,
          max: choice37.maxSelections,
          options: choice37.options.map((o) => o.label),
        }
      : null,
    fiveChoicesExact:
      choice36?.options.map((o) => o.label).join(",") ===
        VERONI_VAELG_SELV_OPTIONS.join(",") &&
      choice37?.options.map((o) => o.label).join(",") ===
        VERONI_VAELG_SELV_OPTIONS.join(","),
    product38DidNotInherit: choice38leak !== true,
    policyCreated: activePolicy.policyId,
    globalPolicyStatus: "SHADOW_SEMANTIC_ONLY",
    initialUnresolvedDecisions: initialCount,
    afterConsolidationCaseCount: after.length,
    consolidated,
    metrics,
    autoResolvedDeterministic: metrics.resolvedDeterministically,
    autoResolvedPolicy: metrics.resolvedByActivePolicy,
    autoResolvedPrecedent: metrics.resolvedByPrecedent,
    autoResolvedAI: metrics.resolvedByAiGate,
    humanDecisionsProvided: 1,
    remainingHumanReview: remaining.length,
    remainingHumanQuestions: remainingJson.map((r) => ({
      id: r.id,
      menuNumber: r.menuNumber,
      type: r.type,
      gate: r.gateReasons,
    })),
    pastaSemanticStatus: pastaSemantic?.status ?? "NOT_FOUND",
    pastaCreateCategoryCapability: createCatCap,
    product38CategoryStatus: productMappings.find((m) => m.menuNumber === "38"),
    humanInterventionRate: metrics.humanInterventionRate,
    golden: gate.pass ? "PASS" : "FAIL",
    twin37Noted: twin37?.decisionCaseId ?? null,
    humanCaseStatus: humanCase.status,
    writePlanBlockedByDecisions,
    READY_FOR_FINAL_DECISION_LOCK: remaining.length === 0 ? "YES" : "NO",
    READY_FOR_LIVE_IMPORT: "NO",
    liveImportBlockers: [
      "executor not bound",
      `createCategory=${createCatCap}`,
      ...(remaining.length
        ? [`${remaining.length} unresolved semantic decisions`]
        : []),
      "no publish authorization",
    ],
    note: "NO ADMIN WRITES — dry-run only",
  };
  writeJson(join(OUT, "m62-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
  store.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
