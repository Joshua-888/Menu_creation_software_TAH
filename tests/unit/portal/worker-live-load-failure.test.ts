/**
 * CREATE_MENU must fail closed when a live destination load was ATTEMPTED and
 * genuinely failed (login/scrape error) even though credentials are present.
 *
 * This is the edge case where relaxing offline planning must never let a real
 * failure silently degrade into empty-snapshot planning.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as LiveExecute from "../../../src/portal/liveExecute.js";

vi.mock("../../../src/portal/liveExecute.js", async () => {
  const actual =
    await vi.importActual<typeof LiveExecute>("../../../src/portal/liveExecute.js");
  return {
    ...actual,
    loadDestinationSnapshotForDryRun: async (input: {
      destinationHost: string;
    }) => ({
      destination: {
        host: input.destinationHost,
        categories: [],
        products: [],
      },
      source: "failed" as const,
      status: "FAILED" as const,
      error: "LOGIN_FAILED: simulated admin login failure",
      blocker: {
        code: "LOGIN_FAILED" as const,
        message: "simulated admin login failure",
      },
    }),
  };
});

import { PortalStore, resetPortalStoreForTests } from "../../../src/portal/store.js";
import { runMigrationJob } from "../../../src/portal/worker.js";

const RAW_PDF = join(
  process.cwd(),
  "fixtures/golden/third-merchant/raw-source.pdf",
);

describe("CREATE_MENU with attempted-but-failed live load", () => {
  let dir: string;
  let store: PortalStore;

  beforeEach(() => {
    // Credentials/allowlist are present, so live load IS attempted...
    process.env.TAH_ADMIN_EMAIL = "admin@takeawayhero.test";
    process.env.TAH_ADMIN_PASSWORD = "s3cret-pass";
    process.env.PORTAL_LIVE_WRITE_HOSTS = "fixture-thai.test";
    resetPortalStoreForTests();
    dir = mkdtempSync(join(tmpdir(), "live-load-failed-"));
    process.env.PORTAL_DB_PATH = join(dir, "portal.sqlite");
    process.env.PORTAL_DATA_DIR = dir;
    process.env.PORTAL_DECISION_DB_PATH = join(dir, "decisions.sqlite");
    store = new PortalStore(process.env.PORTAL_DB_PATH);
  });

  afterEach(() => {
    for (const key of [
      "TAH_ADMIN_EMAIL",
      "TAH_ADMIN_PASSWORD",
      "PORTAL_LIVE_WRITE_HOSTS",
    ]) {
      delete process.env[key];
    }
    store.close();
    resetPortalStoreForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    "fails closed instead of planning against an empty catalog",
    async () => {
      const emp = store.createEmployee({
        email: "op@takeawayhero.test",
        name: "Op",
        password: "s3cret-pass",
        role: "operator",
      });
      const job = store.createJob({
        merchantName: "Fixture Thai House",
        destinationHost: "fixture-thai.test",
        sourceType: "pdf_upload",
        sourceUrl: null,
        createdByEmployeeId: emp.id,
        workflow: "CREATE_MENU",
      });
      store.addJobFile({
        jobId: job.id,
        originalName: "raw-source.pdf",
        storedPath: RAW_PDF,
        mimeType: "application/pdf",
        sizeBytes: 2079,
      });

      await expect(runMigrationJob(job.id, store)).rejects.toThrow(
        /Create requires LIVE_COMPLETE destination snapshot/,
      );
      expect(store.getJob(job.id)?.status).toBe("FAILED");
    },
    60_000,
  );
});
