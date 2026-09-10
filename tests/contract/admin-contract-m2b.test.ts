import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import {
  ADMIN_CONTRACT_V1,
  assertNoWriteCapabilitiesCertified,
  finalVariantPriceOre,
  isMenuNumberSameAsDatabaseId,
  isMilestone3WriteReady,
  parseAdminPriceToOre,
  parseDatabaseIdFromPath,
  TahAdminAdapterV1,
  V1_ROUTES,
  V1_SELECTORS,
} from "../../src/tah/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const listFixture = join(
  root,
  "fixtures/admin-contracts/v1/product-list-structure.html",
);
const editFixture = join(
  root,
  "fixtures/admin-contracts/v1/edit-structure.html",
);
const evidence = JSON.parse(
  readFileSync(
    join(root, "fixtures/admin-contracts/v1/m2b-semantics-evidence.json"),
    "utf8",
  ),
) as {
  adminLogin: string;
  idEvidence: Array<{
    menuNumber: string;
    databaseId: string;
    editRoute: string;
  }>;
  variantPriceSemantics: { value: string; evidence: string; cases: unknown[] };
};

describe("M2B AdminContract evidence levels", () => {
  it("marks variant price semantics SURCHARGE as TESTED", () => {
    expect(ADMIN_CONTRACT_V1.semantics.variantPriceSemantics.value).toBe(
      "SURCHARGE",
    );
    expect(ADMIN_CONTRACT_V1.semantics.variantPriceSemantics.evidence).toBe(
      "TESTED",
    );
    expect(ADMIN_CONTRACT_V1.semantics.basePriceSemantics.value).toBe(
      "DEFAULT_BASE_PRODUCT_PRICE",
    );
  });

  it("documents NEW WAY login route and observed edit route", () => {
    expect(V1_ROUTES.login).toBe("/login");
    expect(evidence.adminLogin).toBe("https://newwaypizzaringsted.dk/login");
    expect(ADMIN_CONTRACT_V1.routes.menuEditPattern.value).toBe(
      "/admin/menu/{databaseId}/edit",
    );
    expect(ADMIN_CONTRACT_V1.routes.menuEditPattern.evidence).toBe("OBSERVED");
  });

  it("separates READ CERTIFIED from broad WRITE UNCERTIFIED (M3H/M3 create narrow caps CERTIFIED)", () => {
    const caps = ADMIN_CONTRACT_V1.capabilities;
    expect(caps.read.readProduct).toBe("CERTIFIED");
    expect(caps.read.listProducts).toBe("CERTIFIED");
    expect(caps.write.createProduct).toBe("CERTIFIED");
    expect(caps.write.createHiddenProduct).toBe("CERTIFIED");
    expect(caps.write.writeAdditions).toBe("CERTIFIED");
    expect(caps.write.updateProduct).toBe("UNCERTIFIED");
    expect(caps.write.updateExistingProductForm).toBe("CERTIFIED");
    expect(caps.write.createCategory).toBe("UNCERTIFIED");
    expect(caps.write.setProductHidden).toBe("UNCERTIFIED");
    expect(caps.write.setProductAvailable).toBe("UNCERTIFIED");
    expect(() => assertNoWriteCapabilitiesCertified(caps)).not.toThrow();
    expect(
      isMilestone3WriteReady({
        variantPriceSemantics:
          ADMIN_CONTRACT_V1.semantics.variantPriceSemantics.value,
        capabilities: caps,
      }),
    ).toBe(true);
  });
});

describe("M2B database ID vs menu number", () => {
  it("extracts database IDs from edit routes only", () => {
    for (const row of evidence.idEvidence) {
      expect(parseDatabaseIdFromPath(row.editRoute, "menu")).toBe(
        row.databaseId,
      );
      expect(isMenuNumberSameAsDatabaseId(row.menuNumber, row.databaseId)).toBe(
        row.menuNumber === row.databaseId,
      );
    }
    expect(isMenuNumberSameAsDatabaseId("45A", "4")).toBe(false);
    expect(isMenuNumberSameAsDatabaseId("20", "12")).toBe(false);
    expect(isMenuNumberSameAsDatabaseId("0", "1")).toBe(false);
  });
});

