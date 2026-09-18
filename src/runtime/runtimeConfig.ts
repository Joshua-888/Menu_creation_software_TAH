import { existsSync } from "node:fs";
import { z } from "zod";

const RuntimeConfigSchema = z.object({
  nodeEnv: z.string().default("development"),
  portalDataDir: z.string().min(1),
  portalDbPath: z.string().min(1),
  portalRunsDir: z.string().min(1),
  portalUploadsDir: z.string().min(1),
  liveWritesEnabled: z.boolean(),
  liveWriteHostsMode: z.enum(["bundle-bound", "allow-all", "explicit"]),
  playwrightBrowsersPath: z.string().nullable(),
  skipPlaywrightEnsure: z.boolean(),
  environment: z.string(),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || raw.trim() === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  throw new Error(`INVALID_BOOLEAN_CONFIG value=${raw}`);
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const hosts = env.PORTAL_LIVE_WRITE_HOSTS?.trim();
  const liveWriteHostsMode =
    !hosts || hosts === ""
      ? "bundle-bound"
      : hosts === "*" || hosts.toLowerCase() === "all"
        ? "allow-all"
        : "explicit";
  const liveWritesKill = env.PORTAL_LIVE_WRITES?.trim().toLowerCase();
  const liveWritesEnabled =
    liveWritesKill === "0" || liveWritesKill === "false"
      ? false
      : Boolean(env.TAH_ADMIN_EMAIL?.trim() && env.TAH_ADMIN_PASSWORD?.trim());
  return RuntimeConfigSchema.parse({
    nodeEnv: env.NODE_ENV ?? "development",
    portalDataDir: env.PORTAL_DATA_DIR?.trim() || "data/portal",
    portalDbPath: env.PORTAL_DB_PATH?.trim() || "data/portal/portal.sqlite",
    portalRunsDir: env.PORTAL_RUNS_DIR?.trim() || "data/portal/runs",
    portalUploadsDir: env.PORTAL_UPLOADS_DIR?.trim() || "data/portal/uploads",
    liveWritesEnabled,
    liveWriteHostsMode,
    playwrightBrowsersPath: env.PLAYWRIGHT_BROWSERS_PATH?.trim() || null,
    skipPlaywrightEnsure: parseBool(env.SKIP_PLAYWRIGHT_ENSURE, false),
    environment:
      env.RAILWAY_ENVIRONMENT_NAME?.trim() ||
      env.RAILWAY_ENVIRONMENT?.trim() ||
      env.NODE_ENV ||
      "unknown",
  });
}

export function sanitizeRuntimeConfig(
  config: RuntimeConfig,
): Record<string, string> {
  return {
    nodeEnv: config.nodeEnv,
    portalDataDir: config.portalDataDir,
    liveWritesEnabled: config.liveWritesEnabled ? "YES" : "NO",
    liveWriteHostsMode: config.liveWriteHostsMode,
    playwrightBrowsersPath: config.playwrightBrowsersPath ? "YES" : "NO",
    skipPlaywrightEnsure: config.skipPlaywrightEnsure ? "YES" : "NO",
    environment: config.environment,
    portalDbConfigured: config.portalDbPath ? "YES" : "NO",
  };
}

export function assertDurableDataPath(config: RuntimeConfig): void {
  if (
    config.environment === "production" ||
    config.environment === "Production"
  ) {
    if (
      !config.portalDataDir.startsWith("/data") &&
      !existsSync(config.portalDataDir)
    ) {
      throw new Error(
        `PERSISTENCE_FAILURE: production PORTAL_DATA_DIR is not on a durable path (${config.portalDataDir})`,
      );
    }
  }
}
