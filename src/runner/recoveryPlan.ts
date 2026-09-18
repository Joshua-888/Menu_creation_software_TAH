import type { OperationRecord } from "../runs/sqliteStore.js";
import type {
  MigrationWritePlan,
  WritePlanOperation,
} from "./writePlan.js";

export type RecoveryOperationState =
  | "NOT_STARTED"
  | "PERSISTED"
  | "VERIFIED"
  | "FAILED"
  | "UNKNOWN"
  | "SYSTEMIC_BLOCKED";

export type RecoveryAction = "continue" | "repair" | "compensate";

export type RecoveryPlan = {
  schemaVersion: "1";
  recoveryVersion: "RecoveryPlanV2";
  runId: string;
  generatedAt: string;
  executeAutomatically: false;
  neverAutoDelete: true;
  customerFacingCategoryWarning: string;
  destinationSnapshot: {
    categoryCount: number;
    productCount: number;
  };
  operations: Array<{
    operationId: string;
    entityType: WritePlanOperation["entityType"];
    action: WritePlanOperation["action"];
    state: RecoveryOperationState;
    destinationId: string | null;
    errorCategory: string | null;
    errorMessage: string | null;
    proposedAction: RecoveryAction;
    blockerId: string | null;
    failureClassification: string | null;
    safeToRetry: boolean;
    requiresReplan: boolean;
    requiresApproval: boolean;
    reason: string;
  }>;
};

function recoveryState(record: OperationRecord | undefined): RecoveryOperationState {
  if (!record || record.state === "PENDING_WRITE") return "NOT_STARTED";
  if (record.state === "VERIFIED") return "VERIFIED";
  if (record.state === "WRITTEN" || record.state === "READ_BACK") {
    return "PERSISTED";
  }
  if (
    record.lastErrorMessage?.includes("NOT_ATTEMPTED_SYSTEMIC_BLOCK") ||
    record.lastErrorMessage?.includes("CIRCUIT_BREAKER_DETERMINISTIC_CREATE_REJECTION")
  ) {
    return "SYSTEMIC_BLOCKED";
  }
  if (
    record.state === "BLOCKED" ||
    record.state === "WRITE_FAILED" ||
    record.state === "VERIFY_FAILED"
  ) {
    return "FAILED";
  }
  return "UNKNOWN";
}

export function buildRecoveryPlan(input: {
  plan: MigrationWritePlan;
  operationRecords: readonly OperationRecord[];
  destinationSnapshot: {
    categories?: readonly unknown[];
    products?: readonly unknown[];
  };
}): RecoveryPlan {
  const records = new Map(
    input.operationRecords.map((record) => [record.operationId, record]),
  );
  return {
    schemaVersion: "1",
    runId: input.plan.runId,
    generatedAt: new Date().toISOString(),
    executeAutomatically: false,
    neverAutoDelete: true,
    recoveryVersion: "RecoveryPlanV2",
    customerFacingCategoryWarning:
      "CATEGORY_CREATE_IS_PUBLIC_MUTATION=true: TAH has no hidden/draft categories. Prefer dependency-minimizing execution (create category only immediately before its hidden products). Empty newly-created incident categories may be proposed for compensation delete — never auto-delete.",
    destinationSnapshot: {
      categoryCount: input.destinationSnapshot.categories?.length ?? 0,
      productCount: input.destinationSnapshot.products?.length ?? 0,
    },
    operations: input.plan.operations.map((operation) => {
      const record = records.get(operation.operationId);
      const state = recoveryState(record);
      const proposedAction: RecoveryAction =
        (state === "PERSISTED" || state === "VERIFIED")
          ? "continue"
          : state === "NOT_STARTED" || state === "SYSTEMIC_BLOCKED"
            ? "continue"
            : "repair";
      const reason =
        state === "VERIFIED" || state === "PERSISTED"
          ? "Reuse verified/persisted destination object. Never recreate. Never auto-delete."
          : state === "SYSTEMIC_BLOCKED"
            ? "Not attempted after systemic CREATE failure. Requires human review; do not blindly replay."
            : state === "FAILED"
              ? "Failed mutation. Read destination first. Safe retry only if object is absent."
              : state === "UNKNOWN"
                ? "Ambiguous mutation state. READ DESTINATION FIRST before any retry."
                : "Not started. Resume only from the approved ExecutionBundle after a fresh snapshot if destination changed.";
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        action: operation.action,
        state,
        destinationId: record?.destinationId ?? null,
        errorCategory: record?.lastErrorCategory ?? null,
        errorMessage: record?.lastErrorMessage ?? null,
        proposedAction,
        blockerId: record?.lastErrorCategory ?? null,
        failureClassification: record?.lastErrorCategory ?? null,
        safeToRetry:
          state === "NOT_STARTED" ||
          (state === "FAILED" && operation.entityType === "product"),
        requiresReplan: state === "UNKNOWN",
        requiresApproval: state !== "VERIFIED",
        reason,
      };
    }),
  };
}
