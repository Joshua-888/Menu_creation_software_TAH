import { describe, expect, it } from "vitest";
import { M2B_ADAPTER_CAPABILITIES } from "../../src/tah/contracts/evidence.js";
import {
  looksLikeCategoryHeaderName,
  recoverDishNameFromDescription,
  recoverProductLabelsForReconcile,
  diffProductReconcile,
} from "../../src/planning/menuReconcile.js";
import {
  buildDryRunWritePlan,
  type DryRunDestinationSnapshot,
} from "../../src/planning/dryRun.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import { tryNormalizeHost } from "../../src/portal/store.js";
import { isReconcileWriteConfirmed } from "../../src/portal/reconcileWriteGate.js";

describe("menuReconcile label recovery", () => {
  it("detects header-like pizza Alm/Fam names", () => {
    expect(looksLikeCategoryHeaderName("PIZZA Alm. Familie")).toBe(true);
    expect(looksLikeCategoryHeaderName("Margarita")).toBe(false);
  });

  it("recovers dish name from Beskrivelse", () => {
    expect(
      recoverDishNameFromDescription("Margarita 77, Tomat og ost"),
    ).toMatch(/margarita/i);
  });

  it("repairs header names using description", () => {
    const out = recoverProductLabelsForReconcile({
      name: "PIZZA Alm. Familie",
      description: "Margarita 77, Tomat, ost",
      ingredients: ["Tomat", "Ost"],
    });
    expect(out.reasons).toContain("NAME_HEADER_LIKE");
    expect(out.name.toLowerCase()).toContain("margarita");
  });
});

describe("tryNormalizeHost", () => {
  it("accepts bare hosts and rejects garbage", () => {
    expect(tryNormalizeHost("veronipizza.dk")).toBe("https://veronipizza.dk");
    expect(tryNormalizeHost("https://veronipizza.dk/admin")).toBe(
      "https://veronipizza.dk",
    );
    expect(tryNormalizeHost("not a host :::")).toBeNull();
    expect(tryNormalizeHost("")).toBeNull();
  });
});

describe("reconcile write gate", () => {
  it("always allows (confirm no longer required)", () => {
    expect(
      isReconcileWriteConfirmed({
        restaurantKey: "veronipizza.dk",
        fingerprint: "abc",
        env: {},
      }).ok,
    ).toBe(true);
    expect(
      isReconcileWriteConfirmed({
        restaurantKey: "veronipizza.dk",
        fingerprint: "zzz",
        env: {
          RECONCILE_WRITE_CONFIRMED: "1",
          RECONCILE_WRITE_FINGERPRINT: "abc",
        },
      }).ok,
    ).toBe(true);
  });
});

function tinyMenu(): CanonicalMenu {
  return {
    schemaVersion: "1",
    restaurant: { name: "Test", key: "veronipizza.dk" },
    restaurantName: "Test",
    domainRulesVersion: "1",
    currency: "DKK",
    status: "OK",
    issues: [],
    categories: [
      {
        sourceId: "cat-pizza",
        name: "Pizza",
        sortOrder: 1,
        status: "OK",
        products: [
          {
            sourceId: "p1",
            name: "Margarita",
            description: "Tomat, ost",
            status: "OK",
            sourceMenuNumber: "1",
            assignedMenuNumber: "1",
            basePrice: 7700,
            ingredients: [
              { display: "Tomat", origin: "SOURCE" },
              { display: "Ost", origin: "SOURCE" },
            ],
            variants: [{ name: "Alm.", surcharge: 0 }],
            addOns: [],
            choices: [],
          },
        ],
      },
    ],
  } as unknown as CanonicalMenu;
}

