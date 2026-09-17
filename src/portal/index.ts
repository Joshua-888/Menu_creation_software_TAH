export type * from "./types.js";
export {
  hashPassword,
  verifyPassword,
  publicEmployee,
  sessionSecret,
  signSessionValue,
  parseSignedSession,
  SESSION_COOKIE,
  readBootstrapFromEnv,
} from "./auth.js";
export { PortalStore, getPortalStore, resetPortalStoreForTests, tryNormalizeHost } from "./store.js";
export { submitReviewAnswer } from "./review.js";
export { readJobArtifact, reconcileJobStatusFromArtifacts } from "./artifacts.js";
export {
  buildMerchantDashboard,
  statusLabel,
  statusTone,
  workflowLabel,
} from "./merchantDashboard.js";
export type { MerchantDashboardRow } from "./merchantDashboard.js";
export {
  openPortalDecisionStore,
  listOperatorFacingPolicies,
  createGlobalOperatorPolicy,
  OPERATOR_GUIDANCE_DECISION_TYPE,
} from "./operatorPolicies.js";
export type { OperatorPolicyView } from "./operatorPolicies.js";
export {
  buildPolicyCatalog,
  BUILT_IN_SEMANTIC_RULES,
  deprecateStorePolicy,
  activateStorePolicy,
  updateOperatorGuidancePolicy,
} from "./policyCatalog.js";
export type {
  BuiltInSemanticRule,
  ArtifactPolicyView,
  PolicyCatalog,
} from "./policyCatalog.js";
export {
  evaluatePortalLiveWriteGate,
  isPortalLiveWritesEnabled,
  isDestinationHostAllowlistedForLiveWrites,
  PORTAL_LIVE_WRITE_HOST_ALLOWLIST,
} from "./liveWrites.js";
export {
  isReconcileWriteConfirmed,
  assertReconcileWriteConfirmed,
  reconcileWriteConfirmPath,
} from "./reconcileWriteGate.js";
export {
  portalDataDir,
  portalDbPath,
  uploadsDir,
  runsDir,
  repoRoot,
} from "./paths.js";
export { resolveDeployCommitSha } from "./deployProvenance.js";

// Worker (PDF/OCR) is intentionally NOT re-exported here — import from
// `./worker.js` only in routes that schedule jobs, so Next does not pull
// native canvas/pdf bindings into every API route graph.
