import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPortalStore, type PortalStore } from "./store.js";
import type { JobMetrics, JobStatus } from "./types.js";

/** Read a JSON artifact from the latest job run (no extraction imports). */
export function readJobArtifact(
  jobId: string,
  name: string,
  store: PortalStore = getPortalStore(),
): unknown | null {
  const run = store.latestJobRun(jobId);
  if (!run?.runDir) return null;
  const path = join(run.runDir, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const IN_FLIGHT: JobStatus[] = [
  "QUEUED",
  "EXTRACTING",
  "DOMAIN",
  "DECISIONS",
  "ARTIFACTS",
];

/**
 * If the worker wrote finished artifacts but DB status was left mid-flight
 * (e.g. container restart), reconcile job + run rows from disk.
 */
export function reconcileJobStatusFromArtifacts(
  jobId: string,
  store: PortalStore = getPortalStore(),
): void {
  const job = store.getJob(jobId);
  if (!job || !IN_FLIGHT.includes(job.status)) return;

  const run = store.latestJobRun(jobId);
  if (!run?.runDir) return;

  const metaPath = join(run.runDir, "job-meta.json");
  const summaryPath = join(run.runDir, "dry-run-summary.json");
  const reviewPath = join(run.runDir, "remaining-review.json");
  if (!existsSync(metaPath) || !existsSync(summaryPath)) return;

  let remaining = 0;
  if (existsSync(reviewPath)) {
    try {
      const review = JSON.parse(readFileSync(reviewPath, "utf8")) as {
        count?: number;
      };
      remaining = Number(review.count ?? 0);
    } catch {
      remaining = store.listOpenQuestions(jobId).length;
    }
  } else {
    remaining = store.listOpenQuestions(jobId).length;
  }

  // Ensure open questions exist in DB if artifact lists them but DB is empty
  if (remaining > 0 && store.listOpenQuestions(jobId).length === 0) {
    try {
      const review = JSON.parse(readFileSync(reviewPath, "utf8")) as {
        questions?: Array<{
          id?: string;
          type?: string;
          title?: string;
          prompt?: string;
          productRef?: string | null;
          batchKey?: string | null;
        }>;
      };
      if (review.questions?.length) {
        store.replaceOpenQuestions(
          jobId,
          review.questions.map((q) => ({
            decisionCaseId: null,
            questionType: q.type ?? "REVIEW",
            title: q.title ?? "Review",
            prompt: q.prompt ?? "",
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
            productRef: q.productRef ?? null,
            batchKey: q.batchKey ?? null,
          })),
        );
        remaining = store.listOpenQuestions(jobId).length;
      }
    } catch {
      /* keep remaining from artifact count */
    }
  }

  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as Record<
    string,
    unknown
  >;
  const metrics: JobMetrics = {
    remainingQuestions: remaining,
    dryRunCreates: Number(summary.CREATE ?? 0),
    dryRunReviews: Number(summary.REVIEW ?? 0),
    dryRunSkips: Number(summary.SKIP ?? 0),
  };

  let approvalReady = false;
  const cardGatePath = join(run.runDir, "create-card-quality-gate.json");
  if (job.workflow === "CREATE_MENU" && existsSync(cardGatePath)) {
    try {
      const gate = JSON.parse(readFileSync(cardGatePath, "utf8")) as {
        ok?: boolean;
      };
      approvalReady = gate.ok === true;
    } catch {
      approvalReady = false;
    }
  }
  const finalStatus: JobStatus =
    remaining > 0
      ? "AWAITING_REVIEW"
      : approvalReady
        ? "AWAITING_OPERATOR_APPROVAL"
        : "READY_DRY_RUN";
  store.updateJobStatus(jobId, finalStatus, {
    remainingQuestions: remaining,
    errorMessage: null,
  });
  if (!run.finishedAt) {
    store.finishJobRun(run.id, finalStatus, metrics, null);
  }
}
