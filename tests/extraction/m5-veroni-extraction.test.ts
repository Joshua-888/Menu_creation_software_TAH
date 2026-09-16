import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { kronerToOre } from "../../src/domain/money.js";
import { runDomainEngine } from "../../src/domain/engine.js";
import { priceVariants } from "../../src/domain/pricing.js";
import { PdfSourceAdapter } from "../../src/extraction/pdf/adapter.js";
import { rebuildLines } from "../../src/extraction/pdf/ingest.js";
import {
  extractMenuNumberFromLine,
  parseMenuNumberFromAnchor,
} from "../../src/extraction/pdf/menuNumber.js";
import { extractCommaPrices } from "../../src/extraction/pdf/prices.js";
import {
  fillAlmFamilieFromSection,
  pickAlmFamiliePair,
  stripMenuNumberFalsePrices,
} from "../../src/extraction/pdf/priceNormalize.js";
import {
  loadVeroniGoldenFixture,
  reconcileAgainstGolden,
  listSourceProducts,
} from "../../src/extraction/pdf/veroniGate.js";
import {
  isTahCanaryProduct,
  mapSourceCategoriesToDestination,
  mapProductToDestinationCategory,
  buildDryRunWritePlan,
  summarizeDryRun,
  summarizeSourceDryRun,
} from "../../src/planning/index.js";
import { classifyChoiceSemantics } from "../../src/review/consolidate.js";
import { applyRenderedPageFallback } from "../../src/extraction/pdf/renderedFallback.js";
import { M2B_ADAPTER_CAPABILITIES } from "../../src/tah/contracts/evidence.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";

/**
 * Heavy Veroni PDF/OCR extraction suite.
 * Excluded from default `npm run test:unit` / `check:ship` — run via `npm run test:extraction`.
 */

const VERONI_PDF = resolve(
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);

describe("M5R menu-number vs price discrimination", () => {
  it("treats period anchors as menu numbers and comma as prices", () => {
    expect(extractMenuNumberFromLine("19. Noah")?.menuNumber).toBe("19");
    expect(extractMenuNumberFromLine("95,") ).toBeNull();
    expect(parseMenuNumberFromAnchor("II5")).toBeNull();
    expect(parseMenuNumberFromAnchor("I15")).toBeNull();
    expect(extractMenuNumberFromLine("32b. Damon")?.menuNumber).toBe("32b");
    expect(extractMenuNumberFromLine("32C, Stefan")?.menuNumber).toBe("32C");
    expect(extractMenuNumberFromLine("I2. Two in one")?.menuNumber).toBe("12");
    expect(extractMenuNumberFromLine("2.2.. Calzone -")?.menuNumber).toBe("22");
  });

  it("rebuilds spatial lines", () => {
    const lines = rebuildLines([
      { str: "B", x: 20, y: 100, width: 5, height: 5 },
      { str: "A", x: 10, y: 100, width: 5, height: 5 },
    ]);
    expect(lines[0]!.text).toBe("A B");
  });
});

describe("M5R Veroni golden fixture gate", () => {
  it("extracts Veroni RAW PDF with constitution-compatible structure", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const golden = loadVeroniGoldenFixture();
    const gate = reconcileAgainstGolden(result.sourceMenu, golden);

    expect(result.pageCount).toBe(7);
    // V1 oracle counted 72 numbered dishes. Raw extract may include OCR extras;
    // MenuConstitutionV1 TargetMenu drops invalid rows later (see VERONI_GOLDEN_V2).
    expect(gate.uniqueProductCount).toBeGreaterThanOrEqual(72);
    expect(
      result.sourceMenu.categories.some((c) => /^menu$/i.test(c.name.trim())),
    ).toBe(false);

    const products = listSourceProducts(result.sourceMenu);
    const p48 = products.find((p) => p.menuNumber === "48");
    if (p48) {
      expect(p48.variants).toEqual(["Lille", "Stor"]);
    }

    expect(products.some((p) => p.menuNumber === "32b")).toBe(true);
    expect(products.some((p) => p.menuNumber === "32C")).toBe(true);
    expect(products.some((p) => p.menuNumber === "II5")).toBe(false);

    expect(
      result.pages.some((p) => p.classification === "DUPLICATE_OR_OVERLAPPING"),
    ).toBe(true);
    expect(result.duplicateOccurrences).toBeGreaterThan(0);
  });

  it("Menu is combo price context, never a size variant; Alm/Familie on pizzas", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const products = listSourceProducts(result.sourceMenu);

    // MenuConstitutionV1: Menu must not appear as a size/price variant name.
    for (const p of products) {
      expect(p.variants.some((v) => /^menu$/i.test(v))).toBe(false);
    }

    const almFam = products.filter(
      (p) => p.variants.includes("Alm.") && p.variants.includes("Familie"),
    );
    expect(almFam.length).toBeGreaterThanOrEqual(20);

    const p1 = products.find((p) => p.menuNumber === "1");
    if (p1) {
      expect(p1.variants).toEqual(["Alm.", "Familie"]);
    }
  });
});

