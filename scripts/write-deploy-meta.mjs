/**
 * Writes apps/portal/src/deploy-meta.json for /api/version.
 * Uses Railway/CI env when present; otherwise local git HEAD.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/portal/src/deploy-meta.json");

function resolveSha() {
  // Git-connected Railway deploys set RAILWAY_GIT_COMMIT_SHA to the commit
  // being built. Prefer that, then the working tree HEAD. Do not let a leftover
  // GIT_COMMIT_SHA pin override the tree actually being packaged.
  const railway = process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
  if (railway) return railway;
  try {
    return execSync("git rev-parse HEAD", {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    const fallback = [
      process.env.GIT_COMMIT_SHA,
      process.env.COMMIT_SHA,
      process.env.SOURCE_VERSION,
    ]
      .map((s) => s?.trim())
      .find(Boolean);
    return fallback || "unknown";
  }
}

const meta = {
  commitSha: resolveSha(),
  buildTime: new Date().toISOString(),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
console.log(`[write-deploy-meta] ${out} → ${meta.commitSha}`);