describe("M2B variant surcharge equations", () => {
  it("proves public list matches base+Alm(0) and rejects absolute 0", () => {
    const baseOre = parseAdminPriceToOre("99")!;
    const almOre = parseAdminPriceToOre("0")!;
    expect(
      finalVariantPriceOre(baseOre, almOre, "SURCHARGE"),
    ).toBe(9900);
    expect(finalVariantPriceOre(baseOre, almOre, "ABSOLUTE_TOTAL")).toBe(0);
    expect(finalVariantPriceOre(baseOre, almOre, "UNKNOWN")).toBeNull();

    const deep = parseAdminPriceToOre("20")!;
    expect(finalVariantPriceOre(baseOre, deep, "SURCHARGE")).toBe(11900);

    expect(evidence.variantPriceSemantics.value).toBe("SURCHARGE");
    expect(evidence.variantPriceSemantics.evidence).toBe("TESTED");
  });

  it("normalizes admin prices to øre", () => {
    expect(parseAdminPriceToOre("99")).toBe(9900);
    expect(parseAdminPriceToOre("99,00")).toBe(9900);
    expect(parseAdminPriceToOre("99.00")).toBe(9900);
    expect(parseAdminPriceToOre("")).toBeNull();
  });
});

describe("M2B product list parsing", () => {
  it(
    "parses list rows and never treats menu number as database id",
    async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(readFileSync(listFixture, "utf8"));

    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: "https://example.test",
    });
    // listProducts navigates — stub via evaluate path by overriding goto
    await page.route("**/admin/menu", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: readFileSync(listFixture, "utf8"),
      });
    });
    const products = await adapter.listProducts();
    expect(products).toHaveLength(3);
    expect(products[0]).toMatchObject({
      menuNumber: "0",
      databaseId: "1",
      name: "Sample Bread",
      editPath: "/admin/menu/1/edit",
      showPath: "/admin/menu/1",
    });
    expect(products[1]).toMatchObject({
      menuNumber: "45A",
      databaseId: "4",
      name: "Alpha Product",
    });
    expect(products[2]).toMatchObject({
      menuNumber: "20",
      databaseId: "12",
    });
    expect(products[0]!.menuNumber).not.toBe(products[0]!.databaseId);
    await browser.close();
  },
  30_000,
);
});

describe("M2B readProduct edit-form isolation", () => {
  it(
    "reads update form fields and ignores delete form",
    async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route("**/admin/menu", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/admin/menu" || path === "/admin/menu/") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: readFileSync(listFixture, "utf8"),
        });
        return;
      }
      await route.continue();
    });
    await page.route("**/admin/menu/1/edit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: readFileSync(editFixture, "utf8"),
      });
    });

    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: "https://newwaypizzaringsted.dk",
    });
    const product = await adapter.readProduct("1");

    expect(product.databaseId).toBe("1");
    expect(product.menuNumber).toBe("0");
    expect(product.name).toBe("Sample Bread");
    expect(product.basePriceOre).toBe(9900);
    expect(product.activeCheckbox).toBe(true);
    expect(product.active).toBe(true);
    expect(product.activeSemantics).toBe("CHECKED_MEANS_AVAILABLE");
    expect(product.listAvailability).toBe("AVAILABLE");
    expect(product.categoryIds).toEqual(["1"]);
    expect(product.formMethodOverride?.toLowerCase()).toBe("put");
    expect(product.formAction).toBe("/admin/menu/1");
    expect(product.variants).toHaveLength(3);
    expect(product.variants[0]).toMatchObject({
      databaseId: "101",
      name: "Alm",
      priceOre: 0,
    });
    expect(product.variants[1]?.priceOre).toBe(2000);
    expect(product.ingredients.map((i) => i.name)).toEqual([
      "Bread",
      "Cheese",
    ]);
    expect(product.additions[0]).toMatchObject({
      databaseId: "301",
      name: "Extra topping",
      priceOre: 1700,
    });
    expect(await page.locator(V1_SELECTORS.productUpdateForm).count()).toBe(1);
    expect(await page.getByRole("button", { name: /^Opdater$/i }).count()).toBe(
      1,
    );
    expect(await page.getByRole("button", { name: /^Slet$/i }).count()).toBe(1);

    await browser.close();
  },
  30_000,
);
});

describe("M2B create vs edit contract notes", () => {
  it("records create Skab vs edit Opdater and hidden row ids", () => {
    expect(ADMIN_CONTRACT_V1.createVsEdit.createSubmit.value).toMatch(/Skab/);
    expect(ADMIN_CONTRACT_V1.createVsEdit.editSubmit.value).toMatch(/Opdater/);
    expect(ADMIN_CONTRACT_V1.createVsEdit.editHasPersistentRowIds.value).toBe(
      true,
    );
    expect(
      ADMIN_CONTRACT_V1.createVsEdit.deleteFormAlsoPresentOnEditPage.value,
    ).toBe(true);
  });
});
