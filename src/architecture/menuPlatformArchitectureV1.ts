/**
 * MENU_PLATFORM_ARCHITECTURE_V1 — version marker (behavior-preserving).
 * Exposed for deploy provenance /api/version consumers.
 */

import { MENU_CONSTITUTION_VERSION } from "../intelligence/constitution.js";
import { ACTIVE_CONSTITUTION_POLICIES } from "../intelligence/constitution.js";
import { CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID } from "../intelligence/categoryQualifiedProductName.js";

export const MENU_PLATFORM_ARCHITECTURE_VERSION =
  "MENU_PLATFORM_ARCHITECTURE_V1" as const;

/** Capability matrix version bound to tah/contracts evidence + M2B/M3/M6.7/M80 certs. */
export const CAPABILITY_MATRIX_VERSION = "TahCapabilityMatrixV1" as const;

/** Core pipeline identity (extraction → intelligence → quality → plan → execute → verify → publish). */
export const CORE_PIPELINE_VERSION = "MenuCorePipelineV1" as const;

export const MENU_PLATFORM_ARCHITECTURE_V1 = {
  architectureVersion: MENU_PLATFORM_ARCHITECTURE_VERSION,
  constitutionVersion: MENU_CONSTITUTION_VERSION,
  corePipelineVersion: CORE_PIPELINE_VERSION,
  capabilityMatrixVersion: CAPABILITY_MATRIX_VERSION,
  activeGlobalPolicies: [
    ...ACTIVE_CONSTITUTION_POLICIES,
  ] as readonly string[],
  primaryReceiptNamingPolicy: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  frozenAt: "2026-09-16",
  bellaEvidence: {
    menuState: "VERIFIED_LIVE",
    products: 12,
    targetMenuEquality: "PASS",
    publication: "PASS",
  },
} as const;

export type MenuPlatformArchitectureV1 = typeof MENU_PLATFORM_ARCHITECTURE_V1;
