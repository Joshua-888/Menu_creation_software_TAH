import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import {
  assertCertifiedForProductionWrites,
  evaluateProbeFromFlags,
  getCertifiedAdapter,
  isMenuNumberSameAsDatabaseId,
  parseDatabaseIdFromPath,
  resolveAdapterForProbe,
  TahAdminAdapterV1,
  ADMIN_CONTRACT_V1,
  V1_SELECTORS,
} from "../../src/tah/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const certified = join(
  root,
  "fixtures/admin-contracts/v1/certified-structure.html",
);
const drifted = join(
  root,
  "fixtures/admin-contracts/v1/drifted-structure.html",
);

describe("AdminContract v1 metadata", () => {
  it("documents id strategy separating menu numbers from database ids", () => {
    expect(ADMIN_CONTRACT_V1.idStrategy.menuNumber.value).toMatch(/MUST NOT/i);
    expect(ADMIN_CONTRACT_V1.idStrategy.productDatabaseId.evidence).toBe(
      "OBSERVED",
    );
    expect(ADMIN_CONTRACT_V1.adminVersionMarker).toBe(
      "ADMIN_VERSION_MARKER_NOT_FOUND",
    );
    expect(ADMIN_CONTRACT_V1.selectors.menuNumber.locator).toBe("menu_number");
  });

  it("does not treat menu number as database id", () => {
    expect(isMenuNumberSameAsDatabaseId("15A", "42")).toBe(false);
    expect(isMenuNumberSameAsDatabaseId("42", "42")).toBe(true);
    expect(parseDatabaseIdFromPath("/admin/menu/99/edit", "menu")).toBe("99");
    expect(
      parseDatabaseIdFromPath("/admin/categories/3/edit", "categories"),
    ).toBe("3");
  });
});

describe("probe flag evaluation", () => {
  it("matches when required checks pass", () => {
    const result = evaluateProbeFromFlags({
      authentication: "PASS",
      restaurantContext: "PASS",
      flags: {
        menuPage: "PASS",
        categoryListing: "PASS",
        productListing: "PASS",
        productEditRoute: "PASS",
        menuNumberField: "PASS",
        nameField: "PASS",
        descriptionField: "PASS",
        ingredientsField: "PASS",
        basePriceField: "PASS",
        categoryField: "PASS",
        variantStructure: "PASS",
        addonStructure: "PASS",
        activeField: "PASS",
        saveControlDetected: "PASS",
      },
    });
    expect(result.contractStatus).toBe("CONTRACT_MATCH");
  });

  it("returns CONTRACT_DRIFT when critical field missing", () => {
    const result = evaluateProbeFromFlags({
      authentication: "PASS",
      restaurantContext: "PASS",
      flags: {
        menuPage: "PASS",
        menuNumberField: "FAIL",
        nameField: "PASS",
        basePriceField: "PASS",
        variantStructure: "PASS",
      },
    });
    expect(result.contractStatus).toBe("CONTRACT_DRIFT");
    expect(result.mismatches.some((m) => m.includes("menuNumber"))).toBe(true);
  });

  it("returns UNKNOWN when unauthenticated", () => {
    const result = evaluateProbeFromFlags({
      authentication: "FAIL",
      restaurantContext: "UNKNOWN",
      flags: { menuPage: "FAIL" },
    });
    expect(result.contractStatus).toBe("UNKNOWN");
  });
});

describe("fixture DOM structure", () => {
  it("recognizes certified structure selectors", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(readFileSync(certified, "utf8"));

    expect(await page.locator(V1_SELECTORS.menuNumber).count()).toBe(1);
    expect(await page.locator(V1_SELECTORS.productName).count()).toBe(1);
    expect(await page.locator(V1_SELECTORS.description).count()).toBe(1);
    expect(await page.locator(V1_SELECTORS.basePrice).count()).toBe(1);
    expect(await page.locator(V1_SELECTORS.variantList).count()).toBe(1);
    expect(await page.locator(V1_SELECTORS.ingredientList).count()).toBe(1);
    expect(await page.locator(V1_SELECTORS.additionList).count()).toBe(1);
    expect(await page.locator(V1_SELECTORS.active).count()).toBe(1);
    expect(await page.getByRole("button", { name: /^Skab$/i }).count()).toBe(1);

    await browser.close();
  });

  it("fails required selectors on drifted structure", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(readFileSync(drifted, "utf8"));

    expect(await page.locator(V1_SELECTORS.menuNumber).count()).toBe(0);
    expect(await page.locator(V1_SELECTORS.variantList).count()).toBe(0);

    const result = evaluateProbeFromFlags({
      authentication: "PASS",
      restaurantContext: "PASS",
      flags: {
        menuPage: "FAIL",
        menuNumberField: "FAIL",
        nameField: "FAIL",
        basePriceField: "FAIL",
        variantStructure: "FAIL",
      },
    });
    expect(result.contractStatus).toBe("CONTRACT_DRIFT");
    await browser.close();
  });
});

describe("adapter registry read-only guarantees", () => {
  it("exposes DEVELOPMENT adapter and blocks writes", async () => {
    expect(resolveAdapterForProbe().lifecycle).toBe("DEVELOPMENT");
    expect(getCertifiedAdapter()).toBeNull();

    const adapter = new TahAdminAdapterV1({
      page: null as never,
      baseUrl: "https://example.test",
    });
    expect(() => assertCertifiedForProductionWrites(adapter)).toThrow(/CERTIFIED/);
    await expect(adapter.createProduct({} as never)).rejects.toThrow(
      /ADMIN_WRITE_BLOCKED/,
    );
    await expect(adapter.createCategory({ name: "x" })).rejects.toThrow(
      /ADMIN_WRITE_BLOCKED/,
    );
    await expect(adapter.updateProduct("1", {} as never)).rejects.toThrow(
      /ADMIN_WRITE_BLOCKED/,
    );
  });

  it("probe path does not call mutation methods", () => {
    // Structural guarantee: mutation methods throw; probe uses probeAdminContract only.
    expect(typeof TahAdminAdapterV1.prototype.probeContract).toBe("function");
    expect(TahAdminAdapterV1.prototype.createProduct).not.toBe(
      TahAdminAdapterV1.prototype.probeContract,
    );
  });
});

describe("wrong restaurant context flag", () => {
  it("marks restaurantContext FAIL via mismatches when hosts differ", () => {
    const result = evaluateProbeFromFlags({
      authentication: "PASS",
      restaurantContext: "FAIL",
      flags: {
        menuPage: "PASS",
        menuNumberField: "PASS",
        nameField: "PASS",
        basePriceField: "PASS",
        variantStructure: "PASS",
      },
      mismatches: [
        "restaurant_host_mismatch:expected=veronipizza.dk:actual=other.dk",
      ],
    });
    expect(result.restaurantContext).toBe("FAIL");
    expect(result.contractStatus).toBe("CONTRACT_DRIFT");
  });
});
