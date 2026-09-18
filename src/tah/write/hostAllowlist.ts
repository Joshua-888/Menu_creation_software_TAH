/**
 * Shared live-write host allowlist (no portal/tah circular imports).
 *
 * Operator portal default: any destination host is allowed when live writes
 * are enabled (credentials + kill switch). Set PORTAL_LIVE_WRITE_HOSTS to a
 * comma list to restrict; use PORTAL_LIVE_WRITE_HOSTS_STRICT=1 to exclude the
 * legacy Veroni default from that list.
 */

/** Legacy canary host — only auto-merged when an explicit restrict list is set without STRICT. */
export const DEFAULT_LIVE_WRITE_HOSTS = ["veronipizza.dk"] as const;

export const LIVE_WRITE_HOSTS_ALLOW_ALL = "*" as const;

/** Default: writes only against the exact approved/job destination host. */
export const LIVE_WRITE_HOSTS_BUNDLE_BOUND = "bundle-bound" as const;

/** Fail-closed: never TypeError on undefined/null/empty host. */
export class InvalidDestinationHostError extends Error {
  constructor(message = "INVALID_DESTINATION_HOST: missing or empty host") {
    super(message);
    this.name = "InvalidDestinationHostError";
  }
}

export function normalizeDestinationHost(hostOrUrl: unknown): string {
  if (typeof hostOrUrl !== "string" || !hostOrUrl.trim()) {
    throw new InvalidDestinationHostError();
  }
  const raw = hostOrUrl.trim().toLowerCase();
  try {
    if (raw.includes("://")) return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    /* fall through */
  }
  return raw.replace(/^www\./, "").replace(/:\d+$/, "");
}

function isAllowAllToken(token: string): boolean {
  const t = token.trim().toLowerCase();
  return t === "*" || t === "all" || t === "any";
}

/**
 * Parsed allowlist. Unset = bundle-bound (exact job/bundle host only).
 * `"*"` remains an emergency override, not the default.
 */
export function parseLiveWriteHostAllowlist(
  env: NodeJS.ProcessEnv = process.env,
):
  | string[]
  | typeof LIVE_WRITE_HOSTS_ALLOW_ALL
  | typeof LIVE_WRITE_HOSTS_BUNDLE_BOUND {
  const raw = env.PORTAL_LIVE_WRITE_HOSTS?.trim();
  if (!raw) return LIVE_WRITE_HOSTS_BUNDLE_BOUND;
  if (isAllowAllToken(raw)) {
    return LIVE_WRITE_HOSTS_ALLOW_ALL;
  }
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.some((p) => isAllowAllToken(p))) {
    return LIVE_WRITE_HOSTS_ALLOW_ALL;
  }
  const fromEnv = parts
    .map((s) => normalizeDestinationHost(s))
    .filter(Boolean);
  const strict =
    env.PORTAL_LIVE_WRITE_HOSTS_STRICT === "1" ||
    env.PORTAL_LIVE_WRITE_HOSTS_STRICT === "true";
  if (strict) return [...new Set(fromEnv)];
  return [...new Set([...fromEnv, ...DEFAULT_LIVE_WRITE_HOSTS])];
}

export function formatLiveWriteHostAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const list = parseLiveWriteHostAllowlist(env);
  if (list === LIVE_WRITE_HOSTS_ALLOW_ALL) return "*";
  if (list === LIVE_WRITE_HOSTS_BUNDLE_BOUND) return "bundle-bound";
  return list.join(",");
}

export function isHostAllowlistedForLiveWrites(
  destinationHost: unknown,
  env: NodeJS.ProcessEnv = process.env,
  expectedBundleHost?: string,
): boolean {
  if (typeof destinationHost !== "string" || !destinationHost.trim()) {
    return false;
  }
  const list = parseLiveWriteHostAllowlist(env);
  if (list === LIVE_WRITE_HOSTS_ALLOW_ALL) return true;
  try {
    const host = normalizeDestinationHost(destinationHost);
    if (list === LIVE_WRITE_HOSTS_BUNDLE_BOUND) {
      if (!expectedBundleHost?.trim()) return false;
      return host === normalizeDestinationHost(expectedBundleHost);
    }
    return list.includes(host);
  } catch {
    return false;
  }
}
