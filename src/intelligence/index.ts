/**
 * Public exports for the Menu Intelligence spine.
 */

export {
  applyCategoryQualifiedProductName,
  isProductNameReceiptSafe,
  resolveReceiptNamingFamily,
  CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  RECEIPT_NAMING_FAMILIES,
} from "./categoryQualifiedProductName.js";
export {
  MENU_CONSTITUTION,
  MENU_CONSTITUTION_VERSION,
  MENU_AS_VARIANT_SUPERSESSION,
} from "./constitution.js";
export {
  classifyPhrase,
  classifyPhrases,
  isInvalidProductNameEntity,
  isInvalidIngredientEntity,
  isInvalidAdditionEntity,
} from "./semanticClassifier.js";
export {
  inferProductFamily,
  bandPeerEvidence,
  filterPeerIngredientsByBand,
  effectivePeerWeight,
  DEFAULT_PEER_THRESHOLDS,
  isFoodFamily,
} from "./peerCohorts.js";
export {
  completeProductCard,
  completeCanonicalMenuCards,
} from "./completeProductCard.js";
export {
  evaluateMenuQualityContract,
  filterWriteEligibleProductIds,
  qualityContractBlocksWrite,
} from "./qualityContract.js";
export { runMenuIntelligence } from "./menuIntelligenceEngine.js";
export {
  buildCompletenessBenchmark,
  type CompletenessBenchmark,
  type CompletenessBenchmarkInput,
  type RequiredFieldCounts,
  type ExpectedFieldCounts,
} from "./completenessBenchmark.js";
export {
  diagnoseSourceProductCoverage,
  type SourceCoverageDiagnostic,
} from "./sourceCoverage.js";
export { applyApprovedFactsToMenu } from "./applyApprovedFacts.js";
export {
  listPolicyLifecycle,
  getPolicyLifecycle,
  isActiveConstitutionPolicy,
  MENU_COMBO_RESOLUTION,
  MENU_COMBO_UNRESOLVED,
} from "./policyLifecycle.js";
export type * from "./types.js";
