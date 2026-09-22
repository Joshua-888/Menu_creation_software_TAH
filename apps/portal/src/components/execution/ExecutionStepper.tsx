import { Badge } from "../ui";
import type { JobStatus } from "@engine/portal/types.js";
import {
  deriveExecutionStages,
  type ExecutionStageState,
  type LiveExecuteResultView,
} from "./executionView.js";

const TONE: Record<ExecutionStageState, "ok" | "warn" | "danger" | "neutral"> = {
  done: "ok",
  current: "warn",
  failed: "danger",
  pending: "neutral",
};

const STATE_LABEL: Record<ExecutionStageState, string> = {
  done: "done",
  current: "in progress",
  failed: "failed",
  pending: "pending",
};

/**
 * Five-step PREPARING→APPROVED→EXECUTING→VERIFYING→VERIFIED indicator. Purely
 * presentational: stage state is derived from the persisted job status and
 * live-execute-result.json, never from a client-side guess.
 */
export function ExecutionStepper({
  status,
  result,
}: {
  status: JobStatus;
  result: LiveExecuteResultView | null;
}) {
  const stages = deriveExecutionStages(status, result);
  return (
    <div className="metrics" aria-label="Execution progress">
      {stages.map((stage) => (
        <div className="metric" key={stage.id}>
          <Badge tone={TONE[stage.state]}>{STATE_LABEL[stage.state]}</Badge>
          <span className="muted">{stage.label}</span>
        </div>
      ))}
    </div>
  );
}
