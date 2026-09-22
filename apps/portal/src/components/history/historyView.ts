import type {
  JobRun,
  MigrationJob,
  ReviewAnswer,
} from "../../../../../src/portal/types.js";

/**
 * Pure assembly of the job history timeline. The store queries return raw rows;
 * this module merges them into one chronological list (newest first) with
 * plain-language descriptions. Reads evidence only — never mutates state and
 * never reclassifies an execution outcome.
 */

export type HistoryKind =
  | "CREATED"
  | "RUN"
  | "REVIEW_ANSWER"
  | "APPROVAL"
  | "EXECUTION";

export type HistoryEntry = {
  at: string;
  kind: HistoryKind;
  title: string;
  detail: string;
};

export type HistoryInput = {
  job: Pick<MigrationJob, "createdAt" | "workflow" | "status">;
  runs: readonly JobRun[];
  reviewAnswers: readonly ReviewAnswer[];
  /** employeeId → display name, for resolving review-answer authors. */
  employeeNames?: Record<string, string>;
};

/** Live write attempt statuses recorded by the worker. */
const EXECUTION_STATUSES = new Set([
  "LIVE_EXECUTING",
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "PARTIAL_WRITE",
  "RECOVERY_REQUIRED",
  "LIVE_EXECUTION_FAILED",
]);

export function buildJobHistory(input: HistoryInput): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const names = input.employeeNames ?? {};

  entries.push({
    at: input.job.createdAt,
    kind: "CREATED",
    title: "Job created",
    detail:
      input.job.workflow === "QA_RECONCILE"
        ? "Quality-check job created."
        : "Create-menu job created.",
  });

  for (const run of input.runs) {
    entries.push({
      at: run.startedAt,
      kind: "RUN",
      title: `Run started (${run.status})`,
      detail: run.runDir,
    });
    const finishedAt = run.finishedAt ?? null;
    if (finishedAt) {
      entries.push({
        at: finishedAt,
        kind: "RUN",
        title: `Run finished (${run.status})`,
        detail: run.errorMessage ?? "No error recorded.",
      });
    }
    // A live-write run only exists after an explicit approval was accepted.
    if (EXECUTION_STATUSES.has(run.status)) {
      const at = finishedAt ?? run.startedAt;
      entries.push({
        at,
        kind: "APPROVAL",
        title: "Operator approval recorded",
        detail: `Approved bundle executed in run ${run.id}.`,
      });
      entries.push({
        at,
        kind: "EXECUTION",
        title: `Execution attempt (${run.status})`,
        detail: run.errorMessage ?? "Live write attempt recorded.",
      });
    }
  }

  for (const answer of input.reviewAnswers) {
    entries.push({
      at: answer.createdAt,
      kind: "REVIEW_ANSWER",
      title: `Review answer: ${answer.resolution}`,
      detail: `${names[answer.employeeId] ?? answer.employeeId} answered question ${answer.questionId} (${answer.scopePreference})${
        answer.comment ? ` — ${answer.comment}` : ""
      }`,
    });
  }

  return entries.sort((a, b) => {
    const left = Date.parse(a.at);
    const right = Date.parse(b.at);
    if (Number.isNaN(left) || Number.isNaN(right)) return 0;
    return right - left;
  });
}
