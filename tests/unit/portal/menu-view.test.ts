import { describe, expect, it } from "vitest";
import {
  buildMenuSections,
  buildProvenanceView,
  buildSourceProductIndex,
  formatDkk,
  lookupSourceProduct,
  productDisplayStatus,
  productMatchesFilter,
  productMatchesQuery,
  qualityStatusToDisplay,
  validationStatusToDisplay,
} from "../../../src/portal/menuView.js";
import type { CanonicalMenu, CanonicalProduct } from "../../../src/domain/schema/canonical.js";
import type { SourceMenu, SourceProduct } from "../../../src/domain/schema/source.js";
import type {
  MenuQualityContractResult,
  ProductQualityResult,
} from "../../../src/intelligence/types.js";

function product(
  partial: Partial<CanonicalProduct> & Pick<CanonicalProduct, "sourceId" | "name">,
): CanonicalProduct {
  return {
    categorySourceId: partial.categorySourceId ?? "cat_1",
    sourceOrder: partial.sourceOrder ?? 0,
    ingredients: partial.ingredients ?? [],
    variants: partial.variants ?? [],
    addOns: partial.addOns ?? [],
    productChoices: partial.productChoices ?? [],
    isCombo: partial.isCombo ?? false,
    status: partial.status ?? "READY",
    issues: partial.issues ?? [],
    ...partial,
  };
}

function menu(products: CanonicalProduct[]): CanonicalMenu {
  return {
    restaurantName: "Test Kitchen",
    categories: [
      {
        sourceId: "cat_1",
        name: "Pizza",
        sourceOrder: 0,
        commonIngredients: [],
        products,
      },
    ],
    status: "READY",
    issues: [],
  } as unknown as CanonicalMenu;
}

function sourceProduct(
  partial: Partial<SourceProduct> & Pick<SourceProduct, "sourceId" | "name">,
): SourceProduct {
  return {
    sourceOrder: partial.sourceOrder ?? 0,
    ingredients: partial.ingredients ?? [],
    variants: partial.variants ?? [],
    addOns: partial.addOns ?? [],
    productChoices: partial.productChoices ?? [],
    isCombo: partial.isCombo ?? false,
    ...partial,
  };
}

function sourceMenu(products: SourceProduct[]): SourceMenu {
  return {
    restaurantName: "Test Kitchen",
    categories: [
      {
        sourceId: "cat_1",
        name: "Pizza",
        sourceOrder: 0,
        commonIngredients: [],
        products,
      },
    ],
  } as unknown as SourceMenu;
}

function qualityProduct(
  partial: Pick<ProductQualityResult, "productSourceId" | "status"> &
    Partial<ProductQualityResult>,
): ProductQualityResult {
  return {
    name: partial.name ?? "Product",
    checks: partial.checks ?? [],
    blockers: partial.blockers ?? [],
    completenessWarnings: partial.completenessWarnings ?? [],
    ...partial,
  } as ProductQualityResult;
}

function qualityContract(
  products: ProductQualityResult[],
): MenuQualityContractResult {
  return {
    menuStatus: "MENU_QUALITY_READY",
    products,
    coherence: [],
    blockers: [],
    readyProductIds: [],
    reviewProductIds: [],
    blockedProductIds: [],
    statusAccounting: {
      productCount: products.length,
      ready: 0,
      review: 0,
      blocked: 0,
      reconciles: true,
    },
    findingCounts: { failedChecks: 0, coherenceFailures: 0 },
    completenessAccounting: {
      productsWithWarnings: 0,
      warningCount: 0,
      reconciles: true,
    },
  };
}

describe("formatDkk", () => {
  it("formats integer øre as Danish kroner", () => {
    expect(formatDkk(12500)).toBe("125,00 kr.");
    expect(formatDkk(750)).toBe("7,50 kr.");
    expect(formatDkk(0)).toBe("0,00 kr.");
    expect(formatDkk(1234)).toBe("12,34 kr.");
  });

  it("renders a dash for missing or non-finite prices", () => {
    expect(formatDkk(null)).toBe("—");
    expect(formatDkk(undefined)).toBe("—");
    expect(formatDkk(Number.NaN)).toBe("—");
  });
});