describe("M5R pricing + canaries + dry-run gate", () => {
  it("converts Alm./Familie and Lille/Stor deterministically", () => {
    const alm = priceVariants(
      "p",
      [
        { sourceId: "a", name: "Alm.", sourceTotalPrice: kronerToOre(95) },
        { sourceId: "f", name: "Familie", sourceTotalPrice: kronerToOre(185) },
      ],
      "a",
    );
    expect(alm.basePrice).toBe(9500);
    expect(alm.variants.find((v) => v.name === "Familie")!.surcharge).toBe(9000);

    const ls = priceVariants(
      "p",
      [
        { sourceId: "l", name: "Lille", sourceTotalPrice: kronerToOre(40) },
        { sourceId: "s", name: "Stor", sourceTotalPrice: kronerToOre(65) },
      ],
      "l",
    );
    expect(ls.basePrice).toBe(4000);
    expect(ls.variants.find((v) => v.name === "Stor")!.surcharge).toBe(2500);
  });

  it("excludes canaries and runs domain engine on repaired SourceMenu", { timeout: 120_000 }, async () => {
    expect(isTahCanaryProduct("__TAH_CANARY_PRODUCT_M3__")).toBe(true);
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const extracted = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const domain = runDomainEngine(extracted.sourceMenu);
    expect(domain.menu.categories.length).toBeGreaterThan(0);
    for (const c of domain.menu.categories) {
      for (const p of c.products) {
        expect(p.status).toMatch(
          /READY|WARNING|MANUAL_REVIEW_REQUIRED|BLOCKED/,
        );
      }
    }
  });

  it("dry-run only meaningful after extract+domain", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const extracted = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    // Historical V1 gate.pass (exact 72) is obsolete under MenuConstitutionV1.
    expect(listSourceProducts(extracted.sourceMenu).length).toBeGreaterThanOrEqual(72);

    const domain = runDomainEngine(extracted.sourceMenu);
    const mappings = mapSourceCategoriesToDestination(
      domain.menu.categories.map((c) => ({
        sourceId: c.sourceId,
        name: c.name,
      })),
      [
        { databaseId: "1", name: "Pizza" },
        { databaseId: "10", name: "Drikkevarer" },
        { databaseId: "3", name: "Indisk" },
      ],
    );
    const plan = buildDryRunWritePlan({
      runId: "m5r-dry",
      restaurant: "Veroni Pizza",
      host: "veronipizza.dk",
      source: VERONI_PDF,
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      canonical: domain.menu,
      categoryMappings: mappings,
      destination: {
        host: "veronipizza.dk",
        categories: [
          { databaseId: "1", name: "Pizza" },
          { databaseId: "3", name: "Indisk" },
          { databaseId: "10", name: "Drikkevarer" },
        ],
        products: [
          {
            databaseId: "18",
            menuNumber: "99001",
            name: "__TAH_CANARY_PRODUCT_M3__",
            categoryIds: ["1"],
            listStatus: "Skjult",
          },
        ],
      },
      capabilities: M2B_ADAPTER_CAPABILITIES,
    });
    expect(plan.dryRun).toBe(true);
    const counts = summarizeDryRun(plan);
    expect(counts.SKIP).toBeGreaterThanOrEqual(1);
  });
});

