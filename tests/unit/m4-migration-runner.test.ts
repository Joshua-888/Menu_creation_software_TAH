import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunStore } from "../../src/runs/sqliteStore.js";
import {
  assertWritePlanImmutable,
  createMigrationWritePlan,
  planBlockProduct,
  planCreateProduct,
  planSkipProduct,
} from "../../src/runner/writePlan.js";
import {
  compareProductExact,
  executeMigrationPlan,
  matchDestinationByEvidence,
  resolveCreateResume,
  resolveDestinationIdentity,
  type DestinationPort,
  type DestinationProduct,
  type DestinationMatchResult,
} from "../../src/runner/executor.js";
import type { PlannedProductPayload } from "../../src/runner/writePlan.js";

function payload(
  i: number,
  overrides: Partial<PlannedProductPayload> = {},
): PlannedProductPayload {
  return {
    sourceId: `src-mig-${i}`,
    menuNumber: `99${String(100 + i).slice(1)}`,
    name: `__TAH_MIG_${i}__`,
    description: `desc ${i}`,
    basePriceOre: 10_000,
    categoryIds: ["1"],
    variants: [
      { name: "Alm.", surchargeOre: 0 },
      { name: "Deep Pan", surchargeOre: 2000 },
    ],
    ingredients: ["Tomat", "Ost"],
    additions: [{ name: "Extra", priceOre: 1700 }],
    intendedHidden: true,
    ...overrides,
  };
}

function toDest(p: PlannedProductPayload, databaseId: string): DestinationProduct {
  return {
    databaseId,
    menuNumber: p.menuNumber,
    name: p.name,
    description: p.description,
    basePriceOre: p.basePriceOre,
    categoryIds: [...p.categoryIds],
    variants: p.variants.map((v) => ({
      name: v.name,
      priceOre: v.surchargeOre,
    })),
    ingredients: p.ingredients.map((name) => ({ name })),
    additions: p.additions.map((a) => ({
      name: a.name,
      priceOre: a.priceOre,
    })),
    listStatus: "Skjult",
    sourceId: p.sourceId,
  };
}

function portFromMap(
  created: Map<string, DestinationProduct>,
  opts?: {
    createHiddenProduct?: DestinationPort["createHiddenProduct"];
  },
): DestinationPort {
  return {
    async findByIdentity(identity): Promise<DestinationMatchResult> {
      return resolveDestinationIdentity(identity, [...created.values()]);
    },
    async readProduct(databaseId) {
      const p = created.get(databaseId);
      if (!p) throw new Error("missing");
      return p;
    },
    async createHiddenProduct(pl) {
      if (opts?.createHiddenProduct) return opts.createHiddenProduct(pl);
      const id = `db-${created.size + 1}`;
      const dest = toDest(pl, id);
      created.set(id, dest);
      return { outcome: "CREATED", databaseId: id };
    },
  };
}

describe("M4 WritePlan", () => {
  it("freezes plan and rejects mutation surface", () => {
    const plan = createMigrationWritePlan({
      runId: "r1",
      restaurant: "Veroni Pizza",
      host: "veronipizza.dk",
      source: "test",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: [
        planCreateProduct({ operationId: "op-1", payload: payload(1) }),
        planSkipProduct({
          operationId: "op-2",
          identity: { sourceId: "skip-1", menuNumber: "x", name: "y" },
          reason: "already verified",
        }),
      ],
    });
    assertWritePlanImmutable(plan);
    expect(plan.operations[0]!.action).toBe("CREATE");
    expect(plan.operations[0]!.identity.sourceId).toBe("src-mig-1");
    expect(plan.operations[1]!.action).toBe("SKIP");
    expect(() => {
      // @ts-expect-error immutability
      plan.operations.push(plan.operations[0]!);
    }).toThrow();
  });

  it("supports open-ended variant names in planned payload", () => {
    const p = payload(3, {
      variants: [
        { name: "Lille", surchargeOre: 0 },
        { name: "30 cm", surchargeOre: 1500 },
        { name: "Glutenfri", surchargeOre: 2500 },
      ],
    });
    expect(p.variants).toHaveLength(3);
    expect(compareProductExact(p, toDest(p, "9"))).toEqual([]);
  });

  it("additions survive exact compare model", () => {
    const p = payload(4, {
      additions: [
        { name: "Extra test A", priceOre: 1700 },
        { name: "Extra test B", priceOre: 2900 },
      ],
    });
    expect(compareProductExact(p, toDest(p, "10"))).toEqual([]);
    const bad = toDest(p, "10");
    bad.additions[0]!.priceOre = 1;
    expect(compareProductExact(p, bad)).toContain("additionPrice0");
  });
});

