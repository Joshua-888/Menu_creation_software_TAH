import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { loadRuntimeConfig, sanitizeRuntimeConfig } from "@engine/runtime/runtimeConfig.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let executablePath = "";
  try {
    executablePath = chromium.executablePath();
  } catch {
    executablePath = "";
  }
  const browserReady = Boolean(executablePath && existsSync(executablePath));
  let configOk = true;
  let runtimeConfig: Record<string, string> = {};
  try {
    runtimeConfig = sanitizeRuntimeConfig(loadRuntimeConfig());
  } catch (err) {
    configOk = false;
    runtimeConfig = {
      valid: "NO",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const ready = browserReady && configOk;
  return NextResponse.json(
    {
      ready,
      browserReady,
      configOk,
      runtimeConfig,
    },
    { status: ready ? 200 : 503 },
  );
}
