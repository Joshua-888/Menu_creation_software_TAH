import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";

export type BrowserReady =
  | { ok: true; executablePath: string }
  | { ok: false; code: "BROWSER_RUNTIME_UNAVAILABLE"; reason: string };

export function assertPlaywrightBrowserReady(): BrowserReady {
  try {
    const executablePath = chromium.executablePath();
    if (!executablePath || !existsSync(executablePath)) {
      return {
        ok: false,
        code: "BROWSER_RUNTIME_UNAVAILABLE",
        reason: `Playwright Chromium executable missing at ${executablePath || "(empty)"}`,
      };
    }
    return { ok: true, executablePath };
  } catch (err) {
    return {
      ok: false,
      code: "BROWSER_RUNTIME_UNAVAILABLE",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * One browser per worker process. Isolated context per job.
 * Does not download browsers at runtime.
 */
export class BrowserRuntime {
  private browser: Browser | null = null;

  async launch(): Promise<Browser> {
    const ready = assertPlaywrightBrowserReady();
    if (!ready.ok) {
      throw new Error(`${ready.code}: ${ready.reason}`);
    }
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.launch({
      headless: true,
      executablePath: ready.executablePath,
    });
    return this.browser;
  }

  async newJobContext(): Promise<BrowserContext> {
    const browser = await this.launch();
    return browser.newContext({ ignoreHTTPSErrors: false });
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}

let shared: BrowserRuntime | null = null;

export function getWorkerBrowserRuntime(): BrowserRuntime {
  if (!shared) shared = new BrowserRuntime();
  return shared;
}
