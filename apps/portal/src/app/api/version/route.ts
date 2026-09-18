import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { MENU_CONSTITUTION_VERSION } from "@engine/intelligence/constitution.js";
import {
  CAPABILITY_MATRIX_VERSION,
  CORE_PIPELINE_VERSION,
  MENU_PLATFORM_ARCHITECTURE_VERSION,
} from "@engine/architecture/menuPlatformArchitectureV1.js";
import { resolveDeployCommitSha } from "@engine/portal/index.js";
import { ADMIN_CONTRACT_VERSION } from "@engine/tah/contracts/v1.js";
import { CANONICAL_MENU_SCHEMA_VERSION } from "@engine/domain/versions.js";
import { assertPlaywrightBrowserReady } from "@engine/runtime/browserRuntime.js";
import {
  sanitizeRuntimeConfig,
  loadRuntimeConfig,
} from "@engine/runtime/runtimeConfig.js";

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

function resolveCommitSha(baked: DeployMeta): string {
  return resolveDeployCommitSha({ baked: baked.commitSha });
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
  const browser = assertPlaywrightBrowserReady();
  let runtimeConfig: Record<string, string> = {};
  try {
    runtimeConfig = sanitizeRuntimeConfig(loadRuntimeConfig());
  } catch {
    runtimeConfig = { valid: "NO" };
  }
  return NextResponse.json({
    commitSha: resolveCommitSha(baked),
    buildTime: resolveBuildTime(baked),
    environment: resolveEnvironment(),
    adapterVersion: "tah-admin-v1",
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    contractVersion: ADMIN_CONTRACT_VERSION,
    runtimeEnvironment: resolveEnvironment(),
    browserReady: browser.ok,
    runtimeConfig,
    menuConstitution: MENU_CONSTITUTION_VERSION,
    menuPlatformArchitecture: MENU_PLATFORM_ARCHITECTURE_VERSION,
    corePipeline: CORE_PIPELINE_VERSION,
    capabilityMatrix: CAPABILITY_MATRIX_VERSION,
  });
}