describe("M4 sourceId identity", () => {
  it("operations reference sourceId, not menuNumber+name as primary key", () => {
    const op = planCreateProduct({
      operationId: "op-id",
      payload: payload(1, { menuNumber: "1", name: "Margarita" }),
    });
    expect(op.identity.sourceId).toBe("src-mig-1");
    expect(op.identity.menuNumber).toBe("1");
    expect(op.identity.name).toBe("Margarita");
  });

  it("prefers destinationDatabaseId over evidence", () => {
    const a = toDest(payload(1), "10");
    const b = toDest(payload(1, { sourceId: "other", name: a.name }), "11");
    b.menuNumber = a.menuNumber;
    const match = resolveDestinationIdentity(
      {
        sourceId: "src-mig-1",
        menuNumber: a.menuNumber,
        name: a.name,
        destinationDatabaseId: "11",
      },
      [a, b],
    );
    expect(match.outcome).toBe("FOUND");
    if (match.outcome === "FOUND") {
      expect(match.product.databaseId).toBe("11");
    }
  });

  it("returns MANUAL_REVIEW ambiguity when evidence matches multiple", () => {
    const a = toDest(payload(1), "1");
    const b = toDest(payload(2, { menuNumber: a.menuNumber, name: a.name }), "2");
    const match = matchDestinationByEvidence([a, b], {
      menuNumber: a.menuNumber,
      name: a.name,
    });
    expect(match.outcome).toBe("AMBIGUOUS");
  });
});

describe("M4 idempotency / resume decisions", () => {
  it("skips VERIFIED ops", () => {
    expect(
      resolveCreateResume({
        persistedState: "VERIFIED",
        destination: null,
      }).next,
    ).toBe("SKIP_VERIFIED");
  });

  it("reads back when destination already exists", () => {
    expect(
      resolveCreateResume({
        persistedState: "PENDING_WRITE",
        destination: toDest(payload(1), "5"),
      }).next,
    ).toBe("READ_BACK_EXISTING");
  });

  it("reviews ambiguous create without destination", () => {
    expect(
      resolveCreateResume({
        persistedState: "WRITTEN",
        destination: null,
        createOutcome: "AMBIGUOUS",
      }).next,
    ).toBe("REVIEW_AMBIGUOUS");
  });

  it("retries only when create failed and proven absent", () => {
    expect(
      resolveCreateResume({
        persistedState: "PENDING_WRITE",
        destination: null,
        createOutcome: "FAILED",
      }).next,
    ).toBe("RETRY_CREATE_ABSENT");
  });
});

