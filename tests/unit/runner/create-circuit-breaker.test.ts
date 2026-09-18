import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStore } from "../../../src/runs/sqliteStore.js";
import {
  CIRCUIT_BREAKER_REASON,
  NOT_ATTEMPTED_SYSTEMIC_BLOCK,
  createMigrationWritePlan,
  executeMigrationPlan,
  orderOperationsForMinimizedCategoryExposure,
  planCreateCategory,
  planCreateProduct,
  type DestinationPort,
  type DestinationProduct,
  type PlannedProductPayload,
} from "../../../src/runner/index.js";

function payload(index: number, categoryId: string): PlannedProductPayload {
  return {
    sourceId: `product-${index}`,
    menuNumber: String(index),
    name: `Product ${index}`,
    description: "Tomat og ost",
    basePriceOre: 7500,
    categoryIds: [categoryId],
    variants: [{ name: "Alm.", surchargeOre: 0 }],
    ingredients: ["Tomat"],
    additions: [],
    intendedHidden: true,
  };
}

const HTTP_500_CREATE_ERROR =
  "CREATE_RESPONSE_ERROR status=500 class=TAH_SERVER_EXCEPTION body=oops_internal_server_error signature=CREATE_PRODUCT|POST /admin/menu|500|oops_internal_server_error|unknown";

