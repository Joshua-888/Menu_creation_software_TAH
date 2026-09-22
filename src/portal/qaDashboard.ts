/**
 * Portal QA dashboard helpers — pure aggregation for the /jobs/qa dashboard.
 *
 * Presentation-only: derived from the existing job store rows plus the
 * already-written `menu-reconcile.json` summary. No business logic, no
 * mutation, no destination interaction.
 */

import type { JobStatus, MigrationJob } from "./types.js";
import { statusLabel, statusTone } from "./merchantDashboard.js";
import type { BadgeTone } from "./menuView.js";

/** Per-job reconcile summary read from `menu-reconcile.json` by the caller. */
export type QaFindingsSummary = {
  productCount?: number | null;
  withDiffs?: number | null;
  blocked?: number | null;
};

export type QaFindingsByJob = Record<string, QaFindingsSummary | null | undefined>;

export type QaJobRow = {
  jobId: string;
  merchantName: string;
  destinationHost: string;
  status: JobStatus;
  statusLabel: string;
  tone: BadgeTone;
  comparedProducts: number | null;
  withDiffs: number | null;
  blocked: number | null;
  diffSummary: string;
  remainingQuestions: number;
  updatedAt: string;
};

export type QaDashboardStats = {
  totalQaJobs: number;
  awaitingReview: number;
  comparedProducts: number;
  diffsFound: number;
};

export type QaDashboardModel = {
  stats: QaDashboardStats;
  rows: QaJobRow[];
};

/** A QA job needs operator attention when a review question is open. */
export function isQaAwaitingReview(
  job: Pick<MigrationJob, "status" | "remainingQuestions">,
): boolean {
  return job.remainingQuestions > 0 || job.status === "AWAITING_REVIEW";
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function diffSummaryLabel(
  compared: number | null,
  withDiffs: number | null,
): string {
  if (compared == null && withDiffs == null) return "No findings yet";
  if (compared == null) return `${withDiffs ?? 0} diffs`;
  if (withDiffs == null) return `${compared} compared`;
  return `${withDiffs} of ${compared} with diffs`;
}

/**
 * Build the QA dashboard model: newest-first QA_RECONCILE jobs with their
 * reconcile summary plus the aggregate counters shown in the StatGrid.
 */
export function buildQaDashboard({
  jobs,
  findings = {},
}: {
  jobs: MigrationJob[];
  findings?: QaFindingsByJob;
}): QaDashboardModel {
  const qaJobs = jobs.filter((job) => job.workflow === "QA_RECONCILE");

  let awaitingReview = 0;
  let comparedProducts = 0;
  let diffsFound = 0;

  const rows: QaJobRow[] = qaJobs.map((job) => {
    if (isQaAwaitingReview(job)) awaitingReview += 1;
    const summary = findings[job.id] ?? null;
    const compared = numberOrNull(summary?.productCount);
    const withDiffs = numberOrNull(summary?.withDiffs);
    const blocked = numberOrNull(summary?.blocked);
    if (compared != null) comparedProducts += compared;
    if (withDiffs != null) diffsFound += withDiffs;

    return {
      jobId: job.id,
      merchantName: job.merchantName,
      destinationHost: job.destinationHost,
      status: job.status,
      statusLabel: statusLabel(job.status),
      tone: statusTone(job.status),
      comparedProducts: compared,
      withDiffs,
      blocked,
      diffSummary: diffSummaryLabel(compared, withDiffs),
      remainingQuestions: job.remainingQuestions,
      updatedAt: job.updatedAt,
    };
  });

  return {
    stats: {
      totalQaJobs: qaJobs.length,
      awaitingReview,
      comparedProducts,
      diffsFound,
    },
    rows,
  };
}
