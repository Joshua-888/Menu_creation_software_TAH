/**
 * Aggregate portal jobs into a merchant-facing dashboard view.
 */

import type { JobStatus, JobWorkflow, MigrationJob } from "./types.js";

export type MerchantDashboardRow = {
  restaurantKey: string;
  merchantName: string;
  destinationHost: string;
  latestJobId: string;
  latestStatus: JobStatus;
  latestWorkflow: JobWorkflow;
  jobCount: number;
  createJobCount: number;
  qaJobCount: number;
  remainingQuestions: number;
  updatedAt: string;
};

export function statusTone(
  status: JobStatus,
): "ok" | "warn" | "danger" | "neutral" {
  if (status === "COMPLETED") return "ok";
  if (
    status === "FAILED" ||
    status === "COMPLETED_WITH_ERRORS" ||
    status === "CANCELLED"
  ) {
    return "danger";
  }
  if (
    status === "AWAITING_REVIEW" ||
    status === "SOURCE_URL_PENDING" ||
    status === "READY_DRY_RUN"
  ) {
    return "warn";
  }
  return "neutral";
}

export function statusLabel(status: JobStatus): string {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "EXTRACTING":
      return "Extracting";
    case "DOMAIN":
      return "Domain";
    case "DECISIONS":
      return "Decisions";
    case "ARTIFACTS":
      return "Artifacts";
    case "AWAITING_REVIEW":
      return "Needs review";
    case "READY_DRY_RUN":
      return "Dry-run ready";
    case "WRITING":
      return "Writing";
    case "COMPLETED":
      return "Completed";
    case "COMPLETED_WITH_ERRORS":
      return "Completed with errors";
    case "SOURCE_URL_PENDING":
      return "Waiting for PDF";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    case "DRAFT":
      return "Draft";
    default:
      return status;
  }
}

export function workflowLabel(workflow: JobWorkflow): string {
  return workflow === "QA_RECONCILE" ? "Quality check" : "Create menu";
}

/** One row per restaurant_key — latest job wins for status. */
export function buildMerchantDashboard(
  jobs: MigrationJob[],
): MerchantDashboardRow[] {
  const byKey = new Map<string, MerchantDashboardRow>();

  // jobs are newest-first from listJobs
  for (const job of jobs) {
    const existing = byKey.get(job.restaurantKey);
    if (!existing) {
      byKey.set(job.restaurantKey, {
        restaurantKey: job.restaurantKey,
        merchantName: job.merchantName,
        destinationHost: job.destinationHost,
        latestJobId: job.id,
        latestStatus: job.status,
        latestWorkflow: job.workflow,
        jobCount: 1,
        createJobCount: job.workflow === "CREATE_MENU" ? 1 : 0,
        qaJobCount: job.workflow === "QA_RECONCILE" ? 1 : 0,
        remainingQuestions: job.remainingQuestions,
        updatedAt: job.updatedAt,
      });
      continue;
    }
    existing.jobCount += 1;
    if (job.workflow === "CREATE_MENU") existing.createJobCount += 1;
    if (job.workflow === "QA_RECONCILE") existing.qaJobCount += 1;
    // keep latest* from first seen (newest)
  }

  return [...byKey.values()].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}
