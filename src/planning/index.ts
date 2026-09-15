export { isTahCanaryProduct, partitionDestinationProducts, TAH_CANARY_NAME_PREFIX } from "./canaries.js";
export {
  mapSourceCategoriesToDestination,
  mapProductToDestinationCategory,
  isSourceStructurePlaceholder,
  type CategoryMappingResult,
  type CategoryMapOutcome,
  type DestinationCategory,
  type ProductCategoryMappingResult,
} from "./categoryMapping.js";
export {
  buildDryRunWritePlan,
  summarizeDryRun,
  summarizeSourceDryRun,
  PORTAL_OPDATER_RECONCILE_FIELDS,
  type DryRunDestinationSnapshot,
} from "./dryRun.js";
export type { ProductPolicyTrace } from "./structureMapping.js";
export {
  mapProductChoicesToWriteFields,
  fanOutRestaurantAdditions,
  applyProbabilityFilterToMenu,
  veroniDefaultTilbehorAdditions,
} from "./structureMapping.js";
export {
  applyPizzaToppingRecovery,
  type PizzaToppingRecoveryResult,
} from "./applyPizzaToppingRecovery.js";
export {
  buildMenuReconcileReport,
  formatMenuReconcileMarkdown,
  diffProductReconcile,
  recoverProductLabelsForReconcile,
  looksLikeCategoryHeaderName,
  recoverDishNameFromDescription,
  type MenuReconcileReport,
  type ProductReconcileDiff,
  type LiveProductSnapshot,
} from "./menuReconcile.js";
