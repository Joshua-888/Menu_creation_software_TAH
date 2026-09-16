import { NextResponse } from "next/server";
import { MENU_CONSTITUTION_VERSION } from "@engine/intelligence/constitution.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public deployment provenance — no secrets.
 * Prefer Railway-injected commit SHA; fall back to explicit build-time env.
 */
function resolveCommitSha(): string {
  const candidates = [
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.GIT_COMMIT_SHA,
    process.env.COMMIT_SHA,
    process.env.SOURCE_VERSION,
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v;
  }
  return "unknown";
}

function resolveBuildTime(): string {
  const candidates = [
    process.env.BUILD_TIME,
    process.env.RAILWAY_DEPLOYMENT_CREATED_AT,
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
  return NextResponse.json({
    commitSha: resolveCommitSha(),
    buildTime: resolveBuildTime(),
    environment: resolveEnvironment(),
    menuConstitution: MENU_CONSTITUTION_VERSION,
  });
}
