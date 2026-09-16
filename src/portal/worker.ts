/**
 * Migration worker — extract → domain → decisions/questions → dry-run artifacts.
 * Live admin writes when TAH_ADMIN_* credentials exist + allowlisted host
 * (kill switch: PORTAL_LIVE_WRITES=0).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDomainEngine } from "../domain/engine.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../domain/versions.js";
import type { CanonicalMenu, ValidationIssue } from "../domain/schema/canonical.js";
import { PdfSourceAdapter } from "../extraction/pdf/adapter.js";
import {
  buildDryRunWritePlan,
  mapSourceCategoriesToDestination,
  summarizeDryRun,
  summarizeSourceDryRun,
  applyPizzaToppingRecovery,
  buildMenuReconcileReport,
  formatMenuReconcileMarkdown,
  type ProductPolicyTrace,
  type ProductReconcileDiff,
} from "../planning/index.js";
import { canonicalMenuFromLiveDestination } from "../planning/qaLiveImprove.js";
import type { DryRunDestinationSnapshot } from "../planning/dryRun.js";
import {
  loadAdditionLikelihood,
  loadIngredientLikelihood,
  loadPeerSnapshots,
  loadProbabilityPolicyForRestaurant,
  peerProbabilityPolicyPath,
  peerStructureSummaryPath,
  readLatestPeerObservePointer,
} from "../learning/peerArtifacts.js";
import {
  applyPeerAdditionPricesToMenu,
  distillPeerAdditionPriceBenchmark,
} from "../learning/peerAdditionPriceBenchmark.js";
import { upsertPeerAdditionFactsForMenu } from "../learning/additionLikelihood.js";
import { upsertCategoryIngredientAdditionFacts } from "../learning/categoryIngredientAdditions.js";
import { normalizeSourceCategoriesByKind } from "../learning/categoryKindNaming.js";
import { assertCreateCardQuality } from "../domain/menuCardQuality.js";
import {
  runMenuIntelligence,
  MENU_CONSTITUTION_VERSION,
} from "../intelligence/index.js";
import { buildAndWritePolicyApplicationReport } from "../learning/policyApplicationReport.js";
import type { StructurePatternSummary } from "../learning/peerMenuStructure.js";
import { M2B_ADAPTER_CAPABILITIES } from "../tah/contracts/evidence.js";
import {
  buildAdminContractFingerprint,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
} from "../tah/contracts/fingerprint.js";
import { ADMIN_CONTRACT_VERSION } from "../tah/contracts/v1.js";
import {
  executePortalLiveWrites,
  loadDestinationSnapshotForDryRun,
  portalLiveRunsDbPath,
} from "./liveExecute.js";
import { evaluatePortalLiveWriteGate } from "./liveWrites.js";
import { jobRunDir, portalDataDir, repoRoot } from "./paths.js";
import { getPortalStore, type PortalStore } from "./store.js";
import { DecisionStore } from "../decisions/store.js";
import {
  shouldSeedDefaultTilbehor,
  upsertVeroniTilbehorBusinessFact,
} from "../learning/structurePolicy.js";
import {
  buildTilbehorOverrideDecisionCase,
  portalQuestionFromTilbehorCase,
  resolvePortalDecisionDbPath,
  selectTilbehorOverrideTraces,
} from "../learning/tilbehorOverride.js";
import { pizzaToppingReviewQuestions } from "../learning/pizzaToppingReview.js";
import type { JobMetrics, JobStatus, MigrationJob } from "./types.js";

export { readJobArtifact } from "./artifacts.js";

function writeJson(dir: string, name: string, data: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2), "utf8");
}

/** Plain-language review copy — operators should not need engine jargon. */
function operatorFacingIssueCopy(issue: ValidationIssue): {
  title: string;
  prompt: string;
  options: Array<{ id: string; label: string; resolution: string; help: string }>;
} {
  const ref = issue.entityId ? shortProductRef(issue.entityId) : "this product";
  const options = [
    {
      id: "accept_as_is",
      label: "Continue anyway",
      resolution: "ACCEPT_EXCEPTION",
      help: "Keep going with the extracted menu. Does not teach a lasting rule.",
    },
    {
      id: "needs_source_fix",
      label: "PDF is unclear — re-upload later",
      resolution: "NEEDS_SOURCE_FIX",
      help: "Marks the source as bad. Does not auto re-scan; start a new job with a cleaner PDF.",
    },
    {
      id: "skip_product",
      label: "Leave this product alone",
      resolution: "SKIP_PRODUCT",
      help: "Don’t treat this line as something to fix/write right now.",
    },
  ];

  if (issue.code === "MALFORMED_PRODUCT_CHOICE") {
    return {
      title: `Broken option link · ${ref}`,
      prompt: `The PDF mentioned a choice/option for “${ref}” that we could not match to a real menu item (often a half-read name like a calzone or rice dish). Peer practices for prices and Tilbehør still apply automatically — this question is only about this broken option.\n\nTechnical detail: ${issue.message}`,
      options,
    };
  }

  return {
    title: `Needs a decision · ${ref}`,
    prompt: `${issue.message}\n\nPeer menu practices still run automatically. Your answer here only clears this review item for this job — it does not lock in a global rule unless the question is a learned policy case.`,
    options,
  };
}