describe("dryRun FOUND reconcile vs create", () => {
  const destination: DryRunDestinationSnapshot = {
    host: "veronipizza.dk",
    categories: [{ databaseId: "10", name: "Pizza" }],
    products: [
      {
        databaseId: "99",
        menuNumber: "1",
        name: "PIZZA Alm. Familie",
        categoryIds: ["10"],
        description: "Margarita 77, Tomat, ost",
        basePriceOre: 7700,
        variants: [{ name: "Alm.", priceOre: 7700 }],
        ingredients: ["Tomat", "Ost"],
        additions: [],
      },
    ],
  };

  it("CREATE path BLOCKs FOUND products", () => {
    const plan = buildDryRunWritePlan({
      runId: "t1",
      restaurant: "veronipizza.dk",
      host: "veronipizza.dk",
      source: "test.pdf",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "test",
      contractFingerprint: "fp",
      canonical: tinyMenu(),
      categoryMappings: [
        {
          sourceCategoryId: "cat-pizza",
          sourceCategoryName: "Pizza",
          outcome: "EXACT_MATCH",
          destinationCategoryId: "10",
          destinationCategoryName: "Pizza",
          reason: "test",
        },
      ],
      destination: {
        ...destination,
        products: [
          {
            ...destination.products[0]!,
            name: "Margarita",
          },
        ],
      },
      capabilities: M2B_ADAPTER_CAPABILITIES,
    });
    const productOps = plan.operations.filter((o) => o.entityType === "product");
    expect(
      productOps.map((o) => `${o.action}:${o.reason ?? ""}`).join(" | "),
    ).toMatch(/BLOCK/);
    expect(productOps.some((o) => o.action === "UPDATE")).toBe(false);
  });

  it("QA path emits UPDATE for header-like FOUND names", () => {
    const reconcileDiffs: ReturnType<typeof diffProductReconcile>[] = [];
    const plan = buildDryRunWritePlan({
      runId: "t2",
      restaurant: "veronipizza.dk",
      host: "veronipizza.dk",
      source: "test.pdf",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "test",
      contractFingerprint: "fp",
      canonical: tinyMenu(),
      categoryMappings: [
        {
          sourceCategoryId: "cat-pizza",
          sourceCategoryName: "Pizza",
          outcome: "EXACT_MATCH",
          destinationCategoryId: "10",
          destinationCategoryName: "Pizza",
          reason: "test",
        },
      ],
      destination,
      capabilities: M2B_ADAPTER_CAPABILITIES,
      emitReconcileUpdates: true,
      reconcileDiffs,
    });
    const productOps = plan.operations.filter((o) => o.entityType === "product");
    expect(
      productOps.map((o) => `${o.action}:${o.reason ?? ""}`).join(" | "),
    ).toMatch(/UPDATE/);
    expect(reconcileDiffs.length).toBeGreaterThan(0);
    expect(reconcileDiffs[0]!.deltas.some((d) => d.field === "name")).toBe(
      true,
    );
  });

  it("QA path emits UPDATE for missing variants and additions", () => {
    const reconcileDiffs: ReturnType<typeof diffProductReconcile>[] = [];
    const plan = buildDryRunWritePlan({
      runId: "t3",
      restaurant: "veronipizza.dk",
      host: "veronipizza.dk",
      source: "test.pdf",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "test",
      contractFingerprint: "fp",
      canonical: tinyMenu(),
      categoryMappings: [
        {
          sourceCategoryId: "cat-pizza",
          sourceCategoryName: "Pizza",
          outcome: "EXACT_MATCH",
          destinationCategoryId: "10",
          destinationCategoryName: "Pizza",
          reason: "test",
        },
      ],
      destination: {
        ...destination,
        products: [
          {
            ...destination.products[0]!,
            name: "Margarita",
            description: "Tomat, ost",
            variants: [{ name: "Alm.", priceOre: 7700 }],
            ingredients: ["Tomat", "Ost"],
            additions: [],
          },
        ],
      },
      capabilities: M2B_ADAPTER_CAPABILITIES,
      emitReconcileUpdates: true,
      reconcileDiffs,
    });
    const productOps = plan.operations.filter((o) => o.entityType === "product");
    expect(productOps.some((o) => o.action === "UPDATE")).toBe(true);
    expect(
      productOps.map((o) => o.reason ?? "").join(" | "),
    ).not.toMatch(/portalOpdaterAdditionsVariantsPrice|deferred/);
    const fields = new Set(
      reconcileDiffs.flatMap((d) => d.deltas.map((x) => x.field)),
    );
    expect(fields.has("variants") || fields.has("additions")).toBe(true);
  });
});
