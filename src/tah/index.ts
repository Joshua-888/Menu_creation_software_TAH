export type {
  AdminAdapterLifecycle,
  AdminContract,
  ContractProbeResult,
  TahAdminAdapter,
  WritePlan,
  WritePlanAction,
} from "./types.js";

export {
  ADMIN_CONTRACT_V1,
  ADMIN_CONTRACT_VERSION,
  DetailedProbeResultSchema,
  type AdminContractV1,
  type DetailedProbeResult,
  type ProbeCheckStatus,
  type ContractStatus,
  type SelectorSpec,
  type Evidenced,
} from "./contracts/v1.js";

export {
  M2B_ADAPTER_CAPABILITIES,
  DEFAULT_ADAPTER_CAPABILITIES,
  assertNoWriteCapabilitiesCertified,
  assertVisibilityWriteCapabilitiesUncertified,
  assertUpdateProductSeparatelyUncertified,
  mayCertifyVisibilityWrite,
  visibilityWriteVerifiedFromFormOnly,
  isMilestone3WriteReady,
  isMilestone3CanaryExecutable,
  type AdapterCapabilities,
  type CapabilityStatus,
  type ContractEvidenceLevel,
  type VariantPriceSemantics,
  type BasePriceSemantics,
} from "./contracts/evidence.js";

export {
  parseAdminPriceToOre,
  normalizeWhitespace,
  checkboxToBoolean,
} from "./normalize/destination.js";

export {
  probeAdminContract,
  evaluateProbeFromFlags,
  parseDatabaseIdFromPath,
  isMenuNumberSameAsDatabaseId,
  finalVariantPriceOre,
  type ProbeOptions,
} from "./probe/contractProbe.js";

export {
  TahAdminAdapterV1,
  type V1AdapterOptions,
  type DestinationCategory,
  type DestinationProduct,
  type DestinationProductListItem,
  type DestinationVariant,
  type DestinationIngredient,
  type DestinationAddition,
} from "./adapters/v1/adapter.js";

export {
  V1_SELECTORS,
  V1_ROUTES,
  menuEditPath,
} from "./adapters/v1/selectors.js";

export {
  listAdapters,
  getCertifiedAdapter,
  resolveAdapterForProbe,
  assertCertifiedForProductionWrites,
} from "./adapters/registry.js";

export {
  VERONI_CANARY_TARGET,
  CANARY_NAMES,
  type CanaryWritePlan,
  type WritePlanOperation,
  type WriteOpState,
  type ActiveDefaultGateResult,
  type BaselineResult,
  type TargetLockResult,
} from "./write/types.js";

export {
  assertAllowlistedAdminHost,
  assertVeroniTargetLock,
  blockWriteUnlessTargetLocked,
} from "./write/targetLock.js";
export {
  DEFAULT_LIVE_WRITE_HOSTS,
  isHostAllowlistedForLiveWrites,
  normalizeDestinationHost,
  parseLiveWriteHostAllowlist,
} from "./write/hostAllowlist.js";
export {
  evaluateActiveDefaultGate,
  evaluateEmptyProductBaseline,
} from "./write/safetyGates.js";
export {
  createCanaryWritePlan,
  createInactiveProductWritePlan,
  assertWritePlanImmutable,
  assertWritePlanExactlyOneCreateProduct,
  selectExistingCategoryDeterministic,
} from "./write/writePlan.js";
export {
  runCanaryDryRun,
  runInactiveProductDryRun,
  executeCanaryWritePlan,
} from "./write/canaryRunner.js";
export {
  canTransition,
  transitionWriteState,
  assertVerificationPath,
  assertEditPathRequiresOpdater,
  persistBoundaryForAction,
  buttonClickAloneMeansWritten,
  isFormSubmitBypassProhibited,
  classifyOpdaterEventPath,
  clickWithoutSubmitAdvancesToWritten,
} from "./write/stateMachine.js";
export {
  parseFormBody,
  sanitizeCreatePayload,
  assertInactiveCreatePayloadSafe,
  type SanitizedCreatePayload,
} from "./write/payloadInspect.js";
export {
  inspectFormSubmission,
  assertPayloadHasNoActiveTrue,
  type InspectedFormPayload,
  type InspectedFormField,
} from "./write/formInspect.js";
export {
  validateAdminFormBeforeSubmit,
  validateInstantiatedRowsComplete,
  validateDynamicSection,
  validateDynamicSectionAgainstWritePlan,
  validateDynamicRowsComplete,
  unintendedBlankRows,
  missingFieldsForRow,
  instantiatedRows,
  countsFromWritePlan,
  type AdminFormCompletenessSnapshot,
  type AdminFormRowSnapshot,
  type WritePlanDynamicCollections,
  type DynamicRowCounts,
  type FormCompletenessResult,
  type FormCompletenessIssue,
} from "./write/formCompleteness.js";
export {
  fillInactiveProductCreateForm,
  assertActiveUnchecked,
  assertPageIsAllowlistedAdmin,
  assertPageIsVeroniAdmin,
} from "./write/formFill.js";
export {
  dismissKnownCookieBanner,
  assertSubmitControlInteractable,
  type SubmitInteractabilityResult,
} from "./write/submitInteractability.js";
export {
  isProductCreateRequest,
  clickSkabAndObserveCreate,
  type SanitizedCreateRequestTrace,
  type SanitizedCreateResponseTrace,
} from "./write/createRequestObserve.js";
export {
  buildAdminContractFingerprint,
  normalizeFingerprintParts,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
  type FingerprintInput,
} from "./contracts/fingerprint.js";
export {
  interpretActiveState,
  mapListStatusText,
  resolveActiveReadSemantics,
  intendedAvailabilityFromActiveCheckbox,
  formModifiedCountsAsWritten,
  NEW_WAY_ACTIVE_READ_SEMANTICS,
  VERONI_ACTIVE_READ_SEMANTICS,
  ACTIVE_CHECKBOX_PERSIST_REQUIRES_OPDATER,
  ACTIVE_INTENDED_MAPPING,
  EDIT_PERSIST_REQUIRES_OPDATER,
  DYNAMIC_ROW_COMPLETENESS_REQUIRED,
  VISIBILITY_WRITE_CERTIFICATION_CHECKLIST,
  isVisibilityWriteRoundTripComplete,
  type ActiveReadSemantics,
  type ActiveObservationLayer,
  type ScopedSemanticEvidence,
} from "./contracts/activeSemantics.js";
export {
  createDescriptionUpdatePlan,
  assertPlanAllowsOnly,
  semanticDiff,
  assertExactlyAllowedSemanticDiff,
  mayRetryOpdaterAfterAmbiguousResult,
  type ScalarProductUpdatePlan,
  type SemanticProductSnapshot,
  type AllowedProductChangeField,
} from "./write/updatePlan.js";
export {
  isProductUpdateRequest,
  sanitizeUpdateRequest,
  clickOpdaterAndObserveUpdate,
  classifyUpdateOutcome,
  type SanitizedUpdateRequestTrace,
  type SanitizedUpdateResponseTrace,
} from "./write/updateRequestObserve.js";
