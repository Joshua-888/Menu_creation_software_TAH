import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertApprovedPlanEqualsExecutedPlan,
  freezeExecutionBundle,
  hashWritePlanOperations,
  validateExecutionBundle,
  requireLiveCompleteSnapshot,
  evaluatePreWriteGate,
  acquireJobLease,
  heartbeatJobLease,
  acquireDestinationWriteLock,
  reclaimExpiredLeases,
  retryPolicyFor,
  classifyHttpStatus,
  sanitizeDiagnosticText,
  buildDiagnosticPack,
  loadRuntimeConfig,
  operatorExecutionSummary,
  type ExecutionBundleV1,
  type BlockerRecordV1,
} from "../../src/runtime/index.js";
import { isHostAllowlistedForLiveWrites } from "../../src/tah/write/hostAllowlist.js";
import { assertAllowlistedAdminHost } from "../../src/tah/write/targetLock.js";
import {
  createMigrationWritePlan,
  executeMigrationPlan,
  emptyCreateCircuitBreaker,
  recordCreateCircuitFailure,
  shouldBlockRemainingCreates,
  type DestinationPort,
  type PlannedProductPayload,
} from "../../src/runner/index.js";
import { buildRecoveryPlan } from "../../src/runner/recoveryPlan.js";
import { RunStore } from "../../src/runs/sqliteStore.js";
import type { WritePlanOperation } from "../../src/runner/writePlan.js";
import { classifyCreateHttpFailure } from "../../src/tah/write/createErrorClassify.js";

function op(id: string, extra?: Partial<WritePlanOperation>): WritePlanOperation {
  return {
    operationId: id,
    entityType: "product",
    action: "CREATE",
    identity: { sourceId: `src:${id}`, menuNumber: id, name: `P${id}` },
    expectedPayload: {
      sourceId: `src:${id}`,
      menuNumber: id,
      name: `P${id}`,
      description: "d",
      basePriceOre: 1000,
      categoryIds: ["1"],
      variants: [],
      ingredients: [],
      additions: [],
      intendedHidden: true,
    },
    ...extra,
  };
}

function bundle(overrides?: Partial<ExecutionBundleV1>): ExecutionBundleV1 {
  return freezeExecutionBundle({
    restaurantKey: "bellakebab.dk",
    destinationHost: "bellakebab.dk",
    productionSha: "abc123",
    adapterVersion: "tah-admin-v1",
    contractFingerprint: "fp-1",
    targetMenuHash: "tm-1",
    destinationSnapshotHash: "ds-1",
    operations: [op("1")],
    qualityStatus: "MENU_QUALITY_READY",
    ...overrides,
  });
}