describe("deterministic CREATE circuit breaker", () => {
  let directory: string;
  let store: RunStore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "create-circuit-"));
    store = new RunStore(join(directory, "runs.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("stops remaining products and later public category creates after one HTTP 500", async () => {
    const products = new Map<string, DestinationProduct>();
    const categories: Array<{ databaseId: string; name: string }> = [];
    let productCreates = 0;
    let categoryCreates = 0;
    const destination: DestinationPort = {
      async findByIdentity() {
        return { outcome: "NONE" };
      },
      async readProduct(databaseId) {
        return products.get(databaseId)!;
      },
      async createHiddenProduct() {
        productCreates += 1;
        return {
          outcome: "FAILED",
          error: HTTP_500_CREATE_ERROR,
        };
      },
      async createCategory(input) {
        categoryCreates += 1;
        const id = String(categoryCreates);
        categories.push({ databaseId: id, name: input.name });
        return { outcome: "CREATED", databaseId: id };
      },
      async listCategories() {
        return categories;
      },
    };

    const plan = createMigrationWritePlan({
      runId: "circuit-500",
      restaurant: "Fixture",
      host: "fixture.test",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: [
        planCreateCategory({
          operationId: "cat-a",
          sourceId: "cat-a",
          name: "Burgers",
        }),
        planCreateProduct({
          operationId: "p-1",
          payload: payload(1, "__resolve__:Burgers"),
        }),
        planCreateProduct({
          operationId: "p-2",
          payload: payload(2, "__resolve__:Burgers"),
        }),
        planCreateCategory({
          operationId: "cat-b",
          sourceId: "cat-b",
          name: "Durum",
        }),
        planCreateProduct({
          operationId: "p-3",
          payload: payload(20, "__resolve__:Durum"),
        }),
      ],
    });

    const result = await executeMigrationPlan({
      plan,
      store,
      destination,
      workflow: "CREATE_MENU",
      maxCreateAttempts: 2,
      gate: { hostOk: true, contractMatch: true },
    });

    expect(result.circuitBreakerTripped).toBe(true);
    expect(productCreates).toBe(1);
    expect(categoryCreates).toBe(1);
    expect(store.getOperation(plan.runId, "p-1")?.state).toBe("WRITE_FAILED");
    expect(store.getOperation(plan.runId, "p-2")?.state).toBe("BLOCKED");
    expect(store.getOperation(plan.runId, "cat-b")?.state).toBe("BLOCKED");
    expect(store.getOperation(plan.runId, "p-3")?.state).toBe("BLOCKED");
    expect(store.getOperation(plan.runId, "p-2")?.lastErrorMessage).toContain(
      CIRCUIT_BREAKER_REASON,
    );
    expect(store.getOperation(plan.runId, "p-2")?.lastErrorMessage).toContain(
      NOT_ATTEMPTED_SYSTEMIC_BLOCK,
    );
    expect(store.getOperation(plan.runId, "p-2")?.state).toBe("BLOCKED");
    expect(store.getOperation(plan.runId, "cat-b")?.lastErrorMessage).toContain(
      NOT_ATTEMPTED_SYSTEMIC_BLOCK,
    );
    expect(result.createMenuSuccess).toBe(false);
    expect(result.recoveryRequired).toBe(true);
  });

  it("reorders all-categories-first plans so later public categories are not created after the first 500", async () => {
    const attemptedProductIds: string[] = [];
    const createdCategoryNames: string[] = [];
    const destination: DestinationPort = {
      async findByIdentity() {
        return { outcome: "NONE" };
      },
      async readProduct() {
        throw new Error("absent on readback");
      },
      async createHiddenProduct(input) {
        attemptedProductIds.push(input.sourceId);
        return { outcome: "FAILED", error: HTTP_500_CREATE_ERROR };
      },
      async createCategory(input) {
        createdCategoryNames.push(input.name);
        return {
          outcome: "CREATED",
          databaseId: String(createdCategoryNames.length),
        };
      },
      async listCategories() {
        return createdCategoryNames.map((name, index) => ({
          databaseId: String(index + 1),
          name,
        }));
      },
    };

    const unordered = [
      planCreateCategory({
        operationId: "cat-a",
        sourceId: "cat-a",
        name: "Burgers",
      }),
      planCreateCategory({
        operationId: "cat-b",
        sourceId: "cat-b",
        name: "Durum",
      }),
      planCreateProduct({
        operationId: "p-1",
        payload: payload(1, "__resolve__:Burgers"),
      }),
      planCreateProduct({
        operationId: "p-2",
        payload: payload(2, "__resolve__:Burgers"),
      }),
      planCreateProduct({
        operationId: "p-3",
        payload: payload(20, "__resolve__:Durum"),
      }),
    ];
    const ordered = orderOperationsForMinimizedCategoryExposure(unordered);
    expect(ordered.map((op) => op.operationId)).toEqual([
      "cat-a",
      "p-1",
      "p-2",
      "cat-b",
      "p-3",
    ]);

    const plan = createMigrationWritePlan({
      runId: "circuit-500-all-cats-first",
      restaurant: "Fixture",
      host: "fixture.test",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: unordered,
    });
    expect(plan.operations.map((op) => op.operationId)).toEqual([
      "cat-a",
      "p-1",
      "p-2",
      "cat-b",
      "p-3",
    ]);

    const result = await executeMigrationPlan({
      plan,
      store,
      destination,
      workflow: "CREATE_MENU",
      maxCreateAttempts: 2,
      gate: { hostOk: true, contractMatch: true },
    });

    expect(result.circuitBreakerTripped).toBe(true);
    expect(attemptedProductIds).toEqual(["product-1"]);
    expect(createdCategoryNames).toEqual(["Burgers"]);
    expect(store.getOperation(plan.runId, "p-1")?.state).toBe("WRITE_FAILED");
    expect(store.getOperation(plan.runId, "p-2")?.state).toBe("BLOCKED");
    expect(store.getOperation(plan.runId, "cat-b")?.state).toBe("BLOCKED");
    expect(store.getOperation(plan.runId, "p-3")?.state).toBe("BLOCKED");
    expect(store.getOperation(plan.runId, "p-2")?.lastErrorMessage).toContain(
      NOT_ATTEMPTED_SYSTEMIC_BLOCK,
    );
  });

  it("does not trip on retryable session failures", async () => {
    let productCreates = 0;
    const destination: DestinationPort = {
      async findByIdentity() {
        return { outcome: "NONE" };
      },
      async readProduct() {
        throw new Error("not created");
      },
      async createHiddenProduct() {
        productCreates += 1;
        return {
          outcome: "FAILED",
          error: "CREATE_RESPONSE_ERROR status=419 class=SESSION_OR_CSRF_FAILURE body=csrf_or_page_expired signature=CREATE_PRODUCT|POST /admin/menu|419|csrf_or_page_expired|csrf",
        };
      },
      async createCategory() {
        return { outcome: "CREATED", databaseId: "1" };
      },
      async listCategories() {
        return [{ databaseId: "1", name: "Food" }];
      },
    };
    const plan = createMigrationWritePlan({
      runId: "circuit-419",
      restaurant: "Fixture",
      host: "fixture.test",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: [
        planCreateProduct({ operationId: "p-1", payload: payload(1, "1") }),
        planCreateProduct({ operationId: "p-2", payload: payload(2, "1") }),
      ],
    });
    await executeMigrationPlan({
      plan,
      store,
      destination,
      workflow: "CREATE_MENU",
      maxCreateAttempts: 1,
      gate: { hostOk: true, contractMatch: true },
    });
    expect(productCreates).toBe(2);
    expect(store.getOperation(plan.runId, "p-2")?.state).toBe("WRITE_FAILED");
  });
});
