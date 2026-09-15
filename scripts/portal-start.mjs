/**
 * Cross-platform portal start — honors Railway/Docker PORT and binds 0.0.0.0.
 *
 * Critical: start Next.js FIRST so Railway healthchecks (/login) pass.
 * Playwright Chromium is ensured in the background — never block HTTP ready.
 * Prefer image-baked browsers at /ms-playwright (Dockerfile.portal).
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const port = process.env.PORT?.trim() || "3000";
const host = process.env.HOST?.trim() || "0.0.0.0";

// Never use the volume browser cache — it was installed without OS libs and
// still breaks even after Chromium binaries exist under /data/ms-playwright.
if (process.env.PLAYWRIGHT_BROWSERS_PATH?.startsWith("/data/")) {
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}

// Prefer the Docker image browser cache when present.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/ms-playwright")) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/ms-playwright";
}

function chromiumInstalled(root) {
  if (!root || !existsSync(root)) return false;
  try {
    return readdirSync(root).some((n) => /chromium/i.test(n));
  } catch {
    return false;
  }
}

function ensureChromiumAsync() {
  const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (chromiumInstalled(browserRoot)) {
    console.log(`[portal-start] Playwright browsers at ${browserRoot}`);
    return;
  }
  console.log(
    "[portal-start] Chromium missing — installing in background (HTTP already up)…",
  );
  // Detach: do not block Next.js readiness / Railway healthcheck.
  const installer = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["playwright", "install", "--with-deps", "chromium"],
    {
      stdio: "inherit",
      env: process.env,
      detached: false,
    },
  );
  installer.on("exit", (code) => {
    if (code === 0) {
      console.log("[portal-start] Playwright Chromium install finished");
      return;
    }
    console.warn(
      `[portal-start] --with-deps failed (code ${code}); retrying chromium-only…`,
    );
    try {
      execSync("npx playwright install chromium", {
        stdio: "inherit",
        env: process.env,
      });
      console.log("[portal-start] Playwright Chromium install finished");
    } catch (err) {
      console.error("[portal-start] Playwright install failed:", err);
    }
  });
}

ensureChromiumAsync();

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
