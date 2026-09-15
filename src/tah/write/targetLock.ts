/**
 * Hard host lock for admin writes.
 * Veroni canary scripts keep assertVeroniTargetLock.
 * Multi-merchant portal/live path uses assertAllowlistedAdminHost.
 */

import { VERONI_CANARY_TARGET, type TargetLockResult } from "./types.js";
import {
  formatLiveWriteHostAllowlist,
  isHostAllowlistedForLiveWrites,
  normalizeDestinationHost,
} from "./hostAllowlist.js";

/**
 * Hard host lock for Veroni canary scripts only.
 */
export function assertVeroniTargetLock(input: {
  hostname: string;
  restaurantName?: string;
  url?: string;
}): TargetLockResult {
  const host = input.hostname.replace(/:\d+$/, "").toLowerCase();
  if (host !== VERONI_CANARY_TARGET.host) {
    return {
      ok: false,
      reason: `wrong_host:expected=${VERONI_CANARY_TARGET.host}:actual=${host}`,
      host,
    };
  }
  if (input.url) {
    try {
      const u = new URL(input.url);
      if (u.host.toLowerCase() !== VERONI_CANARY_TARGET.host) {
        return {
          ok: false,
          reason: `url_host_mismatch:${u.host}`,
          host: u.host,
        };
      }
    } catch {
      return { ok: false, reason: "invalid_url", host };
    }
  }
  if (
    input.restaurantName !== undefined &&
    input.restaurantName.trim().toLowerCase() !==
      VERONI_CANARY_TARGET.restaurantName.toLowerCase()
  ) {
    return {
      ok: false,
      reason: `wrong_restaurant:expected=${VERONI_CANARY_TARGET.restaurantName}:actual=${input.restaurantName}`,
      host,
    };
  }
  return {
    ok: true,
    host: VERONI_CANARY_TARGET.host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
  };
}

/**
 * Allowlisted-host lock for production multi-merchant writes.
 */
export function assertAllowlistedAdminHost(input: {
  pageUrl: string;
  expectedHost: string;
  env?: NodeJS.ProcessEnv;
}): TargetLockResult {
  const expected = normalizeDestinationHost(input.expectedHost);
  let actual: string;
  try {
    actual = normalizeDestinationHost(new URL(input.pageUrl).host);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (actual !== expected) {
    return {
      ok: false,
      reason: `wrong_host:expected=${expected}:actual=${actual}`,
      host: actual,
    };
  }
  if (!isHostAllowlistedForLiveWrites(actual, input.env)) {
    const list = formatLiveWriteHostAllowlist(input.env);
    return {
      ok: false,
      reason: `host_not_allowlisted:${actual}:allowlist=${list}`,
      host: actual,
    };
  }
  if (
    !input.pageUrl.includes("/admin/") &&
    !input.pageUrl.includes("/login")
  ) {
    return {
      ok: false,
      reason: `not_admin_route:${input.pageUrl}`,
      host: actual,
    };
  }
  return { ok: true, host: actual, restaurantName: expected };
}

export function blockWriteUnlessTargetLocked(
  lock: TargetLockResult,
): asserts lock is Extract<TargetLockResult, { ok: true }> {
  if (!lock.ok) {
    throw new Error(`ADMIN_WRITE_BLOCKED: target lock failed (${lock.reason})`);
  }
}
