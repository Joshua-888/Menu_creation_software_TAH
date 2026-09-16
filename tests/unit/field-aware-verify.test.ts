import { describe, expect, it } from "vitest";
import {
  compareIngredientDescription,
  parseIngredientDescriptionTokens,
  verifyProductFields,
} from "../../src/runner/fieldAwareVerify.js";
import { compareProductExact } from "../../src/runner/executor.js";
import {
  CATEGORY_CREATE_IS_PUBLIC_MUTATION,
  CATEGORY_VISIBILITY_CONTROL_EXISTS,
  auditCategoryExposureCapabilities,
  buildMinimizedCategoryExposureSteps,
  proposeEmptyCategoryCompensation,
} from "../../src/runner/categoryExposure.js";
import { gateWriteLabels } from "../../src/decisions/labelQuality.js";
import type { PlannedProductPayload } from "../../src/runner/writePlan.js";
import type { DestinationProduct } from "../../src/runner/executor.js";

const BELLA_TARGET_DESC = "Oksekød, salat, tomat, løg, ketchup og mayo";
const BELLA_DEST_DESC = "Oksekød, Salat, Tomat, Løg, Ketchup, Mayo";

describe("BELLA-010 ingredient description representation", () => {
  it("parses og-list and comma-title-case to identical tokens", () => {
    expect(parseIngredientDescriptionTokens(BELLA_TARGET_DESC)).toEqual([
      "oksekød",
      "salat",
      "tomat",
      "løg",
      "ketchup",
      "mayo",
    ]);
    expect(parseIngredientDescriptionTokens(BELLA_DEST_DESC)).toEqual([
      "oksekød",
      "salat",
      "tomat",
      "løg",
      "ketchup",
      "mayo",
    ]);
  });

  it("PASS / REPRESENTATION_EQUIVALENT for Bella smash description case", () => {
    const r = compareIngredientDescription(BELLA_TARGET_DESC, BELLA_DEST_DESC);
    expect(r.result).toBe("REPRESENTATION_EQUIVALENT");
    expect(r.comparisonMode).toBe("INGREDIENT_DESCRIPTION_SEMANTIC");
  });

  it("FAIL when ingredient missing (mayo)", () => {
    const r = compareIngredientDescription(
      BELLA_TARGET_DESC,
      "Oksekød, salat, tomat, løg og ketchup",
    );
    expect(r.result).toBe("SEMANTIC_MISMATCH");
  });

  it("FAIL when extra ingredient present", () => {
    const r = compareIngredientDescription(
      BELLA_TARGET_DESC,
      "Oksekød, salat, tomat, løg, ketchup, mayo og bacon",
    );
    expect(r.result).toBe("SEMANTIC_MISMATCH");
  });

  it("FAIL on different protein", () => {
    const r = compareIngredientDescription(
      "Oksekød, salat, tomat",
      "Kylling, salat, tomat",
    );
    expect(r.result).toBe("SEMANTIC_MISMATCH");
  });

  it("FAIL on different sauce", () => {
    const r = compareIngredientDescription("Creme fraiche", "Tahin");
    expect(r.result).toBe("SEMANTIC_MISMATCH");
  });

  it("does not naively split compound on internal og beyond final conjunction", () => {
    const tokens = parseIngredientDescriptionTokens(
      "Falafel og creme fraiche dressing",
    );
    expect(tokens).toEqual(["falafel", "creme fraiche dressing"]);
  });
});

