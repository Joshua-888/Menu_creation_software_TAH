/**
 * Offline CREATE_MENU planning + snapshot-provenance safety.
 *
 * Regression coverage for the CREATE_MENU planning gate and the invariant that
 * an OFFLINE_EXPLICIT plan can never become live-executable, even when its
 * destination snapshot hash happens to equal a genuinely empty live catalog.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJobArtifact } from "../../../src/portal/artifacts.js";
import { executePortalLiveWrites } from "../../../src/portal/liveExecute.js";
import {
  PortalStore,
  resetPortalStoreForTests,
} from "../../../src/portal/store.js";
import { runMigrationJob } from "../../../src/portal/worker.js";
import {
  freezeExecutionBundle,
  validateExecutionBundle,
  type ExecutionBundleV1,
} from "../../../src/runtime/executionBundle.js";
import { sha256Canonical } from "../../../src/runtime/sha.js";

const RAW_PDF = join(
  process.cwd(),
  "fixtures/golden/third-merchant/raw-source.pdf",
);

const CRED_ENV = [
  "TAH_ADMIN_EMAIL",
  "TAH_ADMIN_PASSWORD",
  "PORTAL_LIVE_WRITES",
] as const;

function hashOf(destinationHost: string): string {
  return sha256Canonical({
    host: destinationHost,
    categories: [],
    products: [],
  });
}

describe("offline CREATE_MENU planning + snapshot provenance", () => {
  let dir: string;
  let store: PortalStore;

  beforeEach(() => {
    for (const key of CRED_ENV) delete process.env[key];
    resetPortalStoreForTests();
    dir = mkdtempSync(join(tmpdir(), "offline-plan-"));
    process.env.PORTAL_DB_PATH = join(dir, "portal.sqlite");
    process.env.PORTAL_DATA_DIR = dir;
    process.env.PORTAL_DECISION_DB_PATH = join(dir, "decisions.sqlite");
    store = new PortalStore(process.env.PORTAL_DB_PATH);
  });

  afterEach(() => {
    store.close();
    resetPortalStoreForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  function createPdfJob(workflow: "CREATE_MENU" | "QA_RECONCILE") {
    const emp = store.createEmployee({
      email: "offline@takeawayhero.test",
      name: "Offline",
      password: "s3cret-pass",
      role: "operator",
    });
    const job = store.createJob({
      merchantName: "Fixture Thai House",
      destinationHost: "fixture-thai.test",
      sourceType: "pdf_upload",
      sourceUrl: null,
      createdByEmployeeId: emp.id,
      workflow,
    });
    if (workflow === "CREATE_MENU") {
      store.addJobFile({
        jobId: job.id,
        originalName: "raw-source.pdf",
        storedPath: RAW_PDF,
        mimeType: "application/pdf",
        sizeBytes: 2079,
      });
    }
    return job;
  }

  it(
    "plans a CREATE_MENU pdf job offline (no live credentials) without crashing",
    async () => {
      const job = createPdfJob("CREATE_MENU");

      await runMigrationJob(job.id, store);

      const updated = store.getJob(job.id);
      expect(updated?.status).not.toBe("FAILED");
      // Quality-contract outcome (READY / REVIEW / OPERATOR_APPROVAL) depends on
      // the fixture; the point is the whole planning pipeline completed.
      expect([
        "AWAITING_REVIEW",
        "AWAITING_OPERATOR_APPROVAL",
        "READY_DRY_RUN",
      ]).toContain(updated?.status);

      const meta = readJobArtifact(job.id, "destination-snapshot-meta.json", store) as {
        source?: string;
        status?: string;
      } | null;
      expect(meta?.source).toBe("empty");
      expect(meta?.status).toBe("OFFLINE_EXPLICIT");

      expect(readJobArtifact(job.id, "target-menu.json", store)).not.toBeNull();
      expect(
        readJobArtifact(job.id, "menu-quality-contract.json", store),
      ).not.toBeNull();

      const bundle = readJobArtifact(
        job.id,
        "execution-bundle.json",
        store,
      ) as ExecutionBundleV1 | null;
      expect(bundle).not.toBeNull();
      expect(bundle?.destinationSnapshotStatus).toBe("OFFLINE_EXPLICIT");
      expect(bundle?.immutable).toBe(true);
      expect(bundle?.operationCount).toBeGreaterThan(0);
    },
    180_000,
  );

  it(
    "still fails closed for QA_RECONCILE without live credentials",
    async () => {
      const job = createPdfJob("QA_RECONCILE");

      await expect(runMigrationJob(job.id, store)).rejects.toThrow(
        /QA_RECONCILE requires LIVE_COMPLETE/,
      );
      expect(store.getJob(job.id)?.status).toBe("FAILED");
    },
    180_000,
  );

  it(
    "an OFFLINE_EXPLICIT bundle is not live-executable even when its hash equals a genuinely empty live destination",
    () => {
      const host = "fixture-thai.test";
      // The hash of a genuinely empty live destination — the dangerous case
      // where the stale-hash freshness check would otherwise pass.
      const emptyLiveHash = hashOf(host);
      const base = {
        restaurantKey: "fixture-thai.test",
        destinationHost: host,
        productionSha: "sha-offline",
        adapterVersion: "tah-admin-v1",
        contractFingerprint: "fp-1",
        targetMenuHash: "tm-1",
        destinationSnapshotHash: emptyLiveHash,
        operations: [],
        qualityStatus: "MENU_QUALITY_READY",
      } as const;

      const offlineBundle = freezeExecutionBundle({
        ...base,
        destinationSnapshotStatus: "OFFLINE_EXPLICIT",
      });
      const offlineCheck = validateExecutionBundle({
        bundle: offlineBundle,
        productionSha: "sha-offline",
        destinationHost: host,
        destinationSnapshotHash: emptyLiveHash,
      });
      expect(offlineCheck.ok).toBe(false);
      if (!offlineCheck.ok) {
        expect(offlineCheck.code).toBe("STALE_EXECUTION_BUNDLE");
        expect(offlineCheck.reason).toMatch(/OFFLINE_EXPLICIT/);
      }

      // Positive control: identical hashes with LIVE_COMPLETE provenance pass,
      // proving the gate keys on provenance rather than the (matching) hash.
      const liveBundle = freezeExecutionBundle({
        ...base,
        destinationSnapshotStatus: "LIVE_COMPLETE",
      });
      const liveCheck = validateExecutionBundle({
        bundle: liveBundle,
        productionSha: "sha-offline",
        destinationHost: host,
        destinationSnapshotHash: emptyLiveHash,
      });
      expect(liveCheck.ok).toBe(true);
    },
  );

  it(
    "live execution refuses an OFFLINE_EXPLICIT bundle before any browser work",
    async () => {
      const host = "fixture-thai.test";
      const bundle = freezeExecutionBundle({
        restaurantKey: host,
        destinationHost: host,
        productionSha: "sha-offline",
        adapterVersion: "tah-admin-v1",
        contractFingerprint: "fp-1",
        targetMenuHash: "tm-1",
        destinationSnapshotHash: hashOf(host),
        destinationSnapshotStatus: "OFFLINE_EXPLICIT",
        operations: [],
        qualityStatus: "MENU_QUALITY_READY",
      });

      await expect(
        executePortalLiveWrites({
          runId: "run-offline-guard",
          restaurant: host,
          destinationHost: host,
          source: "test",
          schemaVersion: "1",
          domainRuleVersion: "1",
          adapterVersion: "tah-admin-v1",
          contractFingerprint: "fp-1",
          runsDbPath: join(dir, "live-runs.sqlite"),
          workflow: "CREATE_MENU",
          executionBundle: bundle,
        }),
      ).rejects.toThrow(/STALE_EXECUTION_BUNDLE.*OFFLINE_EXPLICIT/s);
    },
    60_000,
  );
});
