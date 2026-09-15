import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluatePortalLiveWriteGate,
  isPortalLiveWritesEnabled,
} from "../../src/portal/liveWrites.js";
import {
  createMigrationWritePlan,
  executeMigrationPlan,
  type DestinationPort,
  type PlannedProductPayload,
  type ProductIdentityKey,
} from "../../src/runner/index.js";
import { RunStore } from "../../src/runs/sqliteStore.js";

describe("portal live write gate", () => {
  it("stays off without credentials; kill switch forces off", () => {
    expect(isPortalLiveWritesEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isPortalLiveWritesEnabled({
        TAH_ADMIN_EMAIL: "a@b.c",
        TAH_ADMIN_PASSWORD: "x",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isPortalLiveWritesEnabled({
        TAH_ADMIN_EMAIL: "a@b.c",
        TAH_ADMIN_PASSWORD: "x",
        PORTAL_LIVE_WRITES: "0",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isPortalLiveWritesEnabled({ PORTAL_LIVE_WRITES: "1" } as NodeJS.ProcessEnv),
    ).toBe(true);
    const gated = evaluatePortalLiveWriteGate({
      destinationHost: "https://veronipizza.dk",
      env: {},
    });
    expect(gated.canLiveExecute).toBe(false);
    expect(
      gated.blockers.some((b: string) => /TAH_ADMIN_/i.test(b)),
    ).toBe(true);
  });

  it("requires credentials even when PORTAL_LIVE_WRITES=1", () => {
    const gated = evaluatePortalLiveWriteGate({
      destinationHost: "veronipizza.dk",
      env: { PORTAL_LIVE_WRITES: "1" },
    });
    expect(gated.canLiveExecute).toBe(false);
    expect(
      gated.blockers.some((b: string) => /TAH_ADMIN_/i.test(b)),
    ).toBe(true);
  });

  it("requires allowlisted host even with credentials", () => {
    const gated = evaluatePortalLiveWriteGate({
      destinationHost: "https://other-shop.example",
      env: {
        TAH_ADMIN_EMAIL: "a@b.c",
        TAH_ADMIN_PASSWORD: "x",
      },
    });
    expect(gated.enabled).toBe(true);
    expect(gated.allowlisted).toBe(false);
    expect(gated.canLiveExecute).toBe(false);
  });

  it("opens when credentials + Veroni + createCategory CERTIFIED", () => {
    const gated = evaluatePortalLiveWriteGate({
      destinationHost: "veronipizza.dk",
      env: {
        TAH_ADMIN_EMAIL: "a@b.c",
        TAH_ADMIN_PASSWORD: "x",
      },
    });
    expect(gated.createCategoryCertified).toBe(true);
    expect(gated.canLiveExecute).toBe(true);
    expect(gated.blockers).toEqual([]);
  });

  it("opens for env-allowlisted merchant hosts", () => {
    const gated = evaluatePortalLiveWriteGate({
      destinationHost: "https://new-merchant.dk",
      env: {
        TAH_ADMIN_EMAIL: "a@b.c",
        TAH_ADMIN_PASSWORD: "x",
        PORTAL_LIVE_WRITE_HOSTS: "new-merchant.dk,second-merchant.dk",
      },
    });
    expect(gated.allowlisted).toBe(true);
    expect(gated.canLiveExecute).toBe(true);
  });
});

describe("executor DestinationPort createCategory", () => {
  let dir: string;
  let store: RunStore;

  afterEach(() => {
    store?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("refuses dry-run plans", async () => {
    dir = mkdtempSync(join(tmpdir(), "m67-exec-"));
    store = new RunStore(join(dir, "runs.sqlite"));
    const plan = createMigrationWritePlan({
      runId: "r1",
      restaurant: "V",
      host: "veronipizza.dk",
      source: "t",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "x",
      dryRun: true,
      operations: [],
    });
    const destination: DestinationPort = {
      async findByIdentity() {
        return { outcome: "NONE" };
      },
      async readProduct() {
        throw new Error("unused");
      },
      async createHiddenProduct() {
        return { outcome: "FAILED", error: "unused" };
      },
    };
    await expect(
      executeMigrationPlan({
        plan,
        store,
        destination,
        gate: { hostOk: true, contractMatch: true },
      }),
    ).rejects.toThrow(/DRY_RUN/);
  });

  it("creates category then resolves pending product category token", async () => {
    dir = mkdtempSync(join(tmpdir(), "m67-exec-"));
    store = new RunStore(join(dir, "runs.sqlite"));
    const cats = new Map<string, { databaseId: string; name: string }>();
    const products: Array<{
      databaseId: string;
      menuNumber: string;
      name: string;
      categoryIds: string[];
    }> = [];

    const destination: DestinationPort = {
      async listCategories() {
        return [...cats.values()];
      },
      async createCategory(input: {
        name: string;
        sourceId?: string;
        allowCustomerCategory?: boolean;
      }) {
        const id = String(cats.size + 1);
        cats.set(input.name.toLowerCase(), {
          databaseId: id,
          name: input.name,
        });
        return { outcome: "CREATED", databaseId: id };
      },
      async findByIdentity(identity: ProductIdentityKey) {
        const hit = products.find(
          (p) =>
            p.menuNumber === identity.menuNumber && p.name === identity.name,
        );
        return hit
          ? {
              outcome: "FOUND" as const,
              product: {
                databaseId: hit.databaseId,
                menuNumber: hit.menuNumber,
                name: hit.name,
                description: "",
                basePriceOre: 1000,
                categoryIds: hit.categoryIds,
                variants: [{ name: "Alm.", priceOre: 0 }],
                ingredients: [],
                additions: [],
                listStatus: "Skjult",
              },
            }
          : { outcome: "NONE" as const };
      },
      async readProduct(databaseId: string) {
        const hit = products.find((p) => p.databaseId === databaseId)!;
        return {
          databaseId,
          menuNumber: hit.menuNumber,
          name: hit.name,
          description: "d",
          basePriceOre: 1000,
          categoryIds: hit.categoryIds,
          variants: [{ name: "Alm.", priceOre: 0 }],
          ingredients: [],
          additions: [],
          listStatus: "Skjult",
        };
      },
      async createHiddenProduct(payload: PlannedProductPayload) {
        if (payload.categoryIds.some((c) => c.startsWith("__resolve__:"))) {
          return { outcome: "FAILED" as const, error: "unresolved category" };
        }
        const id = String(products.length + 100);
        products.push({
          databaseId: id,
          menuNumber: payload.menuNumber,
          name: payload.name,
          categoryIds: payload.categoryIds,
        });
        return { outcome: "CREATED" as const, databaseId: id };
      },
    };

    const plan = createMigrationWritePlan({
      runId: "r-cat",
      restaurant: "V",
      host: "veronipizza.dk",
      source: "t",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "x",
      dryRun: false,
      operations: [
        {
          operationId: "cat-1",
          entityType: "category",
          action: "CREATE",
          identity: { sourceId: "cat:pasta", name: "Pasta" },
          expectedPayload: null,
        },
        {
          operationId: "prod-1",
          entityType: "product",
          action: "CREATE",
          identity: {
            sourceId: "src:33",
            menuNumber: "33",
            name: "Spaghetti",
          },
          expectedPayload: {
            sourceId: "src:33",
            menuNumber: "33",
            name: "Spaghetti",
            description: "d",
            basePriceOre: 1000,
            categoryIds: ["__resolve__:Pasta"],
            variants: [{ name: "Alm.", surchargeOre: 0 }],
            ingredients: [],
            additions: [],
            intendedHidden: true,
          },
        },
      ],
    });

    const result = await executeMigrationPlan({
      plan,
      store,
      destination,
      gate: { hostOk: true, contractMatch: true },
    });
    expect(result.verified).toBe(2);
    expect(result.failed).toBe(0);
    expect(cats.get("pasta")?.name).toBe("Pasta");
    expect(products[0]?.categoryIds).toEqual(["1"]);
  });
});
