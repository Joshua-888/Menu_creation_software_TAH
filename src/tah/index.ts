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
} from "./contracts/v1.js";

export {
  probeAdminContract,
  evaluateProbeFromFlags,
  parseDatabaseIdFromPath,
  isMenuNumberSameAsDatabaseId,
  type ProbeOptions,
} from "./probe/contractProbe.js";

export {
  TahAdminAdapterV1,
  type V1AdapterOptions,
  type DestinationCategory,
  type DestinationProduct,
  type DestinationProductListItem,
} from "./adapters/v1/adapter.js";

export { V1_SELECTORS, V1_ROUTES } from "./adapters/v1/selectors.js";

export {
  listAdapters,
  getCertifiedAdapter,
  resolveAdapterForProbe,
  assertCertifiedForProductionWrites,
} from "./adapters/registry.js";
