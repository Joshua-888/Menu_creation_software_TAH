import { Badge } from "../ui";
import type { JobStatus } from "@engine/portal/types.js";
import {
  classifyExecutionFailures,
  type LiveExecuteResultView,
} from "./executionView.js";

/**
 * Distinct, evidence-classified failure badges so an operator can tell
 * NO_MUTATION from PARTIAL_MUTATION from a verification mismatch. Rendering
 * only — the classification lives in executionView.ts (node-testable).
 */
export function FailureStateBadge({
  status,
  result,
  errorMessage,
  missingCapabilities,
}: {
  status: JobStatus;
  result: LiveExecuteResultView | null;
  errorMessage?: string | null;
  missingCapabilities?: readonly string[];
}) {
  const badges = classifyExecutionFailures({
    status,
    result,
    errorMessage: errorMessage ?? null,
    missingCapabilities,
  });
  if (badges.length === 0) return null;
  return (
    <div className="actions" style={{ marginBottom: 0, flexWrap: "wrap", gap: "0.4rem" }}>
      {badges.map((badge) => (
        <Badge key={badge.kind} tone={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}
