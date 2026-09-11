/**
 * M6 Decision Policy + Continuous Learning — version constants.
 * Learning means: human-approved cases → immutable records → reusable policies.
 * It does NOT mean model training, self-modifying code, or silent invention.
 */

export const DECISION_ENGINE_VERSION = "1.0.0" as const;
export const DECISION_SCHEMA_VERSION = "1.0.0" as const;
export const POLICY_REGISTRY_VERSION = "1.0.0" as const;

/** Configurable auto-resolution thresholds (versioned, not magic numbers). */
export const DECISION_THRESHOLDS = {
  /** Min HUMAN-approved precedents for AUTO_RESOLVED_PRECEDENT */
  minPrecedentsForAuto: 3,
  /** Min distinct restaurants for GLOBAL precedent auto-resolve */
  minRestaurantsForGlobalPrecedent: 2,
  /** Required agreement ratio among relevant precedents */
  precedentAgreementRequired: 1.0,
  /** Restaurant-scoped policy auto-promote support count */
  restaurantPolicyMinSupport: 2,
  /** Global policy support (candidate → SHADOW only by default) */
  globalPolicyMinSupport: 5,
  /** Distinct restaurants required for GLOBAL SHADOW eligibility */
  globalPolicyMinRestaurants: 3,
  /** Global ACTIVE auto-promotion (OFF initially) */
  globalAutoPromoteEnabled: false,
  /** Min model confidence when other gates also pass (never alone) */
  minModelConfidenceWithGates: 0.85,
} as const;
