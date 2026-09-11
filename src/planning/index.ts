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
  type DryRunDestinationSnapshot,
} from "./dryRun.js";
