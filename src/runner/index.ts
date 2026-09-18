export {
  canTransitionOp,
  compareProductExact,
  compareProductFieldAware,
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
  verifyProductFields,
  compareIngredientDescription,
  parseIngredientDescriptionTokens,
  type FieldComparisonResultKind,
  type FieldComparisonMode,
  type FieldVerificationReport,
  type ProductVerificationReport,
} from "./fieldAwareVerify.js";
export {
  CATEGORY_CREATE_IS_PUBLIC_MUTATION,
  CATEGORY_VISIBILITY_CONTROL_EXISTS,
  auditCategoryExposureCapabilities,
  buildMinimizedCategoryExposureSteps,
  proposeEmptyCategoryCompensation,
  emptyMenuCreationMetrics,
  type CategoryExposureCapabilityAudit,
  type MinimizedExposurePlanStep,
  type MenuCreationMetrics,
} from "./categoryExposure.js";
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
  emptyCreateCircuitBreaker,
  recordCreateCircuitFailure,
  shouldBlockRemainingCreates,
  CIRCUIT_BREAKER_REASON,
  NOT_ATTEMPTED_SYSTEMIC_BLOCK,
  type CreateCircuitBreakerState,
} from "./createCircuitBreaker.js";
export { orderOperationsForMinimizedCategoryExposure } from "./categorySequence.js";
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
