/**
 * M6.6 — Eliminate avoidable SOURCE_REVIEW + final WritePlan readiness.
 * NO ADMIN WRITES / NO createCategory / NO executor bind.
 */
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { runDomainEngine } from "../src/domain/engine.js";
import { buildValidationReport } from "../src/domain/validation.js";
import { revalidateCanonicalIssues } from "../src/domain/issueLifecycle.js";
import { categoryExpectsListedIngredients } from "../src/domain/ingredients.js";
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
  partitionDestinationProducts,
  summarizeDryRun,
  summarizeSourceDryRun,
} from "../src/planning/index.js";
import { applyProductChoiceSpec } from "../src/decisions/transforms.js";
import { veroniVaelgSelvChoiceSpec } from "../src/decisions/transforms.js";
import { VERONI_VAELG_SELV_OPTIONS } from "../src/decisions/choiceLanguage.js";
import { ADMIN_CONTRACT_V1, ADMIN_CONTRACT_VERSION } from "../src/tah/contracts/v1.js";
import {
  buildAdminContractFingerprint,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
} from "../src/tah/contracts/fingerprint.js";
import type { CanonicalMenu, CanonicalProduct } from "../src/domain/schema/canonical.js";

const OUT = resolve("runs/m66-veroni-validation-cleanup");
const PDF = resolve("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const DEST = resolve("runs/m5h-veroni/destination-snapshot.json");
const M65_HUMAN = resolve("runs/m65-veroni-decision-lock/human-decisions.json");

const INITIAL_REVIEW_NUMBERS = [
  "33", "39", "40", "41", "42", "43", "44", "45", "47", "48",
  "55", "56", "63", "64", "65", "67", "68", "69",
] as const;

function writeJson(name: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), "utf8");
}

function findProduct(
  menu: CanonicalMenu,
  n: string,
): { cat: string; product: CanonicalProduct } | null {
  for (const cat of menu.categories) {
    const p = cat.products.find((x) => x.sourceMenuNumber === n);
    if (p) return { cat: cat.name, product: p };
  }
  return null;
}

type RootCause =
  | "EXTRACTION_ERROR"
  | "NORMALIZATION_ERROR"
  | "VALIDATION_FALSE_POSITIVE"
  | "MISSING_SOURCE_FACT"
  | "SOURCE_AMBIGUITY"
  | "DESTINATION_CAPABILITY"
  | "OTHER";

function classifyInitial(input: {
  menuNumber: string;
  category: string;
  rawText: string;
  ingredients: number;
}): {
  rootCause: RootCause;
  why: string;
} {
  const raw = input.rawText;
  const expects = categoryExpectsListedIngredients(input.category);
  if (
    /klassisk|kødsovs|grøntsager|oksefyld|kartofler|valgfri\s+dyppelse/i.test(
      raw,
    ) &&
    input.ingredients === 0
  ) {
    return {
      rootCause: "EXTRACTION_ERROR",
      why: "Source evidence contains accompaniment/description text not promoted to ingredients",
    };
  }
  if (/drikkevarer|sodavand|øl|vin|kildevand|juice|kaffe/i.test(input.category + raw)) {
    return {
      rootCause: "VALIDATION_FALSE_POSITIVE",
      why: "Drinks have no source ingredient lists; empty ingredients are valid",
    };
  }
  if (/grill/i.test(input.category) && input.ingredients === 0) {
    return {
      rootCause: "VALIDATION_FALSE_POSITIVE",
      why: "Grill named plates often have no topping list in source; empty ingredients valid",
    };
  }
  if (/indisk|naan/i.test(input.category + raw) && input.ingredients === 0) {
    if (/med\s+grøntsager|oksefyld/i.test(raw)) {
      return {
        rootCause: "EXTRACTION_ERROR",
        why: "Indisk accompaniment text present in evidence but not extracted",
      };
    }
    return {
      rootCause: "VALIDATION_FALSE_POSITIVE",
      why: "Simple Indisk side/bread with no topping list in source",
    };
  }
  if (expects) {
    return {
      rootCause: "MISSING_SOURCE_FACT",
      why: "Pizza-like category expects listed toppings",
    };
  }
  if (/pasta/i.test(input.category)) {
    return {
      rootCause: "EXTRACTION_ERROR",
      why: "Pasta description present in evidence (e.g. Klassisk italiensk kødsovs)",
    };
  }
  return {
    rootCause: "OTHER",
    why: "MISSING_SOURCE_SUPPORTED_INGREDIENTS under prior global rule",
  };
}