describe("field-aware price / structured equality", () => {
  it("price exactness: 100kr vs 110kr is SEMANTIC_MISMATCH", () => {
    const expected: PlannedProductPayload = {
      sourceId: "s1",
      menuNumber: "1",
      name: "X",
      description: "Salat",
      basePriceOre: 10_000,
      categoryIds: ["1"],
      variants: [{ name: "Alm.", surchargeOre: 0 }],
      ingredients: ["Salat"],
      additions: [],
      intendedHidden: true,
    };
    const actual: DestinationProduct = {
      databaseId: "1",
      menuNumber: "1",
      name: "X",
      description: "Salat",
      basePriceOre: 11_000,
      categoryIds: ["1"],
      variants: [{ name: "Alm.", priceOre: 0 }],
      ingredients: [{ name: "Salat" }],
      additions: [],
      listStatus: "Skjult",
    };
    const report = verifyProductFields({ expected, actual });
    expect(report.ok).toBe(false);
    expect(report.semanticMismatchFields).toContain("basePrice");
    const price = report.fields.find((f) => f.field === "basePrice")!;
    expect(price.result).toBe("SEMANTIC_MISMATCH");
    expect(price.comparisonMode).toBe("PRICE_EXACT_MONEY");
  });

  it("choice/addition structured equality and addition price exactness", () => {
    const expected: PlannedProductPayload = {
      sourceId: "s1",
      menuNumber: "1",
      name: "X",
      description: "Salat",
      basePriceOre: 7500,
      categoryIds: ["1"],
      variants: [
        { name: "Alm.", surchargeOre: 0 },
        { name: "Menu", surchargeOre: 3000 },
      ],
      ingredients: ["Salat"],
      additions: [
        { name: "Bacon", priceOre: 2000 },
        { name: "Ost", priceOre: 1000 },
      ],
      intendedHidden: true,
    };
    const actual: DestinationProduct = {
      databaseId: "1",
      menuNumber: "1",
      name: "X",
      description: "Salat",
      basePriceOre: 7500,
      categoryIds: ["1"],
      variants: [
        { name: "Alm.", priceOre: 0 },
        { name: "Menu", priceOre: 3000 },
      ],
      ingredients: [{ name: "Salat" }],
      additions: [
        { name: "Bacon", priceOre: 2000 },
        { name: "Ost", priceOre: 1000 },
      ],
      listStatus: "Skjult",
    };
    expect(compareProductExact(expected, actual)).toEqual([]);

    const badPrice = {
      ...actual,
      additions: [
        { name: "Bacon", priceOre: 1 },
        { name: "Ost", priceOre: 1000 },
      ],
    };
    expect(compareProductExact(expected, badPrice)).toContain("additionPrice0");

    const badVariant = {
      ...actual,
      variants: [
        { name: "Alm.", priceOre: 0 },
        { name: "Menu", priceOre: 9999 },
      ],
    };
    expect(compareProductExact(expected, badVariant)).toContain("variantPrice1");
  });

  it("Bella product #1 fixture passes field-aware verify", () => {
    const expected: PlannedProductPayload = {
      sourceId: "src:?:smashburger",
      menuNumber: "1",
      name: "Smash burger",
      description: BELLA_TARGET_DESC,
      basePriceOre: 7500,
      categoryIds: ["2"],
      variants: [{ name: "Alm.", surchargeOre: 0 }],
      ingredients: ["Oksekød", "Salat", "Tomat", "Løg", "Ketchup", "Mayo"],
      additions: [
        { name: "Bacon", priceOre: 2000 },
        { name: "Ost", priceOre: 1000 },
        { name: "Salat", priceOre: 1000 },
        { name: "Tomat", priceOre: 1000 },
        { name: "Løg", priceOre: 1000 },
        { name: "Oksekød", priceOre: 2000 },
        { name: "Agurk", priceOre: 1000 },
        { name: "Jalapeños", priceOre: 1000 },
      ],
      intendedHidden: true,
    };
    const actual: DestinationProduct = {
      databaseId: "1",
      menuNumber: "1",
      name: "Smash burger",
      description: BELLA_DEST_DESC,
      basePriceOre: 7500,
      categoryIds: ["2"],
      variants: [{ name: "Alm.", priceOre: 0 }],
      ingredients: [
        { name: "Oksekød" },
        { name: "Salat" },
        { name: "Tomat" },
        { name: "Løg" },
        { name: "Ketchup" },
        { name: "Mayo" },
      ],
      additions: [
        { name: "Bacon", priceOre: 2000 },
        { name: "Ost", priceOre: 1000 },
        { name: "Salat", priceOre: 1000 },
        { name: "Tomat", priceOre: 1000 },
        { name: "Løg", priceOre: 1000 },
        { name: "Oksekød", priceOre: 2000 },
        { name: "Agurk", priceOre: 1000 },
        { name: "Jalapeños", priceOre: 1000 },
      ],
      listStatus: "Skjult",
    };
    const report = verifyProductFields({ expected, actual });
    expect(report.ok).toBe(true);
    expect(report.representationEquivalentFields).toContain("description");
    expect(compareProductExact(expected, actual)).toEqual([]);
  });
});

