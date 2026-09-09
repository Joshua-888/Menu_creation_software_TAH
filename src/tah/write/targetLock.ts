import { VERONI_CANARY_TARGET, type TargetLockResult } from "./types.js";

/**
 * Hard host lock. Never redirects / never falls back to another restaurant.
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
      if (u.pathname.includes("/admin") === false && !u.pathname.includes("/login")) {
        // allow login + admin only for mutation paths; callers decide
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

export function blockWriteUnlessTargetLocked(
  lock: TargetLockResult,
): asserts lock is Extract<TargetLockResult, { ok: true }> {
  if (!lock.ok) {
    throw new Error(`ADMIN_WRITE_BLOCKED: target lock failed (${lock.reason})`);
  }
}
