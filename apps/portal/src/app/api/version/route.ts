import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { MENU_CONSTITUTION_VERSION } from "@engine/intelligence/constitution.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeployMeta = { commitSha?: string; buildTime?: string };

function readBakedMeta(): DeployMeta {
  const candidates = [
    join(process.cwd(), "apps/portal/src/deploy-meta.json"),
    join(process.cwd(), "src/deploy-meta.json"),
    join(process.cwd(), "deploy-meta.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as DeployMeta;
    } catch {
      /* ignore corrupt meta */
    }
  }
  return {};
}

/**
 * Public deployment provenance — no secrets.
 * Prefer env (Railway / explicit GIT_COMMIT_SHA), then baked deploy-meta.json.
 */
function resolveCommitSha(baked: DeployMeta): string {
  const candidates = [
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.GIT_COMMIT_SHA,
    process.env.COMMIT_SHA,
    process.env.SOURCE_VERSION,
    baked.commitSha,
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v && v !== "unknown") return v;
  }
  return "unknown";
}

function resolveBuildTime(baked: DeployMeta): string {
  const candidates = [
    process.env.BUILD_TIME,
    process.env.RAILWAY_DEPLOYMENT_CREATED_AT,
    baked.buildTime,
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v;
  }
  return new Date().toISOString();
}

function resolveEnvironment(): string {
  const candidates = [
    process.env.RAILWAY_ENVIRONMENT_NAME,
    process.env.RAILWAY_ENVIRONMENT,
    process.env.NODE_ENV,
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v;
  }
  return "unknown";
}

export async function GET() {
  const baked = readBakedMeta();
  return NextResponse.json({
    commitSha: resolveCommitSha(baked),
    buildTime: resolveBuildTime(baked),
    environment: resolveEnvironment(),
    menuConstitution: MENU_CONSTITUTION_VERSION,
  });
}
