/**
 * Public exports for the Menu Intelligence spine.
 */

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
export { applyApprovedFactsToMenu } from "./applyApprovedFacts.js";
export {
  listPolicyLifecycle,
  getPolicyLifecycle,
  isActiveConstitutionPolicy,
  MENU_COMBO_RESOLUTION,
  MENU_COMBO_UNRESOLVED,
} from "./policyLifecycle.js";
export type * from "./types.js";
