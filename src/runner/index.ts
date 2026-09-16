export {
  canTransitionOp,
  compareProductExact,
  resolveCreateResume,
  executeMigrationPlan,
  matchDestinationByEvidence,
  resolveDestinationIdentity,
  type DestinationPort,
  type DestinationProduct,
  type DestinationMatchResult,
  type ExecutorGate,
  type ExecuteResult,
} from "./executor.js";
export {
  createTahPlaywrightDestinationPort,
  type TahDestinationPortOptions,
} from "./tahDestinationPort.js";
export {
  buildRecoveryPlan,
  type RecoveryAction,
  type RecoveryOperationState,
  type RecoveryPlan,
} from "./recoveryPlan.js";
export {
  freezeWritePlan,
  assertWritePlanImmutable,
  createMigrationWritePlan,
  planCreateProduct,
  planCreateCategory,
  planSkipProduct,
  planBlockProduct,
  planReviewProduct,
  planUpdateProduct,
  type WritePlanAction,
  type WritePlanEntityType,
  type ProductIdentityKey,
  type PlannedProductPayload,
  type WritePlanOperation,
  type MigrationWritePlan,
} from "./writePlan.js";