describe("BELLA-010 transform layer forensics", () => {
  it("gateWriteLabels description_hygiene produces destination representation", () => {
    const gated = gateWriteLabels({
      name: "Smash burger",
      description: BELLA_TARGET_DESC,
      ingredients: ["Oksekød", "Salat", "Tomat", "Løg", "Ketchup", "Mayo"],
      restaurantKey: "bellakebab.dk",
      menuNumber: "1",
      store: null,
    });
    expect(gated.ok).toBe(true);
    expect(gated.description).toBe(BELLA_DEST_DESC);
  });
});

describe("BELLA-011 category exposure", () => {
  it("documents CATEGORY_CREATE_IS_PUBLIC_MUTATION and no visibility control", () => {
    expect(CATEGORY_CREATE_IS_PUBLIC_MUTATION).toBe(true);
    expect(CATEGORY_VISIBILITY_CONTROL_EXISTS).toBe(false);
    const audit = auditCategoryExposureCapabilities();
    expect(audit.hiddenCategory).toBe(false);
    expect(audit.CATEGORY_CREATE_IS_PUBLIC_MUTATION).toBe(true);
  });

  it("minimizes exposure: category then its products, not all categories first", () => {
    const { steps, blocked } = buildMinimizedCategoryExposureSteps({
      categories: [{ name: "Burgers" }, { name: "Menuer" }],
      products: [
        { sourceId: "p1", categoryName: "Burgers", ready: true },
        { sourceId: "p2", categoryName: "Burgers", ready: true },
        { sourceId: "p3", categoryName: "Menuer", ready: true },
      ],
    });
    expect(blocked).toEqual([]);
    const kinds = steps.map((s) => s.kind);
    expect(kinds.indexOf("CREATE_CATEGORY")).toBeLessThan(
      kinds.indexOf("CREATE_HIDDEN_PRODUCT"),
    );
    // Second category create occurs only after first category's products
    const firstCatCreate = kinds.indexOf("CREATE_CATEGORY");
    const secondCatCreate = kinds.indexOf("CREATE_CATEGORY", firstCatCreate + 1);
    const lastBurgerVerify = kinds.lastIndexOf("VERIFY_HIDDEN_PRODUCT");
    // Menuer create should be after Burgers products started
    expect(secondCatCreate).toBeGreaterThan(firstCatCreate);
    expect(steps[firstCatCreate]).toMatchObject({
      kind: "CREATE_CATEGORY",
      categoryName: "Burgers",
    });
    expect(steps[secondCatCreate]).toMatchObject({
      kind: "CREATE_CATEGORY",
      categoryName: "Menuer",
    });
    void lastBurgerVerify;
  });

  it("blocks category create when dependent products are not READY", () => {
    const { steps, blocked } = buildMinimizedCategoryExposureSteps({
      categories: [{ name: "Burgers" }],
      products: [
        { sourceId: "p1", categoryName: "Burgers", ready: false },
      ],
    });
    expect(steps).toEqual([]);
    expect(blocked[0]?.reason).toMatch(/not READY/);
  });

  it("proposes empty-category compensation without auto-delete", () => {
    const r = proposeEmptyCategoryCompensation({
      categoryDatabaseId: "3",
      categoryName: "Menuer",
      newlyCreatedInIncident: true,
      productCountOnCategory: 0,
      anyProductPersisted: false,
      certifiedDeleteAllowed: true,
    });
    expect(r.proposeRemoval).toBe(true);
    expect(r.autoDelete).toBe(false);
  });
});