describe("display status mapping", () => {
  it("maps canonical validation status into display buckets", () => {
    expect(validationStatusToDisplay("READY")).toBe("READY");
    expect(validationStatusToDisplay("BLOCKED")).toBe("BLOCKED");
    expect(validationStatusToDisplay("WARNING")).toBe("REVIEW");
    expect(validationStatusToDisplay("MANUAL_REVIEW_REQUIRED")).toBe("REVIEW");
  });

  it("maps quality status into display buckets", () => {
    expect(qualityStatusToDisplay("QUALITY_READY")).toBe("READY");
    expect(qualityStatusToDisplay("QUALITY_REVIEW")).toBe("REVIEW");
    expect(qualityStatusToDisplay("QUALITY_BLOCKED")).toBe("BLOCKED");
  });

  it("lets the quality contract win over canonical status when present", () => {
    const p = product({ sourceId: "p1", name: "Pizza", status: "READY" });
    expect(
      productDisplayStatus(p, qualityProduct({ productSourceId: "p1", status: "QUALITY_BLOCKED" })),
    ).toBe("BLOCKED");
    expect(productDisplayStatus(p, null)).toBe("READY");
  });
});

describe("status filter", () => {
  it("ALL matches every bucket and specific filters match only their bucket", () => {
    expect(productMatchesFilter("READY", "ALL")).toBe(true);
    expect(productMatchesFilter("BLOCKED", "ALL")).toBe(true);
    expect(productMatchesFilter("REVIEW", "REVIEW")).toBe(true);
    expect(productMatchesFilter("READY", "REVIEW")).toBe(false);
    expect(productMatchesFilter("BLOCKED", "READY")).toBe(false);
  });
});

describe("productMatchesQuery", () => {
  it("matches name, menu numbers, description and ingredients", () => {
    const p = product({
      sourceId: "p1",
      name: "Kebabpizza",
      assignedMenuNumber: "220A",
      description: "med chili",
      ingredients: [{ display: "tomat", origin: "SOURCE" }],
    });
    expect(productMatchesQuery(p, "kebab")).toBe(true);
    expect(productMatchesQuery(p, "220a")).toBe(true);
    expect(productMatchesQuery(p, "chili")).toBe(true);
    expect(productMatchesQuery(p, "tomat")).toBe(true);
    expect(productMatchesQuery(p, "pasta")).toBe(false);
    expect(productMatchesQuery(p, "  ")).toBe(true);
  });
});

