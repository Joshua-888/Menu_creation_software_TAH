/**
 * Portal live-write gate — dry-run remains default.
 * Live path requires PORTAL_LIVE_WRITES=1 + allowlisted destination host.
 *
 * Allowlist: PORTAL_LIVE_WRITE_HOSTS=host1.dk,host2.dk (comma-separated).
 */

import { M2B_ADAPTER_CAPABILITIES } from "../tah/contracts/evidence.js";
import {
  DEFAULT_LIVE_WRITE_HOSTS,
  isHostAllowlistedForLiveWrites,
  normalizeDestinationHost,
  parseLiveWriteHostAllowlist,
} from "../tah/write/hostAllowlist.js";

export {
  normalizeDestinationHost,
  parseLiveWriteHostAllowlist,
} from "../tah/write/hostAllowlist.js";

/** @deprecated use parseLiveWriteHostAllowlist */
export const PORTAL_LIVE_WRITE_HOST_ALLOWLIST = DEFAULT_LIVE_WRITE_HOSTS;

export function isPortalLiveWritesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.PORTAL_LIVE_WRITES === "1" || env.PORTAL_LIVE_WRITES === "true";
}

export function isDestinationHostAllowlistedForLiveWrites(
  destinationHost: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isHostAllowlistedForLiveWrites(destinationHost, env);
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
  allowlist: string[];
} {
  const env = input.env ?? process.env;
  const allowlist = parseLiveWriteHostAllowlist(env);
  const enabled = isPortalLiveWritesEnabled(env);
  const allowlisted = isDestinationHostAllowlistedForLiveWrites(
    input.destinationHost,
    env,
  );
  const createCategoryCertified =
    M2B_ADAPTER_CAPABILITIES.write.createCategory === "CERTIFIED";
  const blockers: string[] = [];
  if (!enabled) blockers.push("PORTAL_LIVE_WRITES not set to 1");
  if (!allowlisted) {
    blockers.push(
      `destination host not allowlisted (need one of: ${allowlist.join(",")}; set PORTAL_LIVE_WRITE_HOSTS)`,
    );
  }
  if (!createCategoryCertified) blockers.push("createCategory not certified");
  return {
    enabled,
    allowlisted,
    createCategoryCertified,
    canLiveExecute: blockers.length === 0,
    blockers,
    allowlist,
  };
}