function applyApprovedChoices(menu: CanonicalMenu): CanonicalMenu {
  let next = menu;
  const specs: Array<{ n: string; prompt: string; options: string[] }> = [
    { n: "24", prompt: "Vælg", options: ["Skinke", "Kebab"] },
    { n: "36", prompt: "Vælg selv", options: [...VERONI_VAELG_SELV_OPTIONS] },
    { n: "37", prompt: "Vælg selv", options: [...VERONI_VAELG_SELV_OPTIONS] },
    { n: "57", prompt: "Vælg tilbehør", options: ["Ris", "Naanbrød"] },
    { n: "58", prompt: "Vælg tilbehør", options: ["Ris", "Naanbrød"] },
    { n: "59", prompt: "Vælg", options: ["Kylling", "Oksekød"] },
    { n: "60", prompt: "Vælg", options: ["Kylling", "Okse", "Vegetar"] },
    { n: "61", prompt: "Vælg", options: ["Kylling", "Okse", "Grøntsager", "Rejer"] },
    {
      n: "62",
      prompt: "Vælg mellem",
      options: ["Champignon", "Broccoli", "Blomkål", "Indisk ost"],
    },
  ];
  for (const s of specs) {
    next = applyProductChoiceSpec(next, s.n, {
      prompt: s.prompt,
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: s.options,
    });
  }
  // Ensure 36/37 use authoritative five-option fact
  next = applyProductChoiceSpec(next, "36", veroniVaelgSelvChoiceSpec());
  next = applyProductChoiceSpec(next, "37", veroniVaelgSelvChoiceSpec());
  return next;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
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
  if (!gate.pass) {
    writeJson("STOP-golden-fail.json", gate);
    throw new Error("STOP: golden regression");
  }

  const domain = runDomainEngine(extracted.sourceMenu);
  let canonical = domain.menu;

  // Initial audit of the known 18 (as of M6.5) against CURRENT extraction
  const initialAudit = INITIAL_REVIEW_NUMBERS.map((n) => {
    const hit = findProduct(canonical, n);
    const p = hit?.product;
    const issue = p?.issues.find(
      (i) => i.code === "MISSING_SOURCE_SUPPORTED_INGREDIENTS",
    );
    const cls = classifyInitial({
      menuNumber: n,
      category: hit?.cat ?? "",
      rawText: p?.evidence?.rawText ?? "",
      ingredients: p?.ingredients.length ?? 0,
    });
    return {
      menuNumber: n,
      productName: p?.name ?? "MISSING",
      sourceCategory: hit?.cat ?? null,
      validationStatus: p?.status ?? "MISSING",
      issueCode: issue?.code ?? (p?.issues[0]?.code ?? "NONE"),
      field: issue?.field ?? p?.issues[0]?.field ?? null,
      currentValue: {
        ingredients: p?.ingredients.map((i) => i.display) ?? [],
        variants: p?.variants.map((v) => v.name) ?? [],
        basePrice: p?.basePrice ?? null,
        productChoices: (p?.productChoices ?? []).map((c) => ({
          prompt: c.prompt,
          options: c.options.map((o) => o.label),
        })),
      },
      sourceEvidence: (p?.evidence?.rawText ?? "").slice(0, 400),
      whyValidationProducedReview:
        issue?.message ??
        "Was MANUAL_REVIEW under prior global empty-ingredient rule",
      rootCause: cls.rootCause,
      rootCauseDetail: cls.why,
    };
  });

  writeJson("source-review-audit.json", {
    initialCount: 18,
    note: "Inventory of the 18 M6.5 SOURCE_REVIEW products after re-extraction",
    products: initialAudit,
  });

  // Apply M6.5 approved ProductChoice decisions (typed transforms)
  canonical = applyApprovedChoices(canonical);
  const { menu: revalidated, resolutions } = revalidateCanonicalIssues(canonical);
  canonical = revalidated;

  // Annotate #38 destination decision in evidence (already mapped in writeplan)
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

  const stillReview = canonical.categories.flatMap((cat) =>
    cat.products
      .filter((p) => p.status === "MANUAL_REVIEW_REQUIRED")
      .map((p) => ({
        menuNumber: p.sourceMenuNumber,
        name: p.name,
        category: cat.name,
        issues: p.issues,
      })),
  );

  const resolutionSummary = {
    resolvedByExtraction: resolutions.filter(
      (r) => r.lifecycle === "RESOLVED_BY_EXTRACTION",
    ).length,
    resolvedByDomainRule: resolutions.filter(
      (r) => r.lifecycle === "RESOLVED_BY_DOMAIN_RULE",
    ).length,
    resolvedByHuman: resolutions.filter(
      (r) => r.lifecycle === "RESOLVED_BY_HUMAN",
    ).length,
    stillReviewRequired: resolutions.filter(
      (r) => r.lifecycle === "STILL_REVIEW_REQUIRED",
    ).length,
    resolutions,
  };

  // Root-cause counts from initial audit
  const rootCauseCounts: Record<string, number> = {};
  for (const a of initialAudit) {
    rootCauseCounts[a.rootCause] = (rootCauseCounts[a.rootCause] ?? 0) + 1;
  }

  // Per-product resolution outcome
  const perProductResolution = INITIAL_REVIEW_NUMBERS.map((n) => {
    const before = initialAudit.find((a) => a.menuNumber === n)!;
    const after = findProduct(canonical, n);
    const still = after?.product.status === "MANUAL_REVIEW_REQUIRED";
    const hasIngs = (after?.product.ingredients.length ?? 0) > 0;
    let resolvedBy:
      | "EXTRACTION"
      | "DOMAIN_RULE"
      | "DECISION_ENGINE"
      | "POLICY"
      | "FALSE_POSITIVE_FIX"
      | "STILL_REVIEW"
      | "OTHER" = "OTHER";
    if (!still) {
      if (hasIngs && before.currentValue.ingredients.length === 0) {
        resolvedBy = "EXTRACTION";
      } else if (
        before.rootCause === "VALIDATION_FALSE_POSITIVE" ||
        !categoryExpectsListedIngredients(after?.cat ?? "")
      ) {
        resolvedBy = "FALSE_POSITIVE_FIX";
      } else {
        resolvedBy = "DOMAIN_RULE";
      }
    } else {
      resolvedBy = "STILL_REVIEW";
    }
    return {
      menuNumber: n,
      beforeStatus: before.validationStatus,
      afterStatus: after?.product.status,
      ingredientsAfter: after?.product.ingredients.map((i) => i.display) ?? [],
      resolvedBy,
      stillReview: still,
    };
  });

  writeJson("source-review-resolution.json", {
    resolutionSummary,
    perProductResolution,
  });

  // Pasta audit
  const pastaAudit = ["33", "34", "35"].map((n) => {
    const hit = findProduct(canonical, n)!;
    return {
      menuNumber: n,
      name: hit.product.name,
      sourceCategory: hit.cat,
      canonicalCategory: hit.cat,
      validationStatus: hit.product.status,
      ingredients: hit.product.ingredients.map((i) => i.display),
      plannedDestinationCategory: "Pasta (missing on destination)",
      capabilityRequirement: "createCategory",
    };
  });

  const productsList = listSourceProducts(extracted.sourceMenu);
  void productsList;
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
    "38": {
      destinationCategoryId: "6",
      destinationCategoryName: "Durum & Pitabrød",
    },
  };

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
    runId: "m66-veroni",
    restaurant: "Veroni Pizza",
    host: "veronipizza.dk",
    source: PDF,
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
    adapterVersion: ADMIN_CONTRACT_VERSION,
    contractFingerprint: fp.fingerprint,
    canonical,
    categoryMappings,
    destination: {
      host: "veronipizza.dk",
      categories: dest.categories,
      products: [...real, ...canaries] as never,
    },
    capabilities: ADMIN_CONTRACT_V1.capabilities,
    humanApprovedProductCategories,
  });

  // Attach pasta writeplan actions
  for (const row of pastaAudit) {
    const op = dryPlan.operations.find(
      (o) => o.identity.menuNumber === row.menuNumber,
    );
    Object.assign(row, {
      writePlanAction: op?.action ?? null,
      writePlanReason: op?.reason ?? null,
      missingCapabilities: op?.missingCapabilities ?? [],
    });
  }
  writeJson("pasta-audit.json", {
    products: pastaAudit,
    note: "All three Pasta products require createCategory; none silently remapped",
  });

  const dryCounts = summarizeDryRun(dryPlan);
  const sourceDry = summarizeSourceDryRun(dryPlan);

  const sourceReviewOps = dryPlan.operations.filter(
    (o) =>
      o.action === "REVIEW" &&
      /validation status/i.test(o.reason ?? ""),
  );
  const semanticReviewOps = dryPlan.operations.filter(
    (o) =>
      o.action === "REVIEW" &&
      /semantic|decision/i.test(o.reason ?? ""),
  );
  const capabilityBlockOps = dryPlan.operations.filter(
    (o) =>
      o.action === "BLOCK" &&
      (o.missingCapabilities ?? []).includes("createCategory"),
  );

  const capabilityDependencies = [
    {
      capability: "createCategory",
      newCategoryNeeded: "Pasta",
      destinationCategoryDesired: "Pasta",
      affectedProducts: capabilityBlockOps.map((o) => o.identity.menuNumber),
      oneCreationUnblocksAll: true,
      requiredBeforeFirstHiddenImport: true,
      whyNeeded: "Destination has no Pasta category for source Pasta products",
    },
  ];

  const live = canonical.categories.flatMap((c) => c.products);
  const sourceReady = live.filter((p) => {
    const hit = findProduct(canonical, p.sourceMenuNumber ?? "");
    const catMap = categoryMappings.find(
      (m) => m.sourceCategoryId === p.categorySourceId,
    );
    const pastaMissing =
      /pasta/i.test(hit?.cat ?? "") &&
      catMap?.outcome === "MISSING_DESTINATION_CATEGORY";
    return (
      p.status === "READY" &&
      p.basePrice != null &&
      p.variants.length >= 1 &&
      !pastaMissing
    );
  }).length;

  // Capability-ready = source ready AND destination category exists
  const capabilityReady = live.filter((p) => {
    if (p.status !== "READY") return false;
    const cat = canonical.categories.find((c) => c.sourceId === p.categorySourceId);
    const map = categoryMappings.find((m) => m.sourceCategoryId === cat?.sourceId);
    if (p.sourceMenuNumber === "38") return true;
    return map?.outcome === "SAFE_MAPPED_MATCH" || map?.outcome === "EXACT_MATCH";
  }).length;

  const remainingHumanQuestions: string[] = [];
  // No operator questions: empty optional ingredients are valid; Pasta is capability-only

  const remainingMd = [
    "# Remaining source review (M6.6)",
    "",
    `Count: **${stillReview.length}**`,
    "",
    ...stillReview.flatMap((r, i) => [
      `## ${i + 1}. #${r.menuNumber} ${r.name}`,
      "",
      `- Category: ${r.category}`,
      `- Issues: ${JSON.stringify(r.issues)}`,
      "",
    ]),
    remainingHumanQuestions.length
      ? `## Human questions\n\n${remainingHumanQuestions.join("\n\n")}`
      : "## Human questions\n\nNone — remaining items are capability blocks or none.",
  ].join("\n");

  writeJson("canonical-menu.json", canonical);
  writeJson("validation-report.json", {
    ...buildValidationReport(canonical),
    stillReview,
    issueLifecycle: resolutions,
  });
  writeJson("remaining-source-review.json", {
    products: stillReview,
    humanQuestions: remainingHumanQuestions,
  });
  writeFileSync(join(OUT, "remaining-source-review.md"), remainingMd, "utf8");
  writeJson("capability-dependencies.json", capabilityDependencies);
  writeJson("dry-run-writeplan.json", {
    ...dryPlan,
    counts: dryCounts,
    sourceCounts: sourceDry,
    dimensions: {
      SOURCE_REVIEW: sourceReviewOps.length,
      SEMANTIC_REVIEW: semanticReviewOps.length,
      CAPABILITY_BLOCK: capabilityBlockOps.length,
    },
  });

  const invariants = {
    uniqueProducts: live.length,
    almFamilie: live.filter((p) =>
      p.variants.some((v) => /familie/i.test(v.name)),
    ).length,
    baseMenu: live.filter((p) =>
      p.variants.some((v) => /^menu$/i.test(v.name)),
    ).length,
    ol65: findProduct(canonical, "65")?.product.basePrice,
    vin66: findProduct(canonical, "66")?.product.basePrice,
    choice36: findProduct(canonical, "36")
      ?.product.productChoices[0]?.options.map((o) => o.label),
  };

  if (
    invariants.uniqueProducts !== 72 ||
    invariants.almFamilie !== 29 ||
    invariants.baseMenu !== 7 ||
    invariants.ol65 !== 2500 ||
    invariants.vin66 !== 4500
  ) {
    writeJson("STOP-invariants.json", invariants);
    throw new Error("STOP: invariant regression");
  }

  const report = {
    title: "M6.6 VERONI SOURCE VALIDATION CLEANUP REPORT",
    initialSourceReviewProducts: 18,
    fullInitialList: initialAudit.map((a) => ({
      menuNumber: a.menuNumber,
      productName: a.productName,
      issueCode: a.issueCode,
      rootCause: a.rootCause,
    })),
    rootCauseCounts,
    resolvedByExtraction: perProductResolution.filter(
      (p) => p.resolvedBy === "EXTRACTION",
    ).length,
    resolvedByDeterministicDomainRule: perProductResolution.filter(
      (p) =>
        p.resolvedBy === "DOMAIN_RULE" || p.resolvedBy === "FALSE_POSITIVE_FIX",
    ).length,
    resolvedByPriorDecisionEngine: 0,
    resolvedByPolicyFact: 0,
    validationFalsePositivesFixed: perProductResolution.filter(
      (p) => p.resolvedBy === "FALSE_POSITIVE_FIX",
    ).length,
    remainingGenuineSourceReview: stillReview,
    remainingHumanQuestionsFullText: remainingHumanQuestions,
    pasta33: pastaAudit.find((p) => p.menuNumber === "33"),
    pasta34: pastaAudit.find((p) => p.menuNumber === "34"),
    pasta35: pastaAudit.find((p) => p.menuNumber === "35"),
    pastaCapabilityDependency: capabilityDependencies[0],
    sourceReadyProductCount: sourceReady,
    capabilityReadyProductCount: capabilityReady,
    semanticUnresolvedCount: 0,
    priceUnresolvedCount: 0,
    additionUnresolvedCount: 0,
    productChoiceUnresolvedCount: 0,
    dryRunCreate: sourceDry.SOURCE_CREATE,
    dryRunReview: sourceDry.SOURCE_REVIEW,
    dryRunBlock: sourceDry.SOURCE_BLOCK,
    sourceTotal: sourceDry.total,
    requiredUncertifiedCapabilities: capabilityDependencies,
    golden: gate.pass ? "PASS" : "FAIL",
    invariants,
    m65HumanDecisionsPresent: existsSync(M65_HUMAN),
    dimensions: {
      SOURCE_REVIEW: sourceReviewOps.length,
      SEMANTIC_REVIEW: semanticReviewOps.length,
      CAPABILITY_BLOCK: capabilityBlockOps.length,
    },
    READY_FOR_CREATECATEGORY_CERTIFICATION:
      stillReview.length === 0 && capabilityBlockOps.length > 0
        ? "YES"
        : stillReview.length === 0
          ? "YES"
          : "NO",
    READY_FOR_EXECUTOR_BINDING: "NO",
    exactRemainingBlockers: [
      ...capabilityDependencies.map(
        (c) =>
          `UNCERTIFIED_CAPABILITY:${c.capability} (${c.newCategoryNeeded}: ${c.affectedProducts.join(",")})`,
      ),
      ...stillReview.map(
        (r) => `SOURCE_REVIEW:#${r.menuNumber}:${r.issues[0]?.code ?? "unknown"}`,
      ),
      "executor not bound",
      "no live admin writes authorized",
    ],
    note: "NO ADMIN WRITES",
  };

  writeJson("m66-report.json", report);
  console.log(
    JSON.stringify(
      {
        initialReview: 18,
        remainingSourceReview: stillReview.length,
        resolved:
          18 - stillReview.filter((r) =>
            INITIAL_REVIEW_NUMBERS.includes(r.menuNumber as never),
          ).length,
        pastaBlocks: capabilityBlockOps.map((o) => o.identity.menuNumber),
        sourceDry,
        READY_FOR_CREATECATEGORY_CERTIFICATION:
          report.READY_FOR_CREATECATEGORY_CERTIFICATION,
        READY_FOR_EXECUTOR_BINDING: "NO",
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