function shortProductRef(entityId: string): string {
  const tail = entityId.split(":").pop() ?? entityId;
  return tail.replace(/::choice-pending$/i, "").slice(0, 48);
}

function issuesToQuestions(
  job: MigrationJob,
  menu: CanonicalMenu,
  issues: ValidationIssue[],
): Array<{
  decisionCaseId: string | null;
  questionType: string;
  title: string;
  prompt: string;
  optionsJson: string;
  productRef: string | null;
  batchKey: string | null;
}> {
  const blocked = issues.filter(
    (i) =>
      i.severity === "BLOCKED" || i.severity === "MANUAL_REVIEW_REQUIRED",
  );
  const questions = [];
  for (const issue of blocked.slice(0, 80)) {
    const productRef = issue.entityId || null;
    const batchKey = `${issue.code}:${issue.field ?? "menu"}`;
    const copy = operatorFacingIssueCopy(issue);
    questions.push({
      decisionCaseId: null,
      questionType: issue.code,
      title: copy.title,
      prompt: copy.prompt,
      optionsJson: JSON.stringify(copy.options),
      productRef,
      batchKey,
    });
  }

  // Category mapping placeholders often need human confirmation
  for (const cat of menu.categories) {
    if (/struktur|placeholder|vaelg|vælg/i.test(cat.name)) {
      questions.push({
        decisionCaseId: null,
        questionType: "CATEGORY_MAPPING",
        title: `Confirm category mapping · ${cat.name}`,
        prompt: `Source category "${cat.name}" may be a structure placeholder. Confirm how products should map on ${job.destinationHost}.`,
        optionsJson: JSON.stringify([
          {
            id: "map_pizza",
            label: "Map products into Pizza",
            resolution: "MAP_PIZZA",
          },
          {
            id: "map_review",
            label: "Keep in review / do not auto-map",
            resolution: "KEEP_REVIEW",
          },
        ]),
        productRef: cat.sourceId,
        batchKey: `CATEGORY_MAPPING:${cat.name}`,
      });
    }
  }

  return questions;
}

