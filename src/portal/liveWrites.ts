/**
 * Portal live-write gate — dry-run remains default.
 * Live path requires PORTAL_LIVE_WRITES=1 + allowlisted destination host.
 */

import { M2B_ADAPTER_CAPABILITIES } from "../tah/contracts/evidence.js";
import { VERONI_CANARY_TARGET } from "../tah/write/types.js";

/** Hosts allowed for gated live admin writes (M6.7). */
export const PORTAL_LIVE_WRITE_HOST_ALLOWLIST = [
  VERONI_CANARY_TARGET.host,
] as const;

export function normalizeDestinationHost(hostOrUrl: string): string {
  const raw = hostOrUrl.trim().toLowerCase();
  try {
    if (raw.includes("://")) return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    /* fall through */
  }
  return raw.replace(/^www\./, "").replace(/:\d+$/, "");
}

export function isPortalLiveWritesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.PORTAL_LIVE_WRITES === "1" || env.PORTAL_LIVE_WRITES === "true";
}

export function isDestinationHostAllowlistedForLiveWrites(
  destinationHost: string,
): boolean {
  const host = normalizeDestinationHost(destinationHost);
  return (PORTAL_LIVE_WRITE_HOST_ALLOWLIST as readonly string[]).includes(host);
}

export function evaluatePortalLiveWriteGate(input: {
  destinationHost: string;
  env?: NodeJS.ProcessEnv;
}): {
  enabled: boolean;
  allowlisted: boolean;
  createCategoryCertified: boolean;
  canLiveExecute: boolean;
  blockers: string[];
} {
  const env = input.env ?? process.env;
  const enabled = isPortalLiveWritesEnabled(env);
  const allowlisted = isDestinationHostAllowlistedForLiveWrites(
    input.destinationHost,
  );
  const createCategoryCertified =
    M2B_ADAPTER_CAPABILITIES.write.createCategory === "CERTIFIED";
  const blockers: string[] = [];
  if (!enabled) blockers.push("PORTAL_LIVE_WRITES not set to 1");
  if (!allowlisted) {
    blockers.push(
      `destination host not allowlisted (need ${PORTAL_LIVE_WRITE_HOST_ALLOWLIST.join(",")})`,
    );
  }
  if (!createCategoryCertified) blockers.push("createCategory not certified");
  return {
    enabled,
    allowlisted,
    createCategoryCertified,
    canLiveExecute: blockers.length === 0,
    blockers,
  };
}
