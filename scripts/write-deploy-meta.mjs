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
  const envSha = [
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.GIT_COMMIT_SHA,
    process.env.COMMIT_SHA,
    process.env.SOURCE_VERSION,
  ]
    .map((s) => s?.trim())
    .find(Boolean);
  if (envSha) return envSha;
  try {
    return execSync("git rev-parse HEAD", {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

const meta = {
  commitSha: resolveSha(),
  buildTime: new Date().toISOString(),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
console.log(`[write-deploy-meta] ${out} → ${meta.commitSha}`);
