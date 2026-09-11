import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PortalStore, resetPortalStoreForTests } from "../../../src/portal/store.js";
import { runMigrationJob } from "../../../src/portal/worker.js";

describe("portal worker", () => {
  let dir: string;
  let store: PortalStore;

  beforeEach(() => {
    resetPortalStoreForTests();
    dir = mkdtempSync(join(tmpdir(), "portal-worker-"));
    process.env.PORTAL_DB_PATH = join(dir, "portal.sqlite");
    process.env.PORTAL_DATA_DIR = dir;
    store = new PortalStore(process.env.PORTAL_DB_PATH);
  });

  afterEach(() => {
    store.close();
    resetPortalStoreForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("queues source_url-only jobs as SOURCE_URL_PENDING", async () => {
    const emp = store.createEmployee({
      email: "w@takeawayhero.test",
      name: "W",
      password: "s3cret-pass",
      role: "operator",
    });
    const job = store.createJob({
      merchantName: "URL Merchant",
      destinationHost: "https://example.com",
      sourceType: "source_url",
      sourceUrl: "https://old-menu.example",
      createdByEmployeeId: emp.id,
      status: "SOURCE_URL_PENDING",
    });
    await runMigrationJob(job.id, store);
    const updated = store.getJob(job.id);
    expect(updated?.status).toBe("SOURCE_URL_PENDING");
    expect(updated?.errorMessage).toMatch(/HTML menu-site extraction/i);
  });
});
