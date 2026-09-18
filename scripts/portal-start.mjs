/**
 * Cross-platform portal start — honors Railway/Docker PORT and binds 0.0.0.0.
 *
 * Chromium must already be baked into the image (Dockerfile.portal) or
 * installed once for local/CI. Runtime never downloads Playwright browsers.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const port = process.env.PORT?.trim() || "3000";
const host = process.env.HOST?.trim() || "0.0.0.0";

if (!process.env.BUILD_TIME?.trim()) {
  process.env.BUILD_TIME = new Date().toISOString();
}

// Never use the volume browser cache — it was installed without OS libs.
if (process.env.PLAYWRIGHT_BROWSERS_PATH?.startsWith("/data/")) {
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/ms-playwright")) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/ms-playwright";
}

function assertBrowserReady() {
  try {
    const executablePath = chromium.executablePath();
    if (!executablePath || !existsSync(executablePath)) {
      console.error(
        `[portal-start] BROWSER_RUNTIME_UNAVAILABLE executable missing at ${executablePath || "(empty)"}. Do not download at runtime; rebuild the image.`,
      );
      process.env.TAH_BROWSER_READY = "0";
      return false;
    }
    console.log(`[portal-start] Playwright Chromium ready at ${executablePath}`);
    process.env.TAH_BROWSER_READY = "1";
    return true;
  } catch (err) {
    console.error("[portal-start] BROWSER_RUNTIME_UNAVAILABLE", err);
    process.env.TAH_BROWSER_READY = "0";
    return false;
  }
}

assertBrowserReady();

const child = spawn(
  process.execPath,
  [
    "./node_modules/next/dist/bin/next",
    "start",
    "apps/portal",
    "-H",
    host,
    "-p",
    port,
  ],
  { stdio: "inherit", env: process.env },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