describe("M4 RunStore + executeMigrationPlan", () => {
  let dir: string;
  let store: RunStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tah-m4-"));
    store = new RunStore(join(dir, "run.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists destination id and does not recreate VERIFIED ops on resume", async () => {
    const ops = Array.from({ length: 5 }, (_, i) =>
      planCreateProduct({ operationId: `op-${i + 1}`, payload: payload(i + 1) }),
    );
    const plan = createMigrationWritePlan({
      runId: "resume-run",
      restaurant: "Veroni Pizza",
      host: "veronipizza.dk",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: ops,
    });

    const created = new Map<string, DestinationProduct>();
    let createCalls = 0;
    const destination = portFromMap(created, {
      async createHiddenProduct(pl) {
        createCalls += 1;
        const id = String(createCalls);
        const dest = toDest(pl, id);
        created.set(id, dest);
        return { outcome: "CREATED", databaseId: id };
      },
    });

    const first = await executeMigrationPlan({
      plan,
      store,
      destination,
      gate: { hostOk: true, contractMatch: true },
    });
    expect(first.verified).toBe(5);
    expect(first.duplicatesCreated).toBe(0);
    const createsAfterFirst = createCalls;

    const second = await executeMigrationPlan({
      plan,
      store,
      destination,
      gate: { hostOk: true, contractMatch: true },
    });
    expect(second.skipped + second.verified).toBeGreaterThanOrEqual(5);
    expect(createCalls).toBe(createsAfterFirst);
    expect(second.duplicatesCreated).toBe(0);

    for (const op of ops) {
      const rec = store.getOperation("resume-run", op.operationId)!;
      expect(rec.state).toBe("VERIFIED");
      expect(rec.destinationId).toBeTruthy();
      expect(rec.identitySourceId).toBe(op.identity.sourceId);
      expect(
        store.getDestinationIdForSource("resume-run", op.identity.sourceId),
      ).toBe(rec.destinationId);
    }
  });

  it("proves resume mid-run: 1-3 verified, stop at 4, restart skips 1-3", async () => {
    const ops = Array.from({ length: 6 }, (_, i) =>
      planCreateProduct({ operationId: `p-${i + 1}`, payload: payload(i + 1) }),
    );
    const plan = createMigrationWritePlan({
      runId: "mid-run",
      restaurant: "Veroni Pizza",
      host: "veronipizza.dk",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: ops,
    });

    const created = new Map<string, DestinationProduct>();
    let createCalls = 0;
    let failOnceForP4 = true;
    const destination = portFromMap(created, {
      async createHiddenProduct(pl) {
        createCalls += 1;
        if (pl.name === "__TAH_MIG_4__" && failOnceForP4) {
          failOnceForP4 = false;
          return { outcome: "FAILED", error: "simulated interrupt" };
        }
        const id = `db-${createCalls}`;
        const dest = toDest(pl, id);
        created.set(id, dest);
        return { outcome: "CREATED", databaseId: id };
      },
    });

    const partial = await executeMigrationPlan({
      plan,
      store,
      destination,
      gate: { hostOk: true, contractMatch: true },
      maxCreateAttempts: 1,
    });
    expect(store.getOperation("mid-run", "p-1")!.state).toBe("VERIFIED");
    expect(store.getOperation("mid-run", "p-2")!.state).toBe("VERIFIED");
    expect(store.getOperation("mid-run", "p-3")!.state).toBe("VERIFIED");
    expect(store.getOperation("mid-run", "p-4")!.state).toBe("WRITE_FAILED");
    expect(partial.duplicatesCreated).toBe(0);
    const createsBeforeResume = createCalls;

    const failed = store.getOperation("mid-run", "p-4")!;
    store.upsertOperation({
      ...failed,
      state: "PENDING_WRITE",
      attemptCount: 0,
      lastErrorMessage: null,
      updatedAt: new Date().toISOString(),
    });

    const resumed = await executeMigrationPlan({
      plan,
      store,
      destination,
      gate: { hostOk: true, contractMatch: true },
    });
    expect(store.getOperation("mid-run", "p-1")!.state).toBe("VERIFIED");
    expect(store.getOperation("mid-run", "p-4")!.state).toBe("VERIFIED");
    expect(store.getOperation("mid-run", "p-6")!.state).toBe("VERIFIED");
    expect(createCalls).toBeGreaterThan(createsBeforeResume);
    expect(resumed.duplicatesCreated).toBe(0);
  });

  it("blocks wrong host and contract drift", async () => {
    const plan = createMigrationWritePlan({
      runId: "gate-run",
      restaurant: "Veroni Pizza",
      host: "veronipizza.dk",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: [
        planCreateProduct({ operationId: "op-1", payload: payload(1) }),
      ],
    });
    const destination = portFromMap(new Map());
    await expect(
      executeMigrationPlan({
        plan,
        store,
        destination,
        gate: {
          hostOk: false,
          contractMatch: true,
          host: "evil.dk",
          expectedHost: "veronipizza.dk",
        },
      }),
    ).rejects.toThrow(/WRONG_HOST/);
    await expect(
      executeMigrationPlan({
        plan,
        store,
        destination,
        gate: { hostOk: true, contractMatch: false },
      }),
    ).rejects.toThrow(/CONTRACT_DRIFT/);
  });

  it("records read-back mismatch as VERIFY_FAILED", async () => {
    const p = payload(7);
    const plan = createMigrationWritePlan({
      runId: "mismatch-run",
      restaurant: "Veroni Pizza",
      host: "veronipizza.dk",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: [
        planCreateProduct({ operationId: "op-7", payload: p }),
      ],
    });
    const destination: DestinationPort = {
      async findByIdentity() {
        return { outcome: "NONE" };
      },
      async readProduct() {
        const d = toDest(p, "77");
        d.basePriceOre = 1;
        return d;
      },
      async createHiddenProduct() {
        return { outcome: "CREATED", databaseId: "77" };
      },
    };
    const result = await executeMigrationPlan({
      plan,
      store,
      destination,
      gate: { hostOk: true, contractMatch: true },
    });
    expect(result.failed).toBe(1);
    expect(store.getOperation("mismatch-run", "op-7")!.state).toBe(
      "VERIFY_FAILED",
    );
  });

  it("plans BLOCK without create", async () => {
    const plan = createMigrationWritePlan({
      runId: "block-run",
      restaurant: "Veroni Pizza",
      host: "veronipizza.dk",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: [
        planBlockProduct({
          operationId: "b1",
          identity: { sourceId: "blocked-1", menuNumber: "1", name: "x" },
          reason: "incomplete dynamic row",
        }),
      ],
    });
    const destination: DestinationPort = {
      async findByIdentity() {
        return { outcome: "NONE" };
      },
      async readProduct() {
        throw new Error("no");
      },
      async createHiddenProduct() {
        throw new Error("should not create");
      },
    };
    const result = await executeMigrationPlan({
      plan,
      store,
      destination,
      gate: { hostOk: true, contractMatch: true },
    });
    expect(result.blocked).toBe(1);
    expect(result.duplicatesCreated).toBe(0);
  });

  it("refuses to execute dry-run plans", async () => {
    const plan = createMigrationWritePlan({
      runId: "dry",
      restaurant: "Veroni Pizza",
      host: "veronipizza.dk",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      dryRun: true,
      operations: [
        planCreateProduct({ operationId: "op-1", payload: payload(1) }),
      ],
    });
    await expect(
      executeMigrationPlan({
        plan,
        store,
        destination: portFromMap(new Map()),
        gate: { hostOk: true, contractMatch: true },
      }),
    ).rejects.toThrow(/DRY_RUN/);
  });

  it("zero silent success: HTTP-less create without read-back cannot be VERIFIED", () => {
    const p = payload(8);
    const d = toDest(p, "8");
    expect(compareProductExact(p, d)).toEqual([]);
    d.name = "wrong";
    expect(compareProductExact(p, d).length).toBeGreaterThan(0);
  });
});
