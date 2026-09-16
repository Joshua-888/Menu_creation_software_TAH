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
  | "UNKNOWN";

export type RecoveryAction = "continue" | "repair" | "compensate";

export type RecoveryPlan = {
  schemaVersion: "1";
  runId: string;
  generatedAt: string;
  executeAutomatically: false;
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
  }>;
};

function recoveryState(record: OperationRecord | undefined): RecoveryOperationState {
  if (!record || record.state === "PENDING_WRITE") return "NOT_STARTED";
  if (record.state === "VERIFIED") return "VERIFIED";
  if (record.state === "WRITTEN" || record.state === "READ_BACK") {
    return "PERSISTED";
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
        operation.entityType === "category" &&
        (state === "PERSISTED" || state === "VERIFIED")
          ? "compensate"
          : state === "NOT_STARTED"
            ? "continue"
            : state === "VERIFIED"
              ? "continue"
              : "repair";
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        action: operation.action,
        state,
        destinationId: record?.destinationId ?? null,
        errorCategory: record?.lastErrorCategory ?? null,
        errorMessage: record?.lastErrorMessage ?? null,
        proposedAction,
      };
    }),
  };
}
