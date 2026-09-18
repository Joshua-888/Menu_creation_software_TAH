import { normalizeDestinationHost } from "../tah/write/hostAllowlist.js";
import { assertAllowlistedAdminHost } from "../tah/write/targetLock.js";
import type { ExecutionBundleV1 } from "./executionBundle.js";

export type PreWriteGateEvidence = {
  pageHost: string;
  expectedHost: string;
  authenticated: boolean;
  contractFingerprintExpected: string;
  contractFingerprintObserved: string;
  snapshotHashExpected: string;
  snapshotHashObserved: string;
  productionSha: string;
};

export type PreWriteGateResult =
  | { ok: true; evidence: PreWriteGateEvidence }
  | {
      ok: false;
      code:
        | "DESTINATION_CONTRACT_DRIFT"
        | "AUTH_SESSION_EXPIRED"
        | "AUTH_CREDENTIALS_REJECTED"
        | "STALE_EXECUTION_BUNDLE"
        | "WRONG_DESTINATION_HOST";
      reason: string;
      evidence: Partial<PreWriteGateEvidence>;
    };

/**
 * Evidence-based mutation gate. Never pass hostOk/contractMatch as assumptions.
 */
export function evaluatePreWriteGate(input: {
  bundle: ExecutionBundleV1;
  pageUrl: string;
  authenticated: boolean;
  observedContractFingerprint: string;
  observedSnapshotHash: string;
  productionSha: string;
  env?: NodeJS.ProcessEnv;
}): PreWriteGateResult {
  let pageHost = "";
  try {
    pageHost = normalizeDestinationHost(new URL(input.pageUrl).hostname);
  } catch {
    return {
      ok: false,
      code: "WRONG_DESTINATION_HOST",
      reason: `unparseable page URL: ${input.pageUrl}`,
      evidence: {},
    };
  }
  const expectedHost = normalizeDestinationHost(input.bundle.destinationHost);
  const lock = assertAllowlistedAdminHost({
    pageUrl: input.pageUrl,
    expectedHost,
    ...(input.env ? { env: input.env } : {}),
  });
  const evidence: PreWriteGateEvidence = {
    pageHost,
    expectedHost,
    authenticated: input.authenticated,
    contractFingerprintExpected: input.bundle.contractFingerprint,
    contractFingerprintObserved: input.observedContractFingerprint,
    snapshotHashExpected: input.bundle.destinationSnapshotHash,
    snapshotHashObserved: input.observedSnapshotHash,
    productionSha: input.productionSha,
  };
  if (!lock.ok) {
    return {
      ok: false,
      code: "WRONG_DESTINATION_HOST",
      reason: lock.reason,
      evidence,
    };
  }
  if (pageHost !== expectedHost) {
    return {
      ok: false,
      code: "WRONG_DESTINATION_HOST",
      reason: `pageHost=${pageHost} bundleHost=${expectedHost}`,
      evidence,
    };
  }
  if (!input.authenticated) {
    return {
      ok: false,
      code: "AUTH_CREDENTIALS_REJECTED",
      reason: "not authenticated on destination admin",
      evidence,
    };
  }
  if (input.observedContractFingerprint !== input.bundle.contractFingerprint) {
    return {
      ok: false,
      code: "DESTINATION_CONTRACT_DRIFT",
      reason: `expected=${input.bundle.contractFingerprint} observed=${input.observedContractFingerprint}`,
      evidence,
    };
  }
  if (input.observedSnapshotHash !== input.bundle.destinationSnapshotHash) {
    return {
      ok: false,
      code: "STALE_EXECUTION_BUNDLE",
      reason: "destination snapshot changed after approval",
      evidence,
    };
  }
  if (input.productionSha !== input.bundle.productionSha) {
    return {
      ok: false,
      code: "STALE_EXECUTION_BUNDLE",
      reason: `productionSha expected=${input.bundle.productionSha} actual=${input.productionSha}`,
      evidence,
    };
  }
  return { ok: true, evidence };
}
