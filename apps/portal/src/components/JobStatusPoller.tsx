"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const IN_FLIGHT = new Set([
  "QUEUED",
  "EXTRACTING",
  "DOMAIN",
  "DECISIONS",
  "ARTIFACTS",
  "WRITING",
]);

const STAGE_ORDER = [
  "QUEUED",
  "EXTRACTING",
  "DOMAIN",
  "DECISIONS",
  "ARTIFACTS",
  "AWAITING_REVIEW",
  "READY_DRY_RUN",
  "WRITING",
  "COMPLETED",
] as const;

const STAGE_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  EXTRACTING: "Extracting PDF",
  DOMAIN: "Domain rules",
  DECISIONS: "Decisions",
  ARTIFACTS: "Building plan",
  AWAITING_REVIEW: "Needs review",
  READY_DRY_RUN: "Plan ready",
  WRITING: "Writing to admin",
  COMPLETED: "Completed",
  COMPLETED_WITH_ERRORS: "Completed with errors",
  FAILED: "Failed",
  SOURCE_URL_PENDING: "Waiting for PDF",
  CANCELLED: "Cancelled",
  DRAFT: "Draft",
};

/** Poll job detail while the worker is still running + show visible progress. */
export function JobStatusPoller({
  status,
  errorMessage,
}: {
  status: string;
  errorMessage?: string | null;
}) {
  const router = useRouter();
  const working = IN_FLIGHT.has(status);

  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [working, router]);

  const currentIdx = STAGE_ORDER.indexOf(
    status as (typeof STAGE_ORDER)[number],
  );

  return (
    <div
      className={`job-progress ${working ? "is-working" : ""} ${
        status === "FAILED" ? "is-failed" : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="job-progress-head">
        <strong>
          {working ? "Working — " : ""}
          {STAGE_LABEL[status] ?? status}
        </strong>
        {working ? <span className="job-progress-spinner" aria-hidden /> : null}
      </div>
      {errorMessage ? (
        <p className="job-progress-error">{errorMessage}</p>
      ) : working ? (
        <p className="muted" style={{ margin: "0.35rem 0 0" }}>
          This page refreshes automatically while the job runs. Live admin
          changes happen after the plan is ready (and any review questions are
          answered).
        </p>
      ) : null}
      <ol className="job-progress-steps">
        {STAGE_ORDER.filter((s) => s !== "AWAITING_REVIEW" || status === "AWAITING_REVIEW").map(
          (stage) => {
            const idx = STAGE_ORDER.indexOf(stage);
            const done =
              currentIdx > idx ||
              status === "COMPLETED" ||
              status === "COMPLETED_WITH_ERRORS";
            const active = status === stage || (working && currentIdx === idx);
            return (
              <li
                key={stage}
                className={`${done ? "done" : ""} ${active ? "active" : ""}`}
              >
                {STAGE_LABEL[stage]}
              </li>
            );
          },
        )}
      </ol>
    </div>
  );
}