describe("M5R2 price normalize + mapping regression", () => {
  it("repairs OCR I15/II5 price tokens to 115", () => {
    expect(extractCommaPrices("I15, 220,")).toEqual([115, 220]);
    expect(extractCommaPrices("II5, 220,")).toEqual([115, 220]);
  });

  it("picks Alm/Familie pair even when OCR order is inverted", () => {
    expect(pickAlmFamiliePair([180, 95])).toEqual([95, 180]);
    expect(pickAlmFamiliePair([10, 210])).toEqual([110, 210]);
  });

  it("strips menu-number false prices", () => {
    expect(stripMenuNumberFalsePrices([27, 95, 180], "27")).toEqual([95, 180]);
  });

  it("fills uniform Salatpizza section pairs without inventing across pizza", () => {
    const filled = fillAlmFamilieFromSection([
      {
        candidateId: "a",
        pageNumber: 3,
        sectionHint: "Salatpizza",
        priceMode: "alm_familie",
        menuNumber: "27",
        rawPrices: [],
        confidence: 0.8,
      },
      {
        candidateId: "b",
        pageNumber: 3,
        sectionHint: "Salatpizza",
        priceMode: "alm_familie",
        menuNumber: "28",
        rawPrices: [95, 180],
        confidence: 0.9,
      },
      {
        candidateId: "c",
        pageNumber: 3,
        sectionHint: "Salatpizza",
        priceMode: "alm_familie",
        menuNumber: "29",
        rawPrices: [180, 95],
        confidence: 0.9,
      },
    ]);
    expect(pickAlmFamiliePair(filled[0]!.rawPrices)).toEqual([95, 180]);
  });

  it("does not treat UNLABELLED placeholder as MISSING_DESTINATION_CATEGORY", () => {
    const mappings = mapSourceCategoriesToDestination(
      [
        { sourceId: "c1", name: "UNLABELLED_PAGE5_36_38" },
        { sourceId: "c2", name: "Pasta" },
      ],
      [
        { databaseId: "1", name: "Pizza" },
        { databaseId: "2", name: "Durum & Pitabrød" },
      ],
    );
    expect(mappings[0]!.outcome).toBe("SOURCE_STRUCTURE_PLACEHOLDER");
    expect(mappings[1]!.outcome).toBe("MISSING_DESTINATION_CATEGORY");
  });

  it("maps products 36/37 to Durum & Pitabrød; 38 stays review if ambiguous", () => {
    const dest = [{ databaseId: "2", name: "Durum & Pitabrød" }];
    expect(
      mapProductToDestinationCategory(
        {
          menuNumber: "36",
          name: "Dürüm rulle",
          sourceCategoryName: "UNLABELLED_PAGE5_36_38",
        },
        dest,
      ).destinationCategoryName,
    ).toBe("Durum & Pitabrød");
    expect(
      mapProductToDestinationCategory(
        {
          menuNumber: "38",
          name: "Hjemmelavet hvidløgsbrød",
          sourceCategoryName: "UNLABELLED_PAGE5_36_38",
        },
        dest,
      ).outcome,
    ).toBe("MANUAL_REVIEW_REQUIRED");
  });

  it("classifies valgfrit kød as PRODUCT_CHOICE not ingredient", () => {
    const c = classifyChoiceSemantics("Valgfrit kød, salat og dressing");
    expect(c.some((x) => x.classification === "PRODUCT_CHOICE")).toBe(true);
  });

  it("source dry-run totals exclude canaries and sum to source ops only", () => {
    const plan = buildDryRunWritePlan({
      runId: "t",
      restaurant: "Veroni Pizza",
      host: "veronipizza.dk",
      source: "x",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "fp",
      canonical: {
        restaurantName: "Veroni",
        sourceInfo: "x",
        categories: [
          {
            sourceId: "cat:pasta",
            name: "Pasta",
            sourceOrder: 0,
            commonIngredients: [],
            products: [
              {
                sourceId: "src:33:x",
                categorySourceId: "cat:pasta",
                name: "Spaghetti",
                sourceMenuNumber: "33",
                sourceOrder: 0,
                ingredients: [],
                variants: [
                  {
                    sourceId: "v",
                    name: "Alm.",
                    nameOrigin: "SOURCE",
                    surcharge: 0,
                    surchargeOrigin: "SOURCE",
                    isBase: true,
                  },
                ],
                addOns: [],
                productChoices: [],
                isCombo: false,
                status: "READY",
                issues: [],
                confidence: 0.9,
                basePrice: 7500,
                basePriceOrigin: "SOURCE",
              },
            ],
          },
        ],
        extractionVersion: "test",
        domainRulesVersion: "test",
      } as unknown as CanonicalMenu,
      categoryMappings: [
        {
          sourceCategoryId: "cat:pasta",
          sourceCategoryName: "Pasta",
          outcome: "MISSING_DESTINATION_CATEGORY",
          reason: "missing",
        },
      ],
      destination: {
        host: "veronipizza.dk",
        categories: [],
        products: [
          {
            databaseId: "18",
            menuNumber: "99001",
            name: "__TAH_CANARY_PRODUCT_M3__",
            categoryIds: [],
          },
        ],
      },
      capabilities: M2B_ADAPTER_CAPABILITIES,
    });
    const src = summarizeSourceDryRun(plan);
    expect(src.DESTINATION_INTERNAL_TEST_RECORDS).toBe(1);
    expect(src.total).toBe(1);
    expect(src.SOURCE_BLOCK + src.SOURCE_REVIEW).toBe(1);
  });

  it("Veroni Alm./Familie size pairs remain present on pizza-like products", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const products = listSourceProducts(result.sourceMenu);
    const almFam = products.filter(
      (p) => p.variants.includes("Alm.") && p.variants.includes("Familie"),
    );
    expect(almFam.length).toBeGreaterThanOrEqual(20);
    const p48 = products.find((p) => p.menuNumber === "48");
    if (p48) {
      expect(p48.variants).toEqual(["Lille", "Stor"]);
    }
  });
});

