import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStore } from "../../../src/runs/sqliteStore.js";
import {
  createMigrationWritePlan,
  planCreateCategory,
  planCreateProduct,
  type PlannedProductPayload,
} from "../../../src/runner/writePlan.js";
import {
  executeMigrationPlan,
  type DestinationPort,
  type DestinationProduct,
} from "../../../src/runner/executor.js";

function payload(index: number): PlannedProductPayload {
  return {
    sourceId: `product-${index}`,
    menuNumber: String(index),
    name: `Product ${index}`,
    description: "Tomat og ost",
    basePriceOre: 7500,
    categoryIds: ["1"],
    variants: [{ name: "Alm.", surchargeOre: 0 }],
    ingredients: ["Tomat", "Ost"],
    additions: [],
    intendedHidden: true,
  };
}

function destinationProduct(
  value: PlannedProductPayload,
  databaseId: string,
): DestinationProduct {
  return {
    databaseId,
    menuNumber: value.menuNumber,
    name: value.name,
    description: value.description,
    basePriceOre: value.basePriceOre,
    categoryIds: value.categoryIds,
    variants: value.variants.map((variant) => ({
      name: variant.name,
      priceOre: variant.surchargeOre,
    })),
    ingredients: value.ingredients.map((name) => ({ name })),
    additions: [],
    listStatus: "Skjult",
    sourceId: value.sourceId,
  };
}

describe("CREATE_MENU menu-level success", () => {
  let directory: string;
  let store: RunStore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "create-partial-"));
    store = new RunStore(join(directory, "runs.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function execute(outcomes: Array<"ok" | "fail">) {
    const products = new Map<string, DestinationProduct>();
    let createIndex = 0;
    const destination: DestinationPort = {
      async findByIdentity(identity) {
        const hit = [...products.values()].find(
          (product) => product.sourceId === identity.sourceId,
        );
        return hit
          ? { outcome: "FOUND", product: hit }
          : { outcome: "NONE" };
      },
      async readProduct(databaseId) {
        return products.get(databaseId)!;
      },
      async createHiddenProduct(value) {
        const outcome = outcomes[createIndex++] ?? "fail";
        if (outcome === "fail") {
          return { outcome: "FAILED", error: "simulated create failure" };
        }
        const id = `db-${createIndex}`;
        products.set(id, destinationProduct(value, id));
        return { outcome: "CREATED", databaseId: id };
      },
      async createCategory() {
        return { outcome: "CREATED", databaseId: "1" };
      },
      async listCategories() {
        return [];
      },
    };
    const plan = createMigrationWritePlan({
      runId: `run-${outcomes.join("-")}`,
      restaurant: "Fixture",
      host: "fixture.test",
      source: "fixture",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      operations: [
        planCreateCategory({
          operationId: "category",
          sourceId: "category-1",
          name: "Food",
        }),
        ...outcomes.map((_, index) =>
          planCreateProduct({
            operationId: `product-${index + 1}`,
            payload: payload(index + 1),
          }),
        ),
      ],
    });
    return executeMigrationPlan({
      plan,
      store,
      destination,
      workflow: "CREATE_MENU",
      maxCreateAttempts: 1,
      gate: { hostOk: true, contractMatch: true },
    });
  }

  it("marks category success plus product failure as partial recovery", async () => {
    const result = await execute(["fail"]);
    expect(result.status).toBe("PARTIAL_WRITE");
    expect(result.recoveryRequired).toBe(true);
    expect(result.createMenuSuccess).toBe(false);
    expect(result.categoriesVerified).toBe(1);
    expect(result.productsVerified).toBe(0);
    expect(result.productsFailed).toBe(1);
    expect(result.status).not.toBe("COMPLETED");
  });

  it("marks first product success and second failure as partial", async () => {
    const result = await execute(["ok", "fail"]);
    expect(result.status).toBe("PARTIAL_WRITE");
    expect(result.productsVerified).toBe(1);
    expect(result.productsFailed).toBe(1);
    expect(result.createMenuSuccess).toBe(false);
    expect(result.recoveryRequired).toBe(true);
  });

  it("completes only when every planned product verifies", async () => {
    const result = await execute(["ok", "ok"]);
    expect(result.status).toBe("COMPLETED");
    expect(result.productsVerified).toBe(2);
    expect(result.createMenuSuccess).toBe(true);
    expect(result.menuVerified).toBe(true);
    expect(result.recoveryRequired).toBe(false);
  });
});
