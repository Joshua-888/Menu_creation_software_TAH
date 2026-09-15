/**
 * Cross-platform portal start — honors Railway/Docker PORT and binds 0.0.0.0.
 * Ensures Playwright Chromium exists (persisted on /data when available).
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";

const port = process.env.PORT?.trim() || "3000";
const host = process.env.HOST?.trim() || "0.0.0.0";

// Persist browsers on the Railway volume so we don't re-download every boot.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/data")) {
  const browserDir = "/data/ms-playwright";
  mkdirSync(browserDir, { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserDir;
}

function chromiumInstalled() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return false;
  try {
    return readdirSync(root).some((n) => /chromium/i.test(n));
  } catch {
    return false;
  }
}

if (!chromiumInstalled()) {
  console.log("[portal-start] Installing Playwright Chromium…");
  execSync("npx playwright install chromium", {
    stdio: "inherit",
    env: process.env,
  });
} else {
  console.log(
    `[portal-start] Playwright browsers present at ${process.env.PLAYWRIGHT_BROWSERS_PATH}`,
  );
}

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