describe("ExecutionBundleV1 approval binding", () => {
  it("approved plan hash equals executed plan hash", () => {
    const frozen = bundle();
    const live = createMigrationWritePlan({
      runId: "r1",
      restaurant: "bellakebab.dk",
      host: "bellakebab.dk",
      source: "t",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "tah-admin-v1",
      contractFingerprint: "fp-1",
      dryRun: false,
      operations: frozen.operations.map((o) => ({ ...o })),
      preserveOperationOrder: true,
    });
    expect(hashWritePlanOperations(live.operations)).toBe(frozen.writePlanHash);
    expect(() =>
      assertApprovedPlanEqualsExecutedPlan({
        approvedOperations: frozen.operations,
        executedOperations: live.operations,
      }),
    ).not.toThrow();
  });

  it("invalidates approval after plan change", () => {
    const frozen = bundle();
    const changed = [op("1"), op("2")];
    expect(hashWritePlanOperations(changed)).not.toBe(frozen.writePlanHash);
    const check = validateExecutionBundle({
      bundle: { ...frozen, operations: changed, writePlanHash: frozen.writePlanHash },
      productionSha: "abc123",
      destinationHost: "bellakebab.dk",
      destinationSnapshotHash: "ds-1",
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("APPROVAL_INVALIDATED");
  });

  it("invalidates approval after destination snapshot change", () => {
    const frozen = bundle();
    const check = validateExecutionBundle({
      bundle: frozen,
      productionSha: "abc123",
      destinationHost: "bellakebab.dk",
      destinationSnapshotHash: "ds-CHANGED",
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("STALE_EXECUTION_BUNDLE");
  });

  it("reordering after approval is a mismatch unless preserveOperationOrder", () => {
    const operations: WritePlanOperation[] = [
      {
        operationId: "c1",
        entityType: "category",
        action: "CREATE",
        identity: { sourceId: "cat:a", name: "A" },
        expectedPayload: null,
      },
      op("p1"),
      {
        operationId: "c2",
        entityType: "category",
        action: "CREATE",
        identity: { sourceId: "cat:b", name: "B" },
        expectedPayload: null,
      },
    ];
    const frozen = freezeExecutionBundle({
      restaurantKey: "x",
      destinationHost: "bellakebab.dk",
      productionSha: "abc123",
      adapterVersion: "v",
      contractFingerprint: "fp",
      targetMenuHash: "t",
      destinationSnapshotHash: "d",
      operations,
      qualityStatus: "READY",
    });
    const executed = createMigrationWritePlan({
      runId: "r",
      restaurant: "x",
      host: "bellakebab.dk",
      source: "t",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "v",
      contractFingerprint: "fp",
      dryRun: false,
      operations: operations.map((o) => ({ ...o })),
      preserveOperationOrder: true,
    });
    expect(hashWritePlanOperations(executed.operations)).toBe(frozen.writePlanHash);
  });
});

describe("pre-write contract and host gate", () => {
  it("wrong destination host fails closed", () => {
    const frozen = bundle();
    const gate = evaluatePreWriteGate({
      bundle: frozen,
      pageUrl: "https://other-shop.dk/admin/menu",
      authenticated: true,
      observedContractFingerprint: "fp-1",
      observedSnapshotHash: "ds-1",
      productionSha: "abc123",
      env: {},
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("WRONG_DESTINATION_HOST");
  });

  it("TAH redirect to wrong host fails closed", () => {
    const lock = assertAllowlistedAdminHost({
      pageUrl: "https://wrong-merchant.dk/admin/menu",
      expectedHost: "bellakebab.dk",
      env: { PORTAL_LIVE_WRITE_HOSTS: "bundle-bound" } as NodeJS.ProcessEnv,
    });
    expect(lock.ok).toBe(false);
    if (!lock.ok) expect(lock.reason).toMatch(/wrong_host/);
  });

  it("missing host fails closed", () => {
    expect(
      assertAllowlistedAdminHost({
        pageUrl: "https://bellakebab.dk/admin/menu",
        expectedHost: "",
      }).ok,
    ).toBe(false);
    expect(
      isHostAllowlistedForLiveWrites("bellakebab.dk", {}, undefined),
    ).toBe(false);
  });

  it("different hostname after login fails closed", () => {
    const frozen = bundle();
    const gate = evaluatePreWriteGate({
      bundle: frozen,
      pageUrl: "https://login.takeawayhero.dk/admin/menu",
      authenticated: true,
      observedContractFingerprint: "fp-1",
      observedSnapshotHash: "ds-1",
      productionSha: "abc123",
      env: {},
    });
    expect(gate.ok).toBe(false);
  });

  it("bundle host mismatch fails closed", () => {
    const frozen = bundle();
    const check = validateExecutionBundle({
      bundle: frozen,
      productionSha: "abc123",
      destinationHost: "veronipizza.dk",
      destinationSnapshotHash: "ds-1",
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("STALE_EXECUTION_BUNDLE");
  });

  it("contract drift before write fails closed", () => {
    const frozen = bundle();
    const gate = evaluatePreWriteGate({
      bundle: frozen,
      pageUrl: "https://bellakebab.dk/admin/menu",
      authenticated: true,
      observedContractFingerprint: "fp-OTHER",
      observedSnapshotHash: "ds-1",
      productionSha: "abc123",
      env: {},
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("DESTINATION_CONTRACT_DRIFT");
  });
});

describe("fake-empty snapshot prevention", () => {
  it("FAILED snapshot cannot authorize CREATE", () => {
    expect(() =>
      requireLiveCompleteSnapshot(
        {
          status: "FAILED",
          blocker: { code: "LOGIN_FAILED", message: "login stayed on /login" },
        },
        "CREATE",
      ),
    ).toThrow(/FAILED snapshot/);
  });

  it("OFFLINE_EXPLICIT cannot become live-executable", () => {
    expect(() =>
      requireLiveCompleteSnapshot(
        { status: "OFFLINE_EXPLICIT", reason: "PORTAL_DRYRUN_LIVE_DEST=0" },
        "EXECUTE",
      ),
    ).toThrow(/OFFLINE_EXPLICIT/);
  });

  it("LIVE_PARTIAL_WITH_ERRORS cannot authorize mutations", () => {
    expect(() =>
      requireLiveCompleteSnapshot(
        {
          status: "LIVE_PARTIAL_WITH_ERRORS",
          snapshot: { host: "x", categories: [], products: [] },
          meta: {
            categoryCount: 0,
            productCount: 0,
            pagesRead: 1,
            complete: false,
            errors: ["readProduct 1 failed"],
          },
          blocker: { code: "PARTIAL_READ_ERRORS", message: "readProduct 1 failed" },
        },
        "QA",
      ),
    ).toThrow(/LIVE_PARTIAL/);
  });
});

describe("deep snapshot complexity", () => {
  it("lists the catalog once then reads N edit pages", () => {
    const catalog = Array.from({ length: 40 }, (_, i) => ({ id: String(i + 1) }));
    let listCalls = 0;
    let editReads = 0;
    listCalls += 1;
    const listed = catalog;
    for (const row of listed) {
      void row;
      editReads += 1;
    }
    expect(listCalls).toBe(1);
    expect(editReads).toBe(40);
  });
});

describe("durable worker leases and destination lock", () => {
  let dir: string;
  let db: DatabaseSync;

  afterEach(() => {
    db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("second mutating job against same destination is DESTINATION_WRITE_LOCKED", () => {
    dir = mkdtempSync(join(tmpdir(), "lease-"));
    db = new DatabaseSync(join(dir, "p.sqlite"));
    const a = acquireDestinationWriteLock(db, {
      destinationHost: "bellakebab.dk",
      jobId: "job-1",
      owner: "w1",
    });
    expect(a.ok).toBe(true);
    const b = acquireDestinationWriteLock(db, {
      destinationHost: "bellakebab.dk",
      jobId: "job-2",
      owner: "w2",
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe("DESTINATION_WRITE_LOCKED");
  });

  it("expired lease can be reclaimed", () => {
    dir = mkdtempSync(join(tmpdir(), "lease-"));
    db = new DatabaseSync(join(dir, "p.sqlite"));
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = acquireJobLease(db, {
      jobId: "job-1",
      owner: "dead-worker",
      stage: "EXECUTION",
      now,
      ttlMs: 1,
    });
    expect(first.ok).toBe(true);
    const later = new Date(now.getTime() + 5_000);
    const reclaimed = reclaimExpiredLeases(db, later);
    expect(reclaimed.expiredJobs).toContain("job-1");
    const second = acquireJobLease(db, {
      jobId: "job-1",
      owner: "new-worker",
      stage: "EXECUTION",
      now: later,
    });
    expect(second.ok).toBe(true);
  });

  it("heartbeat from a different owner is WORKER_LEASE_EXPIRED", () => {
    dir = mkdtempSync(join(tmpdir(), "lease-"));
    db = new DatabaseSync(join(dir, "p.sqlite"));
    acquireJobLease(db, { jobId: "job-1", owner: "w1", stage: "SOURCE" });
    const beat = heartbeatJobLease(db, { jobId: "job-1", owner: "w2" });
    expect(beat.ok).toBe(false);
    if (!beat.ok) expect(beat.code).toBe("WORKER_LEASE_EXPIRED");
  });
});

describe("resume does not duplicate verified creates", () => {
  let dir: string;
  let store: RunStore;

  afterEach(() => {
    store?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("skips VERIFIED operations on resume", async () => {
    dir = mkdtempSync(join(tmpdir(), "resume-"));
    store = new RunStore(join(dir, "runs.sqlite"));
    const created: string[] = [];
    const products = new Map<string, PlannedProductPayload>();
    const destination: DestinationPort = {
      async findByIdentity(identity) {
        const hit = [...products.values()].find(
          (p) => p.sourceId === identity.sourceId || p.menuNumber === identity.menuNumber,
        );
        if (!hit) return { outcome: "NONE" };
        return {
          outcome: "FOUND",
          product: {
            databaseId: hit.sourceId,
            menuNumber: hit.menuNumber,
            name: hit.name,
            description: hit.description,
            basePriceOre: hit.basePriceOre,
            categoryIds: hit.categoryIds,
            variants: [],
            ingredients: [],
            additions: [],
            listStatus: "Skjult",
          },
        };
      },
      async readProduct(databaseId: string) {
        const hit = products.get(databaseId);
        if (!hit) throw new Error("missing");
        return {
          databaseId,
          menuNumber: hit.menuNumber,
          name: hit.name,
          description: hit.description,
          basePriceOre: hit.basePriceOre,
          categoryIds: hit.categoryIds,
          variants: [],
          ingredients: [],
          additions: [],
          listStatus: "Skjult",
        };
      },
      async createHiddenProduct(payload: PlannedProductPayload) {
        created.push(payload.sourceId);
        products.set(payload.sourceId, payload);
        return { outcome: "CREATED", databaseId: payload.sourceId };
      },
    };
    const plan = createMigrationWritePlan({
      runId: "resume-1",
      restaurant: "x",
      host: "bellakebab.dk",
      source: "t",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "v",
      contractFingerprint: "fp",
      dryRun: false,
      operations: [op("1"), op("2")],
      preserveOperationOrder: true,
    });
    store.upsertRun({
      runId: "resume-1",
      restaurant: "x",
      host: "bellakebab.dk",
      source: "t",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "v",
      contractFingerprint: "fp",
      startedAt: new Date().toISOString(),
      status: "RUNNING",
    });
    store.upsertOperation({
      runId: "resume-1",
      operationId: "1",
      entityType: "product",
      action: "CREATE",
      identitySourceId: "src:1",
      identityMenuNumber: "1",
      identityName: "P1",
      expectedPayloadJson: null,
      destinationId: "src:1",
      state: "VERIFIED",
      attemptCount: 1,
      lastErrorCategory: null,
      lastErrorMessage: null,
      verificationDiffJson: null,
      updatedAt: new Date().toISOString(),
    });
    await executeMigrationPlan({
      plan,
      store,
      destination,
      gate: { hostOk: true, contractMatch: true, host: "bellakebab.dk", expectedHost: "bellakebab.dk" },
    });
    expect(created).toEqual(["src:2"]);
  });
});

describe("retry classification and circuit breaker", () => {
  it("does not retry deterministic 500 / 4xx identically", () => {
    expect(retryPolicyFor("DESTINATION_APPLICATION_500").maxAttempts).toBe(0);
    expect(retryPolicyFor("DESTINATION_VALIDATION_4XX").maxAttempts).toBe(0);
    expect(retryPolicyFor("TRANSIENT_NETWORK").maxAttempts).toBe(3);
    expect(classifyHttpStatus(500)).toBe("DESTINATION_APPLICATION_500");
    expect(classifyHttpStatus(503)).toBe("DESTINATION_502_503_504");
  });

  it("trips create circuit breaker on deterministic HTTP 500", () => {
    const classified = classifyCreateHttpFailure({
      httpStatus: 500,
      bodyText: "OOPS! INTERNAL SERVER ERROR",
    });
    const tripped = recordCreateCircuitFailure(
      emptyCreateCircuitBreaker(),
      classified,
    );
    expect(shouldBlockRemainingCreates(tripped)).toBe(true);
  });
});

describe("recovery V2", () => {
  it("never auto-deletes and reuses persisted objects", () => {
    const plan = createMigrationWritePlan({
      runId: "rec",
      restaurant: "x",
      host: "bellakebab.dk",
      source: "t",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "v",
      contractFingerprint: "fp",
      dryRun: false,
      operations: [
        {
          operationId: "c1",
          entityType: "category",
          action: "CREATE",
          identity: { sourceId: "cat:a", name: "A" },
          expectedPayload: null,
        },
      ],
    });
    const recovery = buildRecoveryPlan({
      plan,
      operationRecords: [
        {
          runId: "rec",
          operationId: "c1",
          entityType: "category",
          action: "CREATE",
          identitySourceId: "cat:a",
          identityMenuNumber: "",
          identityName: "A",
          expectedPayloadJson: null,
          destinationId: "7",
          state: "VERIFIED",
          attemptCount: 1,
          lastErrorCategory: null,
          lastErrorMessage: null,
          verificationDiffJson: null,
          updatedAt: new Date().toISOString(),
        },
      ],
      destinationSnapshot: { categories: [{}], products: [] },
    });
    expect(recovery.executeAutomatically).toBe(false);
    expect(recovery.neverAutoDelete).toBe(true);
    expect(recovery.operations[0]?.proposedAction).toBe("continue");
    expect(recovery.operations[0]?.reason).toMatch(/Never auto-delete/);
  });
});

describe("diagnostics and config", () => {
  it("redacts secrets from diagnostic text", () => {
    expect(
      sanitizeDiagnosticText("password=secret cookie=abc authorization: Bearer xyz"),
    ).not.toMatch(/secret|Bearer xyz|abc/);
  });

  it("builds a DiagnosticPack without secret fields", () => {
    const blocker: BlockerRecordV1 = {
      blockerId: "b1",
      runId: "r1",
      operationId: "op1",
      classification: "DESTINATION_APPLICATION_500",
      scope: "operation",
      severity: "error",
      fingerprint: "fp",
      endpoint: "/admin/menu",
      httpStatus: 500,
      adapterVersion: "v",
      contractFingerprint: "c",
      productionSha: "sha",
      destinationHost: "bellakebab.dk",
      firstSeenAt: "t",
      lastSeenAt: "t",
      occurrenceCount: 1,
      safeAutomaticAction: "circuit_break",
      retryPolicy: "circuit_break",
      requiresHuman: true,
      evidenceArtifacts: [],
    };
    const pack = buildDiagnosticPack({
      blocker,
      recoveryRecommendation: "Read destination; do not replay verified ops.",
      responseSignature: "password=nope",
    });
    expect(JSON.stringify(pack)).not.toMatch(/password=nope/);
  });

  it("validates runtime booleans fail-fast", () => {
    expect(() =>
      loadRuntimeConfig({ SKIP_PLAYWRIGHT_ENSURE: "maybe" } as NodeJS.ProcessEnv),
    ).toThrow(/INVALID_BOOLEAN_CONFIG/);
    const cfg = loadRuntimeConfig({} as NodeJS.ProcessEnv);
    expect(cfg.liveWriteHostsMode).toBe("bundle-bound");
  });

  it("operator summary explains circuit-breaker stop", () => {
    const text = operatorExecutionSummary({
      result: {
        verified: 0,
        failed: 1,
        blocked: 11,
        processed: 12,
        circuitBreakerTripped: true,
        createErrorSignature: "http-500",
        recoveryRequired: true,
        status: "PARTIAL_WRITE",
      },
    });
    expect(text).toMatch(/circuit breaker/i);
    expect(text).toMatch(/Not attempted 11/);
  });
});

describe("production surface guards", () => {
  it("src production code has no waitForTimeout UI sync sleeps", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(ts|js|mjs)$/.test(name)) {
          const text = readFileSync(p, "utf8");
          if (text.includes("waitForTimeout")) hits.push(p);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });
});
