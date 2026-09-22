import type { ReactNode } from "react";

/** Status tone vocabulary shared with `statusTone()` in merchantDashboard. */
export type BadgeTone = "ok" | "warn" | "danger" | "neutral";

/**
 * Status pill — thin wrapper over the existing `.status-pill.tone-*` classes.
 */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

export type WorkflowBadgeKind = "CREATE_MENU" | "QA_RECONCILE";

/**
 * Workflow pill — thin wrapper over `.workflow-pill` / `.workflow-pill-qa`.
 */
export function WorkflowBadge({
  workflow,
  children,
}: {
  workflow: WorkflowBadgeKind;
  children: ReactNode;
}) {
  return (
    <span
      className={
        workflow === "QA_RECONCILE"
          ? "workflow-pill workflow-pill-qa"
          : "workflow-pill"
      }
    >
      {children}
    </span>
  );
}