describe("buildMenuSections", () => {
  it("builds the category tree with status counts and display fields", () => {
    const sections = buildMenuSections({
      targetMenu: menu([
        product({ sourceId: "p1", name: "Margherita", basePrice: 7900, status: "READY" }),
        product({ sourceId: "p2", name: "Calzone", status: "MANUAL_REVIEW_REQUIRED" }),
      ]),
      qualityContract: null,
      sourceMenu: null,
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.productCount).toBe(2);
    expect(sections[0]!.statusCounts.READY).toBe(1);
    expect(sections[0]!.statusCounts.REVIEW).toBe(1);
    expect(sections[0]!.statusCounts.BLOCKED).toBe(0);
    expect(sections[0]!.products[0]!.priceLabel).toBe("79,00 kr.");
    expect(sections[0]!.products[1]!.statusLabel).toBe("Needs review");
    expect(sections[0]!.products[1]!.tone).toBe("warn");
  });

  it("applies quality contract status and drops empty categories when narrowing", () => {
    const contract = qualityContract([
      qualityProduct({ productSourceId: "p1", status: "QUALITY_BLOCKED" }),
    ]);
    const sections = buildMenuSections({
      targetMenu: menu([
        product({ sourceId: "p1", name: "Margherita" }),
        product({ sourceId: "p2", name: "Calzone" }),
      ]),
      qualityContract: contract,
      sourceMenu: null,
      statusFilter: "BLOCKED",
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.products).toHaveLength(1);
    expect(sections[0]!.products[0]!.product.sourceId).toBe("p1");
    // Category counts reflect the full category, not the filtered subset.
    expect(sections[0]!.productCount).toBe(2);
    expect(sections[0]!.statusCounts.BLOCKED).toBe(1);
  });

  it("returns an empty list for a missing TargetMenu", () => {
    expect(
      buildMenuSections({
        targetMenu: null,
        qualityContract: null,
        sourceMenu: null,
      }),
    ).toEqual([]);
  });
});

describe("source↔target provenance matching", () => {
  it("matches by stable sourceId first", () => {
    const index = buildSourceProductIndex(
      sourceMenu([sourceProduct({ sourceId: "s1", name: "Margherita" })]),
    );
    const viewed = product({ sourceId: "s1", name: "Margherita (renamed)" });
    expect(lookupSourceProduct(index, viewed)?.sourceId).toBe("s1");
  });

  it("falls back to menu number + name and refuses ambiguous names", () => {
    const index = buildSourceProductIndex(
      sourceMenu([
        sourceProduct({ sourceId: "s1", name: "Pizza", sourceMenuNumber: "1" }),
        sourceProduct({ sourceId: "s2", name: "Pizza", sourceMenuNumber: "2" }),
      ]),
    );
    const numbered = product({
      sourceId: "canon-x",
      name: "Pizza",
      sourceMenuNumber: "2",
    });
    expect(lookupSourceProduct(index, numbered)?.sourceId).toBe("s2");

    const ambiguous = product({ sourceId: "canon-y", name: "Pizza" });
    expect(lookupSourceProduct(index, ambiguous)).toBeNull();
  });

  it("exposes the matched source product on the menu view", () => {
    const sections = buildMenuSections({
      targetMenu: menu([product({ sourceId: "p1", name: "Margherita" })]),
      qualityContract: null,
      sourceMenu: sourceMenu([sourceProduct({ sourceId: "p1", name: "Margherita" })]),
    });
    expect(sections[0]!.products[0]!.sourceProduct?.sourceId).toBe("p1");
  });
});

describe("buildProvenanceView", () => {
  it("summarises evidence, field origins, diffs and quality checks", () => {
    const target = product({
      sourceId: "p1",
      name: "Margherita",
      basePrice: 7900,
      basePriceOrigin: "DERIVED",
      ingredients: [{ display: "tomat", origin: "SOURCE" }],
      evidence: { pageNumber: 2, sourceSection: "Pizza", confidence: 0.9 },
    });
    const source = sourceProduct({
      sourceId: "p1",
      name: "Margherita",
      sourcePriceOptions: [{ label: "BASE", sourceTotalPrice: 7500 }],
    });
    const quality = qualityProduct({
      productSourceId: "p1",
      status: "QUALITY_READY",
      checks: [{ id: "PRICE_SUPPORTED", pass: true }],
    });

    const view = buildProvenanceView({
      product: target,
      sourceProduct: source,
      qualityProduct: quality,
    });

    expect(view.evidence?.pageNumber).toBe(2);
    expect(view.evidence?.confidence).toBe(0.9);
    expect(
      view.fields.find((field) => field.field === "Base price")?.origin,
    ).toBe("DERIVED");
    const priceDiff = view.diffs.find((diff) => diff.field === "Price");
    expect(priceDiff?.changed).toBe(true);
    expect(priceDiff?.source).toContain("75,00 kr.");
    expect(priceDiff?.target).toBe("79,00 kr.");
    expect(view.checks).toHaveLength(1);
    expect(view.checks[0]!.pass).toBe(true);
  });

  it("degrades gracefully without source or quality data", () => {
    const view = buildProvenanceView({
      product: product({ sourceId: "p1", name: "Margherita" }),
      sourceProduct: null,
      qualityProduct: null,
    });
    expect(view.evidence).toBeNull();
    expect(view.diffs).toEqual([]);
    expect(view.checks).toEqual([]);
    expect(view.blockers).toEqual([]);
  });
});
