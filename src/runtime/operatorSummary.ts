import type { RecoveryPlan } from "../runner/recoveryPlan.js";
import type { ExecuteResult } from "../runner/executor.js";

export function operatorExecutionSummary(input: {
  result?: Pick<
    ExecuteResult,
    | "verified"
    | "failed"
    | "blocked"
    | "processed"
    | "circuitBreakerTripped"
    | "createErrorSignature"
    | "recoveryRequired"
    | "status"
  > | null;
  recovery?: RecoveryPlan | null;
  errorMessage?: string | null;
}): string {
  const lines: string[] = [];
  const result = input.result;
  if (result) {
    const notAttempted = result.blocked;
    lines.push(
      `Verified ${result.verified} of ${result.processed} operations. Failed ${result.failed}. Not attempted ${notAttempted}.`,
    );
    if (result.circuitBreakerTripped) {
      lines.push(
        `TAH product creation was classified as a deterministic failure (${result.createErrorSignature ?? "signature recorded"}). The circuit breaker blocked remaining CREATE attempts. No duplicate products were created.`,
      );
    }
    lines.push(
      result.recoveryRequired
        ? "Destination may have been mutated. Recovery will reuse verified objects and will not auto-delete."
        : "Destination mutation is complete for attempted operations.",
    );
    lines.push(
      result.status === "COMPLETED"
        ? "Retry is not required."
        : "Retry is safe only after reading destination state. Do not replay verified operations.",
    );
  }
  if (input.recovery) {
    const verified = input.recovery.operations.filter((o) => o.state === "VERIFIED").length;
    const failed = input.recovery.operations.filter((o) => o.state === "FAILED").length;
    const notStarted = input.recovery.operations.filter(
      (o) => o.state === "NOT_STARTED" || o.state === "SYSTEMIC_BLOCKED",
    ).length;
    lines.push(
      `Recovery view: ${verified} succeeded, ${failed} failed, ${notStarted} not attempted. Automatic delete is forbidden.`,
    );
  }
  if (input.errorMessage) {
    lines.push(`Why execution stopped: ${input.errorMessage}`);
  }
  if (lines.length === 0) return "No live execution has been attempted.";
  return lines.join(" ");
}