export async function runMigrationJob(
  jobId: string,
  store: PortalStore = getPortalStore(),
): Promise<void> {
  const job = store.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const isQaJob = job.workflow === "QA_RECONCILE";

  if (
    !isQaJob &&
    job.sourceType === "source_url" &&
    !store.listJobFiles(jobId).length
  ) {
    store.updateJobStatus(jobId, "SOURCE_URL_PENDING", {
      errorMessage:
        "Source URL saved. HTML menu-site extraction is not certified in this milestone — upload a PDF to run end-to-end.",
    });
    return;
  }

  const files = store.listJobFiles(jobId);
  const pdf = files.find(
    (f) =>
      f.mimeType === "application/pdf" ||
      f.originalName.toLowerCase().endsWith(".pdf"),
  );
  const image = files.find((f) => {
    const n = f.originalName.toLowerCase();
    return (
      f.mimeType.startsWith("image/") ||
      /\.(png|jpe?g|webp)$/i.test(n)
    );
  });
  if (!isQaJob && !pdf && !image) {
    if (job.sourceUrl) {
      store.updateJobStatus(jobId, "SOURCE_URL_PENDING", {
        errorMessage:
          "No menu file uploaded. Upload a PDF or clear photo to run end-to-end.",
      });
      return;
    }
    store.updateJobStatus(jobId, "FAILED", {
      errorMessage: "No PDF or menu photo attached to job",
    });
    return;
  }

  const sourceUpload = pdf ?? image!;
  const sourceKind = pdf ? ("pdf" as const) : ("image" as const);

  const runStub = store.createJobRun(jobId, "", "QUEUED");
  const outDir = jobRunDir(jobId, runStub.id);
  store.db
    .prepare(`UPDATE job_runs SET run_dir = ? WHERE id = ?`)
    .run(outDir, runStub.id);

  const metrics: JobMetrics = {};
  let sourceLabel = "live_destination";
  let adapterVersion = "qa-live-improve";
  let preloadedDestination: {
    source: "live";
    destination: DryRunDestinationSnapshot;
    error?: string;
  } | null = null;

  try {
    store.updateJobStatus(jobId, "EXTRACTING");
    store.db
      .prepare(`UPDATE job_runs SET status = ? WHERE id = ?`)
      .run("EXTRACTING", runStub.id);

    let recovered: ReturnType<typeof applyPizzaToppingRecovery>;

    if (isQaJob) {
      const destLoad = await loadDestinationSnapshotForDryRun({
        destinationHost: job.destinationHost,
        deep: true,
      });
      if (destLoad.source !== "live") {
        const detail = destLoad.error ?? "gate blocked or empty";
        const chromiumHint =
          /Executable doesn't exist|playwright install/i.test(detail)
            ? " Playwright Chromium is missing on the server — redeploy so portal-start can install it."
            : "";
        throw new Error(
          `QA_RECONCILE requires a live destination snapshot. Set TAH_ADMIN_EMAIL and TAH_ADMIN_PASSWORD on the portal service, ensure the host is allowlisted (any host by default; set PORTAL_LIVE_WRITE_HOSTS to restrict), and that Playwright can log into admin.${chromiumHint} ${detail}`,
        );
      }
      preloadedDestination = {
        source: "live",
        destination: destLoad.destination,
        ...(destLoad.error ? { error: destLoad.error } : {}),
      };
      writeJson(outDir, "source-menu.json", {
        kind: "live_destination",
        host: destLoad.destination.host,
        categoryCount: destLoad.destination.categories.length,
        productCount: destLoad.destination.products.length,
      });
      metrics.uniqueProducts = destLoad.destination.products.length;
      const liveMenu = canonicalMenuFromLiveDestination({
        restaurantName: job.merchantName,
        destination: destLoad.destination,
      });
      recovered = applyPizzaToppingRecovery(liveMenu);
      sourceLabel = "live_destination";
      adapterVersion = "qa-live-improve";
    } else {
      const adapter = new PdfSourceAdapter({ restaurantName: job.merchantName });
      const extraction = await adapter.extractDetailed({
        kind: sourceKind,
        filePath: sourceUpload.storedPath,
      });

      writeJson(outDir, "source-menu.json", extraction.sourceMenu);
      writeJson(outDir, "extraction-accounting.json", {
        accounting: extraction.accounting,
        pageCount: extraction.pageCount,
        uniqueProducts: extraction.uniqueProducts,
        duplicateOccurrences: extraction.duplicateOccurrences,
      });
      metrics.pageCount = extraction.pageCount;
      metrics.uniqueProducts = extraction.uniqueProducts;
      sourceLabel = sourceUpload.originalName;
      adapterVersion = adapter.extractorVersion;

      if (
        extraction.sourceMenu.categories.reduce(
          (n, c) => n + c.products.length,
          0,
        ) === 0
      ) {
        throw new Error(
          `PDF extraction found no usable products across ${extraction.pageCount} page(s) ` +
            `(candidates=${extraction.accounting.summary.candidatesDetected}, extracted=${extraction.accounting.summary.extracted}). ` +
            `Image-only / low-quality scans often need a clearer photo or text PDF. Retry Create with a better file.`,
        );
      }

      store.updateJobStatus(jobId, "DOMAIN");
      store.db
        .prepare(`UPDATE job_runs SET status = ? WHERE id = ?`)
        .run("DOMAIN", runStub.id);

      const peers = loadPeerSnapshots(repoRoot());
      const namedSource = normalizeSourceCategoriesByKind(
        extraction.sourceMenu,
        peers,
      );
      writeJson(outDir, "source-menu.json", namedSource);
      const domain = runDomainEngine(namedSource);
      recovered = applyPizzaToppingRecovery(domain.menu);
    }

    if (isQaJob) {
      store.updateJobStatus(jobId, "DOMAIN");
      store.db
        .prepare(`UPDATE job_runs SET status = ? WHERE id = ?`)
        .run("DOMAIN", runStub.id);
    }

    writeJson(outDir, "canonical-menu.json", recovered.menu);
    writeJson(outDir, "validation-report.json", recovered.validation);
    if (recovered.recovered.length) {
      writeJson(outDir, "pizza-topping-recovery.json", {
        count: recovered.recovered.length,
        products: recovered.recovered.map((r) => ({
          menuNumber: r.menuNumber,
          name: r.name,
          ingredients: r.proposal.ingredients,
          excludedDips: r.proposal.excludedDips,
        })),
      });
    }

    const root = repoRoot();
    const peerSnaps = loadPeerSnapshots(root);
    const priceBenchmark =
      peerSnaps.length > 0
        ? distillPeerAdditionPriceBenchmark(peerSnaps)
        : null;
    const pricedMenu = applyPeerAdditionPricesToMenu({
      menu: recovered.menu,
      benchmark: priceBenchmark,
    });
    recovered.menu = pricedMenu.menu;
    writeJson(outDir, "canonical-menu.json", recovered.menu);
    if (pricedMenu.priced.length) {
      writeJson(outDir, "peer-addition-prices.json", {
        count: pricedMenu.priced.length,
        fingerprint: priceBenchmark?.fingerprint ?? null,
        sample: pricedMenu.priced.slice(0, 40),
      });
    }

    metrics.categoryCount = recovered.menu.categories.length;
    metrics.validationBlocked = recovered.validation.blockedCount;
    metrics.validationWarnings = recovered.validation.warningCount;

    store.updateJobStatus(jobId, "DECISIONS");
    store.db
      .prepare(`UPDATE job_runs SET status = ? WHERE id = ?`)
      .run("DECISIONS", runStub.id);

    const decisionDbPath = resolvePortalDecisionDbPath(root);
    mkdirSync(join(root, "runs", "decisions"), { recursive: true });
    const decisionStore = new DecisionStore(decisionDbPath);
    const seededDefaultTilbehor = shouldSeedDefaultTilbehor(job.restaurantKey);
    if (seededDefaultTilbehor) {
      upsertVeroniTilbehorBusinessFact({
        store: decisionStore,
        restaurantKey: job.restaurantKey,
      });
    }

    const additionLikelihood = loadAdditionLikelihood(root);
    const ingredientLikelihoodEarly = loadIngredientLikelihood(root);
    const probabilityPolicyEarly = loadProbabilityPolicyForRestaurant(
      root,
      job.restaurantKey,
    );

    // Persist addition facts BEFORE intelligence so fan-out is inside the engine.
    const categoryIngredient = upsertCategoryIngredientAdditionFacts({
      store: decisionStore,
      restaurantKey: job.restaurantKey,
      menu: recovered.menu,
      likelihood: additionLikelihood,
    });
    if (categoryIngredient.facts.length) {
      writeJson(outDir, "category-ingredient-additions.json", {
        categoriesWithUnion: categoryIngredient.categoriesWithUnion,
        compositions: categoryIngredient.compositions
          .filter((c) => c.additions.length > 0)
          .map((c) => ({
            category: c.categoryName,
            reason: c.reason,
            count: c.additions.length,
            sample: c.additions.slice(0, 12).map((a) => ({
              name: a.name,
              priceOre: a.priceOre,
              priceSource: a.priceSource,
            })),
          })),
      });
    }

    let peerAdditionCategories: Array<{
      category: string;
      kind: string;
      count: number;
    }> = [];
    if (additionLikelihood) {
      const applied = upsertPeerAdditionFactsForMenu({
        store: decisionStore,
        restaurantKey: job.restaurantKey,
        menu: recovered.menu,
        likelihood: additionLikelihood,
        skipCategories: categoryIngredient.categoriesWithUnion,
      });
      peerAdditionCategories = applied.categories;
      writeJson(outDir, "peer-addition-facts.json", {
        fingerprint: additionLikelihood.fingerprint,
        skippedForCategoryIngredient: categoryIngredient.categoriesWithUnion,
        categories: applied.categories,
        proposedSets: additionLikelihood.proposedSets.map((p) => ({
          kind: p.kind,
          count: p.additions.length,
          top: p.additions.slice(0, 8).map((a) => ({
            name: a.name,
            pHat: a.pHat,
            priceOre: a.priceOre,
          })),
        })),
      });
    }

    // ONE Menu Intelligence Engine for Create + QA (facts already in DecisionStore).
    const intelligence = runMenuIntelligence({
      mode: isQaJob ? "QA_RECONCILE" : "CREATE_MENU",
      restaurantName: job.merchantName,
      restaurantKey: job.restaurantKey,
      canonicalMenu: recovered.menu,
      decisionStore,
      ingredientLikelihood: ingredientLikelihoodEarly,
      additionLikelihood,
      probabilityPolicy: probabilityPolicyEarly,
    });
    recovered.menu = intelligence.targetMenu;
    writeJson(outDir, "target-menu.json", recovered.menu);
    writeJson(outDir, "canonical-menu-enriched.json", recovered.menu);
    writeJson(outDir, "quality-report.json", intelligence.quality);
    writeJson(outDir, "intelligence-trace.json", {
      constitutionVersion: intelligence.constitutionVersion,
      mode: intelligence.mode,
      writeEligible: intelligence.writeEligible,
      writeBlockReason: intelligence.writeBlockReason ?? null,
      policyTraces: intelligence.policyTraces,
    });
    writeJson(outDir, "menu-intelligence-result.json", {
      constitutionVersion: intelligence.constitutionVersion,
      mode: intelligence.mode,
      writeEligible: intelligence.writeEligible,
      writeBlockReason: intelligence.writeBlockReason ?? null,
      quality: intelligence.quality,
    });
    writeJson(outDir, "policy-application-trace.json", {
      constitutionVersion: MENU_CONSTITUTION_VERSION,
      products: intelligence.policyTraces,
    });

    store.updateJobStatus(jobId, "ARTIFACTS");
    store.db
      .prepare(`UPDATE job_runs SET status = ? WHERE id = ?`)
      .run("ARTIFACTS", runStub.id);
    const fingerprint = buildAdminContractFingerprint(
      TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
    );
    const isQa = job.workflow === "QA_RECONCILE";
    const liveGate = evaluatePortalLiveWriteGate({
      destinationHost: job.destinationHost,
    });
    const destLoad =
      preloadedDestination ??
      (await loadDestinationSnapshotForDryRun({
        destinationHost: job.destinationHost,
        deep: isQa,
      }));
    // Always require a real live catalog whenever credentials/allowlist enable it
    // (and always for QA). Never plan against an empty fake destination.
    if (destLoad.source !== "live") {
      const detail = destLoad.error ?? "gate blocked or empty";
      const chromiumHint = /Executable doesn't exist|playwright install/i.test(
        detail,
      )
        ? " Playwright Chromium is missing on the server — redeploy so portal-start can install it."
        : "";
      throw new Error(
        `${isQa ? "QA_RECONCILE" : "Create"} requires a live destination snapshot. Set TAH_ADMIN_EMAIL and TAH_ADMIN_PASSWORD on the portal service, ensure the host is allowlisted (any host by default; set PORTAL_LIVE_WRITE_HOSTS to restrict), and that Playwright can log into admin.${chromiumHint} ${detail}`,
      );
    }
    const destination = destLoad.destination;
    writeJson(outDir, "destination-snapshot-meta.json", {
      source: destLoad.source,
      host: destination.host,
      categoryCount: destination.categories.length,
      productCount: destination.products.length,
      deep: isQa,
      workflow: job.workflow,
      ...(destLoad.error ? { error: destLoad.error } : {}),
    });
    const categoryMappings = mapSourceCategoriesToDestination(
      recovered.menu.categories.map((c) => ({
        sourceId: c.sourceId,
        name: c.name,
      })),
      destination.categories,
    );

    const policyTraces: ProductPolicyTrace[] = [];
    const reconcileDiffs: ProductReconcileDiff[] = [];
    const probabilityPolicy = loadProbabilityPolicyForRestaurant(
      root,
      job.restaurantKey,
    );
    const ingredientLikelihood = loadIngredientLikelihood(root);
    const plan = buildDryRunWritePlan({
      runId: runStub.id,
      restaurant: job.restaurantKey,
      host: job.destinationHost,
      source: sourceLabel,
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
      adapterVersion,
      contractFingerprint: fingerprint.fingerprint,
      canonical: recovered.menu,
      categoryMappings,
      destination,
      capabilities: M2B_ADAPTER_CAPABILITIES,
      decisionStore,
      ...(probabilityPolicy ? { probabilityPolicy } : {}),
      ...(ingredientLikelihood ? { ingredientLikelihood } : {}),
      policyTraces,
      ...(isQa
        ? { emitReconcileUpdates: true, reconcileDiffs }
        : {}),
    });

    writeJson(outDir, "dry-run-writeplan.json", plan);

    const planGate = assertCreateCardQuality(plan);
    const cardGate = {
      ok: planGate.ok && intelligence.writeEligible,
      blockers: [
        ...(!intelligence.writeEligible
          ? [
              intelligence.writeBlockReason ??
                `MenuQualityContract ${intelligence.quality.menuStatus}`,
            ]
          : []),
        ...planGate.blockers,
      ],
      constitutionVersion: MENU_CONSTITUTION_VERSION,
      menuQualityStatus: intelligence.quality.menuStatus,
      planGateOk: planGate.ok,
      intelligenceWriteEligible: intelligence.writeEligible,
    };
    writeJson(outDir, "create-card-quality-gate.json", cardGate);
    writeJson(outDir, "menu-quality-contract.json", intelligence.quality);

    let reconcileReport = null as ReturnType<
      typeof buildMenuReconcileReport
    > | null;
    if (isQa) {
      reconcileReport = buildMenuReconcileReport({
        restaurantKey: job.restaurantKey,
        host: job.destinationHost,
        products: reconcileDiffs,
      });
      writeJson(outDir, "menu-reconcile.json", reconcileReport);
      writeFileSync(
        join(outDir, "menu-reconcile.md"),
        formatMenuReconcileMarkdown(reconcileReport),
        "utf8",
      );
    }

    // Seed review from validation issues + Tilbehør override traces (Loop D feedback)
    const issueQuestions = issuesToQuestions(
      job,
      recovered.menu,
      recovered.validation.issues,
    );
    const overrideTraces = selectTilbehorOverrideTraces(policyTraces);
    const overrideQuestions = [];
    for (const trace of overrideTraces) {
      const dc = buildTilbehorOverrideDecisionCase({
        runId: runStub.id,
        restaurantKey: job.restaurantKey,
        host: job.destinationHost,
        trace,
      });
      decisionStore.upsertCase(dc);
      overrideQuestions.push(portalQuestionFromTilbehorCase(dc));
    }
    const created = store.replaceOpenQuestions(jobId, [
      ...issueQuestions,
      ...overrideQuestions,
      ...pizzaToppingReviewQuestions(recovered.menu),
    ]);
    writeJson(outDir, "remaining-review.json", {
      count: created.length,
      tilbehorOverrideCount: overrideQuestions.length,
      questions: created.map((q) => ({
        id: q.id,
        type: q.questionType,
        title: q.title,
        prompt: q.prompt,
        productRef: q.productRef,
        batchKey: q.batchKey,
        decisionCaseId: q.decisionCaseId,
      })),
    });
    metrics.remainingQuestions = created.length;

    const structureSummaryPath = peerStructureSummaryPath(root);
    let structurePattern: StructurePatternSummary | null = null;
    if (existsSync(structureSummaryPath)) {
      try {
        structurePattern = JSON.parse(
          readFileSync(structureSummaryPath, "utf8"),
        ) as StructurePatternSummary;
      } catch {
        structurePattern = null;
      }
    }
    const policyReport = buildAndWritePolicyApplicationReport(root, {
      runId: runStub.id,
      restaurantKey: job.restaurantKey,
      host: job.destinationHost,
      structurePattern,
      probabilityPolicy,
      ingredientLikelihood,
      productTraces: policyTraces,
      peerObserve: readLatestPeerObservePointer(root),
      ...(probabilityPolicy
        ? { probabilityPolicyPath: peerProbabilityPolicyPath(root) }
        : {}),
      structureSummaryPath,
      businessFacts: [
        ...(seededDefaultTilbehor
          ? [
              {
                name: "Default Tilbehør seed",
                detail:
                  "Restaurant BUSINESS_FACT (mayo/ketchup defaults) + operator EXACT_PRODUCT overrides",
              },
            ]
          : [
              {
                name: "No default Tilbehør seed",
                detail:
                  "New merchants do not inherit Veroni Tilbehør; only operator EXACT_PRODUCT overrides apply",
              },
            ]),
        ...(categoryIngredient.categoriesWithUnion.length
          ? [
              {
                name: "Category ingredient Tilbehør",
                detail: categoryIngredient.categoriesWithUnion
                  .map((name) => {
                    const c = categoryIngredient.compositions.find(
                      (x) => x.categoryName === name,
                    );
                    return `${name}: ${c?.additions.length ?? 0} extras from ingredient union`;
                  })
                  .join("; "),
              },
            ]
          : []),
        ...(peerAdditionCategories.length
          ? [
              {
                name: "Peer addition likelihood facts",
                detail: peerAdditionCategories
                  .map((c) => `${c.category} (${c.kind}): ${c.count} extras`)
                  .join("; "),
              },
            ]
          : []),
        ...(ingredientLikelihood
          ? [
              {
                name: "Peer ingredient likelihood",
                detail: `Fingerprint ${ingredientLikelihood.fingerprint}; subtypes ${Object.keys(ingredientLikelihood.bySubtype).join(", ") || "(none)"} — peer-first card fill with domain prior fallback`,
              },
            ]
          : []),
      ],
    });
    writeJson(outDir, "policy-application.json", policyReport.report);
    writeFileSync(
      join(outDir, "policy-application.md"),
      readFileSync(policyReport.mdPath, "utf8"),
      "utf8",
    );

    writeJson(outDir, "dry-run-summary.json", {
      ...summarizeDryRun(plan),
      source: summarizeSourceDryRun(plan),
      workflow: job.workflow,
      destinationSource: destLoad.source,
      liveWriteBlocked: !liveGate.canLiveExecute,
      policyApplication: {
        productTraces: policyTraces.length,
        reportPath: policyReport.jsonPath,
        probabilityFingerprint: probabilityPolicy?.fingerprint ?? null,
        ingredientLikelihoodFingerprint:
          ingredientLikelihood?.fingerprint ?? null,
        structureFingerprint: structurePattern?.fingerprint ?? null,
        tilbehorOverrideQuestions: overrideQuestions.length,
      },
      ...(reconcileReport
        ? {
            reconcile: {
              fingerprint: reconcileReport.fingerprint,
              withDiffs: reconcileReport.withDiffs,
              updatable: reconcileReport.updatable,
              blocked: reconcileReport.blocked,
            },
          }
        : {}),
      liveWriteBlockers: liveGate.blockers,
      liveWritesFlag: liveGate.enabled,
      adminContractVersion: ADMIN_CONTRACT_VERSION,
      sourceFile: sourceLabel,
    });
    const dryCounts = summarizeDryRun(plan);
    metrics.dryRunCreates = dryCounts.CREATE ?? 0;
    metrics.dryRunReviews = dryCounts.REVIEW ?? 0;
    metrics.dryRunSkips = dryCounts.SKIP ?? 0;
    metrics.dryRunUpdates = dryCounts.UPDATE ?? 0;
    metrics.dryRunBlocks = dryCounts.BLOCK ?? 0;
    if (reconcileReport) {
      metrics.reconcileDiffs = reconcileReport.withDiffs;
      metrics.reconcileUpdatable = reconcileReport.updatable;
    }

    writeJson(outDir, "job-meta.json", {
      jobId: job.id,
      merchantName: job.merchantName,
      destinationHost: job.destinationHost,
      sourceUrl: job.sourceUrl,
      workflow: job.workflow,
      runId: runStub.id,
      finishedAt: new Date().toISOString(),
      decisionDbPath,
      source: sourceLabel,
    });

    decisionStore.close();

    let finalStatus: JobStatus =
      created.length > 0
        ? "AWAITING_REVIEW"
        : !cardGate.ok
          ? "READY_DRY_RUN"
          : "READY_DRY_RUN";

    // MenuQualityContract blocks live writes for BOTH Create and QA.
    const willAutoLive =
      liveGate.canLiveExecute &&
      created.length === 0 &&
      cardGate.ok;

    if (!cardGate.ok) {
      writeJson(outDir, "live-write-blocked-by-card-gate.json", cardGate);
    }

    if (willAutoLive) {
      try {
        store.updateJobStatus(jobId, "WRITING");
        const live = await executePortalLiveWrites({
          runId: `live-${runStub.id}`,
          restaurant: job.restaurantKey,
          destinationHost: job.destinationHost,
          source: sourceLabel,
          schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
          domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
          adapterVersion,
          contractFingerprint: fingerprint.fingerprint,
          canonical: recovered.menu,
          runsDbPath: portalLiveRunsDbPath(portalDataDir()),
          workflow: job.workflow,
          ingredientLikelihood: ingredientLikelihoodEarly,
        });
        writeJson(outDir, "live-writeplan.json", live.livePlan);
        writeJson(outDir, "live-destination-snapshot.json", live.destination);
        writeJson(outDir, "live-execute-result.json", live.result);
        finalStatus =
          live.result.failed + live.result.blocked > 0
            ? "COMPLETED_WITH_ERRORS"
            : "COMPLETED";
      } catch (liveErr) {
        const message =
          liveErr instanceof Error ? liveErr.message : String(liveErr);
        writeJson(outDir, "live-execute-error.json", {
          message,
          at: new Date().toISOString(),
        });
        finalStatus = "READY_DRY_RUN";
        store.updateJobStatus(jobId, finalStatus, {
          remainingQuestions: 0,
          errorMessage: `Live write failed (dry-run kept): ${message}`,
        });
        store.finishJobRun(runStub.id, finalStatus, metrics, message);
        return;
      }
    }

    store.updateJobStatus(jobId, finalStatus, {
      remainingQuestions: created.length,
      errorMessage:
        !cardGate.ok && finalStatus === "READY_DRY_RUN"
          ? `MenuQualityContract blocked live write: ${cardGate.blockers.join("; ")}`
          : null,
    });
    store.finishJobRun(
      runStub.id,
      finalStatus,
      metrics,
      !cardGate.ok ? cardGate.blockers.join("; ") : null,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeJson(outDir, "error.json", {
      message,
      at: new Date().toISOString(),
    });
    store.updateJobStatus(jobId, "FAILED", { errorMessage: message });
    store.finishJobRun(runStub.id, "FAILED", metrics, message);
    throw err;
  }
}

