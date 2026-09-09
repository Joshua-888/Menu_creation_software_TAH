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
  isMilestone3WriteReady,
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
