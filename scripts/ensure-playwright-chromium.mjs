/**
 * Ensure Playwright Chromium exists for portal Create/QA live destination loads.
 * Always installs when missing (local no-ops if already cached).
 * Set SKIP_PLAYWRIGHT_ENSURE=1 to force skip.
 */
import { existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

if (process.env.SKIP_PLAYWRIGHT_ENSURE === "1") {
  console.log("[ensure-playwright] skip (SKIP_PLAYWRIGHT_ENSURE=1)");
  process.exit(0);
}

// Prefer image path when present; never use the broken /data volume cache.
if (process.env.PLAYWRIGHT_BROWSERS_PATH?.startsWith("/data/")) {
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}
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

const roots = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  "/ms-playwright",
  `${homedir()}/.cache/ms-playwright`,
  "/root/.cache/ms-playwright",
].filter(Boolean);

if (roots.some((r) => chromiumInstalled(r))) {
  console.log(`[ensure-playwright] Chromium already present (${roots.find((r) => chromiumInstalled(r))})`);
  process.exit(0);
}

console.log("[ensure-playwright] Installing Chromium for Create/QA…");
try {
  execSync("npx playwright install --with-deps chromium", {
    stdio: "inherit",
    env: process.env,
  });
} catch {
  console.warn("[ensure-playwright] --with-deps failed; retrying chromium-only…");
  execSync("npx playwright install chromium", {
    stdio: "inherit",
    env: process.env,
  });
}
console.log("[ensure-playwright] Chromium ready");