export function scheduleMigrationJob(jobId: string): void {
  void runMigrationJob(jobId).catch((err) => {
    console.error(`[portal-worker] job ${jobId} failed:`, err);
  });
}

/**
 * After review clears, run gated live writes from existing canonical artifacts
 * (does not re-extract / re-seed review questions).
 */
export function schedulePostReviewLiveIfReady(jobId: string): void {
  void runPostReviewLiveIfReady(jobId).catch((err) => {
    console.error(`[portal-worker] post-review live ${jobId} failed:`, err);
  });
}

export async function runPostReviewLiveIfReady(jobId: string): Promise<{
  ran: boolean;
  reason?: string;
}> {
  const store = getPortalStore();
  const job = store.getJob(jobId);
  if (!job) return { ran: false, reason: "job_missing" };

  const open = store.listOpenQuestions(jobId).length;
  if (open > 0) return { ran: false, reason: "open_questions" };

  const liveGate = evaluatePortalLiveWriteGate({
    destinationHost: job.destinationHost,
  });
  if (!liveGate.canLiveExecute) {
    return { ran: false, reason: `live_blocked:${liveGate.blockers.join(",")}` };
  }

  const run = store.latestJobRun(jobId);
  if (!run?.runDir) return { ran: false, reason: "no_run_dir" };

  if (job.workflow === "QA_RECONCILE") {
    const reconcilePath = join(run.runDir, "menu-reconcile.json");
    if (!existsSync(reconcilePath)) {
      return { ran: false, reason: "qa_missing_reconcile_report" };
    }
  }

  const menuPath = join(run.runDir, "canonical-menu.json");
  if (!existsSync(menuPath)) return { ran: false, reason: "no_canonical_menu" };

  let canonical: CanonicalMenu;
  try {
    canonical = JSON.parse(readFileSync(menuPath, "utf8")) as CanonicalMenu;
  } catch {
    return { ran: false, reason: "canonical_unreadable" };
  }

  const jobMetaPath = join(run.runDir, "job-meta.json");
  let source = "portal";
  if (existsSync(jobMetaPath)) {
    try {
      const meta = JSON.parse(readFileSync(jobMetaPath, "utf8")) as {
        source?: string;
      };
      if (meta.source) source = meta.source;
    } catch {
      /* keep default */
    }
  }
  const drySummaryPath = join(run.runDir, "dry-run-summary.json");
  if (existsSync(drySummaryPath) && source === "portal") {
    try {
      const dry = JSON.parse(readFileSync(drySummaryPath, "utf8")) as {
        sourceFile?: string;
      };
      if (dry.sourceFile) source = dry.sourceFile;
    } catch {
      /* keep */
    }
  }

  const fingerprint = buildAdminContractFingerprint(
    TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
  );

  store.updateJobStatus(jobId, "WRITING", {
    remainingQuestions: 0,
    errorMessage: null,
  });

  try {
    const live = await executePortalLiveWrites({
      runId: `live-postreview-${run.id}`,
      restaurant: job.restaurantKey,
      destinationHost: job.destinationHost,
      source,
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
      adapterVersion: "portal-post-review",
      contractFingerprint: fingerprint.fingerprint,
      canonical,
      runsDbPath: portalLiveRunsDbPath(portalDataDir()),
      workflow: job.workflow,
    });
    writeJson(run.runDir, "live-writeplan.json", live.livePlan);
    writeJson(run.runDir, "live-destination-snapshot.json", live.destination);
    writeJson(run.runDir, "live-execute-result.json", live.result);
    const finalStatus: JobStatus =
      live.result.failed + live.result.blocked > 0
        ? "COMPLETED_WITH_ERRORS"
        : "COMPLETED";
    store.updateJobStatus(jobId, finalStatus, {
      remainingQuestions: 0,
      errorMessage: null,
    });
    return { ran: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeJson(run.runDir, "live-execute-error.json", {
      message,
      at: new Date().toISOString(),
      phase: "post-review",
    });
    store.updateJobStatus(jobId, "READY_DRY_RUN", {
      remainingQuestions: 0,
      errorMessage: `Live write failed after review (dry-run kept): ${message}`,
    });
    return { ran: false, reason: `live_error:${message}` };
  }
}
