import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** Repo root — prefer env, else process.cwd() (Next/Railway start from monorepo root). */
export function repoRoot(): string {
  const fromEnv = process.env.PORTAL_REPO_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd());
}

export function portalDataDir(): string {
  const fromEnv = process.env.PORTAL_DATA_DIR?.trim();
  const dir = fromEnv ? resolve(fromEnv) : join(repoRoot(), "data", "portal");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function portalDbPath(): string {
  return (
    process.env.PORTAL_DB_PATH?.trim() || join(portalDataDir(), "portal.sqlite")
  );
}

export function uploadsDir(): string {
  const dir =
    process.env.PORTAL_UPLOADS_DIR?.trim() ||
    join(portalDataDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function runsDir(): string {
  const dir =
    process.env.PORTAL_RUNS_DIR?.trim() || join(portalDataDir(), "runs");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function jobRunDir(jobId: string, runId: string): string {
  const dir = join(runsDir(), jobId, runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
