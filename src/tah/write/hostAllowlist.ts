/**
 * Shared live-write host allowlist (no portal/tah circular imports).
 */

export const DEFAULT_LIVE_WRITE_HOSTS = ["veronipizza.dk"] as const;

export function normalizeDestinationHost(hostOrUrl: string): string {
  const raw = hostOrUrl.trim().toLowerCase();
  try {
    if (raw.includes("://")) return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    /* fall through */
  }
  return raw.replace(/^www\./, "").replace(/:\d+$/, "");
}

export function parseLiveWriteHostAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.PORTAL_LIVE_WRITE_HOSTS?.trim();
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => normalizeDestinationHost(s))
        .filter(Boolean)
    : [];
  const strict =
    env.PORTAL_LIVE_WRITE_HOSTS_STRICT === "1" ||
    env.PORTAL_LIVE_WRITE_HOSTS_STRICT === "true";
  if (fromEnv.length > 0) {
    if (strict) return [...new Set(fromEnv)];
    return [...new Set([...fromEnv, ...DEFAULT_LIVE_WRITE_HOSTS])];
  }
  return [...DEFAULT_LIVE_WRITE_HOSTS];
}

export function isHostAllowlistedForLiveWrites(
  destinationHost: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const host = normalizeDestinationHost(destinationHost);
  return parseLiveWriteHostAllowlist(env).includes(host);
}
