/**
 * Portal live-write gate.
 *
 * Default ON when TAH admin credentials exist and the destination host is
 * allowlisted. Set PORTAL_LIVE_WRITES=0 to force dry-run-only (kill switch).
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

function hasTahAdminCredentials(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.TAH_ADMIN_EMAIL?.trim() && env.TAH_ADMIN_PASSWORD?.trim());
}

/**
 * Live writes are on by default when admin credentials are configured.
 * Explicit PORTAL_LIVE_WRITES=0/false disables; =1/true forces on.
 */
export function isPortalLiveWritesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.PORTAL_LIVE_WRITES === "0" || env.PORTAL_LIVE_WRITES === "false") {
    return false;
  }
  if (env.PORTAL_LIVE_WRITES === "1" || env.PORTAL_LIVE_WRITES === "true") {
    return true;
  }
  return hasTahAdminCredentials(env);
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
  if (!enabled) {
    blockers.push(
      hasTahAdminCredentials(env)
        ? "PORTAL_LIVE_WRITES=0 (kill switch)"
        : "TAH_ADMIN_EMAIL / TAH_ADMIN_PASSWORD not configured",
    );
  }
  // Even PORTAL_LIVE_WRITES=1 cannot execute without real admin login.
  if (enabled && !hasTahAdminCredentials(env)) {
    blockers.push("TAH_ADMIN_EMAIL / TAH_ADMIN_PASSWORD not configured");
  }
  if (!allowlisted) {
    blockers.push(
      `destination host not allowlisted (need one of: ${allowlist.join(",")}; set PORTAL_LIVE_WRITE_HOSTS)`,
    );
  }
  if (!createCategoryCertified) blockers.push("createCategory not certified");
  return {
    enabled: enabled && hasTahAdminCredentials(env),
    allowlisted,
    createCategoryCertified,
    canLiveExecute: blockers.length === 0,
    blockers,
    allowlist,
  };
}
