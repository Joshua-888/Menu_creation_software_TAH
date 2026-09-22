import type { WritePlanOperation } from "../runner/writePlan.js";
import { sha256Canonical } from "./sha.js";
import { normalizeDestinationHost } from "../tah/write/hostAllowlist.js";
import type { DestinationSnapshotResult } from "./destinationSnapshot.js";

export const EXECUTION_BUNDLE_VERSION = "ExecutionBundleV1" as const;

/** Provenance of the destination snapshot the bundle was planned against. */
export type DestinationSnapshotProvenance = DestinationSnapshotResult["status"];

export type ExecutionBundleV1 = {
  bundleVersion: typeof EXECUTION_BUNDLE_VERSION;
  restaurantKey: string;
  destinationHost: string;
  destinationIdentity: string;
  productionSha: string;
  adapterVersion: string;
  contractFingerprint: string;
  targetMenuHash: string;
  destinationSnapshotHash: string;
  /**
   * Status of the destination snapshot used to plan this bundle. Execution may
   * only trust a bundle whose provenance is LIVE_COMPLETE: an OFFLINE_EXPLICIT
   * plan can hash-match a genuinely empty live destination, so the hash alone
   * must never authorize a live write.
   */
  destinationSnapshotStatus: DestinationSnapshotProvenance;
  writePlanHash: string;
  createdAt: string;
  operations: readonly WritePlanOperation[];
  operationCount: number;
  capabilityRequirements: string[];
  qualityStatus: string;
  immutable: true;
};

export type ExecutionBundleApprovalBinding = {
  destinationHost: string;
  destinationIdentity: string;
  productionSha: string;
  targetMenuHash: string;
  destinationSnapshotHash: string;
  destinationSnapshotStatus: DestinationSnapshotProvenance;
  writePlanHash: string;
};

export function hashWritePlanOperations(
  operations: readonly WritePlanOperation[],
): string {
  return sha256Canonical(operations);
}

export function freezeExecutionBundle(input: {
  restaurantKey: string;
  destinationHost: string;
  destinationIdentity?: string;
  productionSha: string;
  adapterVersion: string;
  contractFingerprint: string;
  targetMenuHash: string;
  destinationSnapshotHash: string;
  destinationSnapshotStatus: DestinationSnapshotProvenance;
  operations: readonly WritePlanOperation[];
  qualityStatus: string;
  createdAt?: string;
}): ExecutionBundleV1 {
  const operations = input.operations.map((op) => ({ ...op }));
  const writePlanHash = hashWritePlanOperations(operations);
  const destinationHost = normalizeDestinationHost(input.destinationHost);
  const capabilityRequirements = [
    ...new Set(operations.flatMap((op) => op.requiredCapabilities ?? [])),
  ];
  const bundle: ExecutionBundleV1 = {
    bundleVersion: EXECUTION_BUNDLE_VERSION,
    restaurantKey: input.restaurantKey,
    destinationHost,
    destinationIdentity: input.destinationIdentity ?? destinationHost,
    productionSha: input.productionSha,
    adapterVersion: input.adapterVersion,
    contractFingerprint: input.contractFingerprint,
    targetMenuHash: input.targetMenuHash,
    destinationSnapshotHash: input.destinationSnapshotHash,
    destinationSnapshotStatus: input.destinationSnapshotStatus,
    writePlanHash,
    createdAt: input.createdAt ?? new Date().toISOString(),
    operations,
    operationCount: operations.length,
    capabilityRequirements,
    qualityStatus: input.qualityStatus,
    immutable: true,
  };
  Object.freeze(bundle);
  Object.freeze(bundle.operations);
  return bundle;
}

export function executionBundleHash(bundle: ExecutionBundleV1): string {
  return sha256Canonical(bundle);
}

export function approvalBindingFromBundle(
  bundle: ExecutionBundleV1,
): ExecutionBundleApprovalBinding {
  return {
    destinationHost: bundle.destinationHost,
    destinationIdentity: bundle.destinationIdentity,
    productionSha: bundle.productionSha,
    targetMenuHash: bundle.targetMenuHash,
    destinationSnapshotHash: bundle.destinationSnapshotHash,
    destinationSnapshotStatus: bundle.destinationSnapshotStatus,
    writePlanHash: bundle.writePlanHash,
  };
}

export type BundleValidation =
  | { ok: true }
  | { ok: false; code: "STALE_EXECUTION_BUNDLE" | "APPROVAL_INVALIDATED"; reason: string };

export function validateExecutionBundle(input: {
  bundle: ExecutionBundleV1;
  productionSha: string;
  destinationHost: string;
  destinationSnapshotHash: string;
  targetMenuHash?: string;
}): BundleValidation {
  const { bundle } = input;
  if (bundle.bundleVersion !== EXECUTION_BUNDLE_VERSION) {
    return {
      ok: false,
      code: "APPROVAL_INVALIDATED",
      reason: `bundleVersion ${bundle.bundleVersion}`,
    };
  }
  if (bundle.destinationSnapshotStatus !== "LIVE_COMPLETE") {
    return {
      ok: false,
      code: "STALE_EXECUTION_BUNDLE",
      reason: `bundle was planned against destinationSnapshotStatus=${bundle.destinationSnapshotStatus}; only LIVE_COMPLETE provenance is live-executable (regenerate/reapprove against a live snapshot)`,
    };
  }
  if (hashWritePlanOperations(bundle.operations) !== bundle.writePlanHash) {
    return {
      ok: false,
      code: "APPROVAL_INVALIDATED",
      reason: "writePlanHash does not match frozen operations",
    };
  }
  if (bundle.productionSha !== input.productionSha) {
    return {
      ok: false,
      code: "APPROVAL_INVALIDATED",
      reason: `productionSha expected=${bundle.productionSha} actual=${input.productionSha}`,
    };
  }
  if (bundle.destinationHost !== normalizeDestinationHost(input.destinationHost)) {
    return {
      ok: false,
      code: "STALE_EXECUTION_BUNDLE",
      reason: `destinationHost expected=${bundle.destinationHost} actual=${input.destinationHost}`,
    };
  }
  if (bundle.destinationSnapshotHash !== input.destinationSnapshotHash) {
    return {
      ok: false,
      code: "STALE_EXECUTION_BUNDLE",
      reason: "destination snapshot changed after approval",
    };
  }
  if (
    input.targetMenuHash &&
    bundle.targetMenuHash !== input.targetMenuHash
  ) {
    return {
      ok: false,
      code: "APPROVAL_INVALIDATED",
      reason: "targetMenuHash changed after approval",
    };
  }
  return { ok: true };
}

export function assertApprovedPlanEqualsExecutedPlan(input: {
  approvedOperations: readonly WritePlanOperation[];
  executedOperations: readonly WritePlanOperation[];
}): void {
  const approved = hashWritePlanOperations(input.approvedOperations);
  const executed = hashWritePlanOperations(input.executedOperations);
  if (approved !== executed) {
    throw new Error(
      `APPROVED_PLAN_EXECUTION_MISMATCH approved=${approved} executed=${executed}`,
    );
  }
}
