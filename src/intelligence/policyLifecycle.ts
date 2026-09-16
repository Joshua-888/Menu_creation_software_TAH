/**
 * Policy lifecycle — ACTIVE / SUPERSEDED / DEPRECATED.
 * MENU_AS_VARIANT must not coexist as an active rule with MENU_IS_COMBO_NOT_VARIANT.
 */

import {
  MENU_AS_VARIANT_SUPERSESSION,
  MENU_CONSTITUTION_VERSION,
  isConstitutionCompatiblePolicy,
} from "./constitution.js";
import type { PolicyLifecycleRecord } from "./types.js";

const REGISTRY: PolicyLifecycleRecord[] = [
  MENU_AS_VARIANT_SUPERSESSION,
  {
    policyId: "MENU_IS_COMBO_NOT_VARIANT",
    status: "ACTIVE",
    reason: "MenuConstitutionV1 hard rule — Menu is combo/menu product, never variant.",
    date: "2026-09-16",
    version: MENU_CONSTITUTION_VERSION,
  },
  {
    policyId: "DRINKS_NO_FOOD_EXTRAS",
    status: "ACTIVE",
    reason: "Global hard rule — independent of peer probability artifact load.",
    date: "2026-09-16",
    version: MENU_CONSTITUTION_VERSION,
  },
];

export function listPolicyLifecycle(): PolicyLifecycleRecord[] {
  return [...REGISTRY];
}

export function getPolicyLifecycle(
  policyId: string,
): PolicyLifecycleRecord | undefined {
  return REGISTRY.find((p) => p.policyId === policyId);
}

export function isActiveConstitutionPolicy(policyId: string): boolean {
  if (!isConstitutionCompatiblePolicy(policyId)) return false;
  const rec = getPolicyLifecycle(policyId);
  if (!rec) return true; // unknown policies deferred to store status
  return rec.status === "ACTIVE";
}

/** Resolution string for deterministic engine — never MENU_AS_VARIANT. */
export const MENU_COMBO_RESOLUTION = "MENU_IS_COMBO_NOT_VARIANT" as const;
export const MENU_COMBO_UNRESOLVED = "COMBO_SEMANTICS_UNRESOLVED" as const;
