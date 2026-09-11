/**
 * Migration worker — extract → domain → decisions/questions → dry-run artifacts.
 * Hard rule: no live TakeAwayHero admin writes.
 */

import { mkdirSync, writeFileSync } from "node:fs";
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
} from "../planning/index.js";
import { DEFAULT_ADAPTER_CAPABILITIES } from "../tah/contracts/evidence.js";
import {
  buildAdminContractFingerprint,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
} from "../tah/contracts/fingerprint.js";
import { ADMIN_CONTRACT_VERSION } from "../tah/contracts/v1.js";
import { jobRunDir } from "./paths.js";
import { getPortalStore, type PortalStore } from "./store.js";
import type { JobMetrics, MigrationJob } from "./types.js";

export { readJobArtifact } from "./artifacts.js";

function writeJson(dir: string, name: string, data: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2), "utf8");
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
    questions.push({
      decisionCaseId: null,
      questionType: issue.code,
      title: `${issue.code}${productRef ? ` · ${productRef}` : ""}`,
      prompt: issue.message,
      optionsJson: JSON.stringify([
        {
          id: "accept_as_is",
          label: "Accept as-is (document exception)",
          resolution: "ACCEPT_EXCEPTION",
        },
        {
          id: "needs_source_fix",
          label: "Needs better source / re-extract",
          resolution: "NEEDS_SOURCE_FIX",
        },
        {
          id: "skip_product",
          label: "Skip product in dry-run plan",
          resolution: "SKIP_PRODUCT",
        },
      ]),
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

  if (job.sourceType === "source_url" && !store.listJobFiles(jobId).length) {
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
  if (!pdf) {
    if (job.sourceUrl) {
      store.updateJobStatus(jobId, "SOURCE_URL_PENDING", {
        errorMessage:
          "No PDF uploaded. URL fetch adapter is queued for a later milestone.",
      });
      return;
    }
    store.updateJobStatus(jobId, "FAILED", {
      errorMessage: "No PDF file attached to job",
    });
    return;
  }

  const runStub = store.createJobRun(jobId, "", "QUEUED");
  const outDir = jobRunDir(jobId, runStub.id);
  store.db
    .prepare(`UPDATE job_runs SET run_dir = ? WHERE id = ?`)
    .run(outDir, runStub.id);

  const metrics: JobMetrics = {};

  try {
    store.updateJobStatus(jobId, "EXTRACTING");
    store.db
      .prepare(`UPDATE job_runs SET status = ? WHERE id = ?`)
      .run("EXTRACTING", runStub.id);

    const adapter = new PdfSourceAdapter({ restaurantName: job.merchantName });
    const extraction = await adapter.extractDetailed({
      kind: "pdf",
      filePath: pdf.storedPath,
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

    store.updateJobStatus(jobId, "DOMAIN");
    store.db
      .prepare(`UPDATE job_runs SET status = ? WHERE id = ?`)
      .run("DOMAIN", runStub.id);

    const domain = runDomainEngine(extraction.sourceMenu);
    writeJson(outDir, "canonical-menu.json", domain.menu);
    writeJson(outDir, "validation-report.json", domain.validation);
    metrics.categoryCount = domain.menu.categories.length;
    metrics.validationBlocked = domain.validation.issues.filter(
      (i) => i.severity === "BLOCKED",
    ).length;
    metrics.validationWarnings = domain.validation.issues.filter(
      (i) => i.severity === "WARNING",
    ).length;

    store.updateJobStatus(jobId, "DECISIONS");
    store.db
      .prepare(`UPDATE job_runs SET status = ? WHERE id = ?`)
      .run("DECISIONS", runStub.id);

    const questions = issuesToQuestions(
      job,
      domain.menu,
      domain.validation.issues,
    );
    const created = store.replaceOpenQuestions(jobId, questions);
    writeJson(outDir, "remaining-review.json", {
      count: created.length,
      questions: created.map((q) => ({
        id: q.id,
        type: q.questionType,
        title: q.title,
        prompt: q.prompt,
        productRef: q.productRef,
        batchKey: q.batchKey,
      })),
    });
    metrics.remainingQuestions = created.length;

    store.updateJobStatus(jobId, "ARTIFACTS");
    const fingerprint = buildAdminContractFingerprint(
      TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
    );
    const emptyDest = {
      host: job.destinationHost,
      categories: [] as Array<{ databaseId: string; name: string }>,
      products: [] as Array<{
        databaseId: string;
        menuNumber: string;
        name: string;
        categoryIds: string[];
      }>,
    };
    const categoryMappings = mapSourceCategoriesToDestination(
      domain.menu.categories.map((c) => ({
        sourceId: c.sourceId,
        name: c.name,
      })),
      emptyDest.categories,
    );

    const plan = buildDryRunWritePlan({
      runId: runStub.id,
      restaurant: job.restaurantKey,
      host: job.destinationHost,
      source: pdf.originalName,
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
      adapterVersion: adapter.extractorVersion,
      contractFingerprint: fingerprint.fingerprint,
      canonical: domain.menu,
      categoryMappings,
      destination: emptyDest,
      capabilities: DEFAULT_ADAPTER_CAPABILITIES,
    });

    writeJson(outDir, "dry-run-writeplan.json", plan);
    writeJson(outDir, "dry-run-summary.json", {
      ...summarizeDryRun(plan),
      source: summarizeSourceDryRun(plan),
      liveWriteBlocked: true,
      liveWriteBlockers: [
        "createCategory not certified",
        "executor not bound to portal",
        "MVP dry-run only",
      ],
      adminContractVersion: ADMIN_CONTRACT_VERSION,
    });
    const dryCounts = summarizeDryRun(plan);
    metrics.dryRunCreates = dryCounts.CREATE ?? 0;
    metrics.dryRunReviews = dryCounts.REVIEW ?? 0;
    metrics.dryRunSkips = dryCounts.SKIP ?? 0;

    writeJson(outDir, "job-meta.json", {
      jobId: job.id,
      merchantName: job.merchantName,
      destinationHost: job.destinationHost,
      sourceUrl: job.sourceUrl,
      runId: runStub.id,
      finishedAt: new Date().toISOString(),
    });

    const finalStatus =
      created.length > 0 ? "AWAITING_REVIEW" : "READY_DRY_RUN";
    store.updateJobStatus(jobId, finalStatus, {
      remainingQuestions: created.length,
      errorMessage: null,
    });
    store.finishJobRun(runStub.id, finalStatus, metrics, null);
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