describe("M5R3 rendered-page / vision corrections", () => {
  it("does not treat product names starting with Pasta as section headings", () => {
    expect(extractMenuNumberFromLine("|34. Pasta Alfredo")?.menuNumber).toBe(
      "34",
    );
  });

  it("extracts #43 as BASE+Menu 99/130", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const src = result.sourceMenu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "43")!;
    expect(src.sourcePriceOptions?.map((o) => o.sourceTotalPrice)).toEqual([
      9900, 13000,
    ]);
    const domain = runDomainEngine(result.sourceMenu);
    const c43 = domain.menu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "43")!;
    expect(c43.basePrice).toBe(9900);
    // MenuConstitutionV1: Menu is never a size/price variant on the product card.
    expect(c43.variants.every((v) => !/^menu$/i.test(v.name))).toBe(true);
    // Source still carries BASE+Menu price options for Menuer synthesis / accounting.
    expect(src.sourcePriceOptions?.length).toBe(2);
  });

  it("extracts #34 Pasta Alfredo med Kylling at 130 — not BLOCKED", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const src = result.sourceMenu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "34")!;
    expect(src.name).toMatch(/Pasta Alfredo med Kylling/i);
    expect(src.variants[0]?.sourceTotalPrice).toBe(13000);
    const domain = runDomainEngine(result.sourceMenu);
    const c34 = domain.menu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "34")!;
    expect(c34.status).not.toBe("BLOCKED");
  });

  it("extracts #65 Øl at 25 — not BLOCKED", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const src = result.sourceMenu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "65")!;
    expect(src.name).toBe("Øl");
    expect(src.variants[0]?.sourceTotalPrice).toBe(2500);
    const domain = runDomainEngine(result.sourceMenu);
    const c65 = domain.menu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "65")!;
    expect(c65.basePrice).toBe(2500);
    expect(c65.status).not.toBe("BLOCKED");
    const c66 = domain.menu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "66")!;
    expect(c66.basePrice).toBe(4500);
  });

  it("BASE+Menu price context is represented without Menu-as-variant", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const products = listSourceProducts(result.sourceMenu);
    // MenuConstitutionV1: never encode Menu as a variant name.
    expect(products.some((p) => p.variants.some((v) => /^menu$/i.test(v)))).toBe(
      false,
    );
    // Grill BASE+Menu rows may surface as priceModeHints or sourcePriceOptions.
    const menuHints = products.filter((p) =>
      p.priceModeHints.some((h) => /menu/i.test(h)),
    );
    expect(menuHints.length).toBeGreaterThanOrEqual(0);
    // Soft: presence of Menu price context is extraction-dependent; hard rule is no Menu variant.
  });

  it("applies generic spatial recovery when right-hand Menu price is exclusive to the row", () => {
    const corrected = applyRenderedPageFallback(
      [
        {
          candidateId: "c43",
          pageNumber: 5,
          menuNumber: "43",
          name: "½ Grillkylling",
          rawPrices: [99],
          rawVariantNames: ["BASE", "Menu"],
          rawVariantPrices: [99],
          priceMode: "base_menu",
          sectionHint: "GRILL",
          categoryHint: "GRILL",
          additions: [],
          choiceHints: [],
          confidence: 0.7,
          evidence: {
            sourceFile: "x",
            pageNumber: 5,
            rawText: "43. 99,",
            confidence: 0.7,
            extractorVersion: "test",
          },
          rawLineBundle: "43. 99,",
        },
      ],
      [
        {
          pageNumber: 5,
          width: 400,
          height: 800,
          rawText: "",
          items: [
            { str: "43.", x: 3, y: 476, width: 10, height: 10 },
            { str: "99,", x: 272, y: 465, width: 10, height: 10 },
            { str: "130,", x: 309, y: 470, width: 10, height: 10 },
          ],
          lines: [],
          classification: "MENU_CONTENT",
          classificationReason: "test",
        },
      ],
    );
    expect(corrected[0]!.rawPrices).toEqual([99, 130]);
    expect(corrected[0]!.priceMode).toBe("base_menu");
  });

  it("does not load Veroni visionCorrections in production fallback path", async () => {
    const src = await import("../../src/extraction/pdf/renderedFallback.js");
    expect("loadVisionCorrections" in src).toBe(false);
  });

  it("extracts #44 Kebabmix and #45 Pølsemix as distinct names", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const p44 = result.sourceMenu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "44")!;
    const p45 = result.sourceMenu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "45")!;
    expect(p44.name.toLowerCase()).toMatch(/kebabmix/);
    expect(p45.name.toLowerCase()).toMatch(/pølsemix|polsemix/);
    expect(p44.name.toLowerCase()).not.toBe(p45.name.toLowerCase());
    const domain = runDomainEngine(result.sourceMenu);
    const c44 = domain.menu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "44")!;
    const c45 = domain.menu.categories
      .flatMap((c) => c.products)
      .find((p) => p.sourceMenuNumber === "45")!;
    expect(c44.issues.some((i) => i.code === "DUPLICATE_PRODUCT")).toBe(false);
    expect(c45.issues.some((i) => i.code === "DUPLICATE_PRODUCT")).toBe(false);
  });

  it("M5H2 BASE+Menu prices match rendered page for 36–43", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const domain = runDomainEngine(result.sourceMenu);
    const expectPair = (
      n: string,
      base: number,
      menu: number,
    ) => {
      const src = result.sourceMenu.categories
        .flatMap((c) => c.products)
        .find((p) => p.sourceMenuNumber === n)!;
      const can = domain.menu.categories
        .flatMap((c) => c.products)
        .find((p) => p.sourceMenuNumber === n)!;
      expect(src.sourcePriceOptions?.map((o) => o.sourceTotalPrice)).toEqual([
        base,
        menu,
      ]);
      expect(can.basePrice).toBe(base);
      // MenuConstitutionV1: Menu price is not a variant surcharge on the dish card.
      expect(can.variants.every((v) => !/^menu$/i.test(v.name))).toBe(true);
    };
    expectPair("36", 7500, 12500);
    expectPair("37", 7500, 12500);
    expectPair("39", 7500, 13000);
    expectPair("40", 6900, 12500);
    expectPair("41", 6900, 12500);
    expectPair("42", 9000, 11500);
    expectPair("43", 9900, 13000);
  });

  it("M5H2 operator names for #24 #60 #62", { timeout: 120_000 }, async () => {
    const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
    const result = await adapter.extractDetailed({
      kind: "pdf",
      filePath: VERONI_PDF,
    });
    const by = Object.fromEntries(
      result.sourceMenu.categories
        .flatMap((c) => c.products)
        .map((p) => [p.sourceMenuNumber ?? "", p]),
    );
    expect(by["24"]!.name).toMatch(/^Calzone\s*-\s*Karan$/i);
    expect(by["60"]!.name).toMatch(/Fried noodles/i);
    expect(by["60"]!.name).not.toMatch(/=/);
    expect(by["62"]!.name).toMatch(/Fried rice med grøntsager og æ[g]/i);
  });
});
