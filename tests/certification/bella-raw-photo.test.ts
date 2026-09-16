import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runRawSourceCertification } from "../../src/certification/runRawCertification.js";
import { evaluateMenuQualityContract } from "../../src/intelligence/qualityContract.js";
import { diagnoseSourceProductCoverage } from "../../src/intelligence/sourceCoverage.js";
import type { SourceAccounting } from "../../src/extraction/pdf/types.js";
import type { SourceMenu } from "../../src/domain/schema/source.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../src/domain/versions.js";

const root = process.cwd();
const rawPath = resolve(
  root,
  "fixtures/golden/bella-kebab/raw-source.jpeg",
);
const oracle = JSON.parse(
  readFileSync(
    resolve(root, "fixtures/golden/bella-kebab/expected-source-evidence.json"),
    "utf8",
  ),
) as {
  products: Array<{ name: string; priceOre: number }>;
  minimumPriceAnchors: number;
};

function sourceProducts(source: SourceMenu) {
  return source.categories.flatMap((category) =>
    category.products.map((product) => ({ category: category.name, product })),
  );
}

describe("Bella RAW PHOTO certification (production path)", () => {
  it(
    "recovers every reviewed price-anchored product without invented pizza",
    async () => {
      const result = await runRawSourceCertification({
        restaurantName: "Raw Photo Fixture",
        restaurantKey: "raw-photo-fixture.example",
        rawFilePath: rawPath,
        kind: "image",
        repoRoot: root,
      });
      const extracted = sourceProducts(result.sourceMenu as SourceMenu);
      const targetNames = new Set(result.semantic.products.map((p) => p.name));

      expect(result.sourceProductCount).toBe(oracle.products.length);
      expect(result.stats.targetProducts).toBe(oracle.products.length);
      for (const expected of oracle.products) {
        const source = extracted.find(
          ({ product }) => product.name === expected.name,
        )?.product;
        expect(source, expected.name).toBeTruthy();
        expect(source!.variants[0]?.sourceTotalPrice).toBe(expected.priceOre);
        expect(source!.evidence?.origin).toBe("SOURCE_LAYOUT");
        expect(targetNames.has(expected.name), expected.name).toBe(true);
      }

      const blob = JSON.stringify(result.targetMenu);
      expect(blob).not.toMatch(/Syttede sds/i);
      expect(result.targetMenu.categories.map((c) => c.name)).not.toContain(
        "PIZZA",
      );
      expect(
        result.targetMenu.categories
          .flatMap((c) => c.products)
          .every(
            (p) =>
              (p.basePrice ?? 0) > 0 &&
              p.basePriceOrigin !== "SYSTEM_DEFAULT",
          ),
      ).toBe(true);
      expect(result.stats.qualityBlocked).toBe(0);
    },
    180_000,
  );

  it(
    "is invariant to merchant and filename changes",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "photo-metamorphic-"));
      const renamed = join(dir, "completely-unrelated-menu-name.jpeg");
      copyFileSync(rawPath, renamed);
      try {
        const result = await runRawSourceCertification({
          restaurantName: "Another Merchant Name",
          restaurantKey: "another-host.example",
          rawFilePath: renamed,
          kind: "image",
          repoRoot: root,
        });
        const actual = result.semantic.products
          .map((p) => `${p.name}:${p.basePriceOre}`)
          .sort();
        const expected = oracle.products
          .map((p) => `${p.name}:${p.priceOre}`)
          .sort();
        expect(actual).toEqual(expected);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it("blocks the old garbage product/category/zero-price contract", () => {
    const menu: CanonicalMenu = {
      restaurantName: "Garbage fixture",
      categories: [
        {
          sourceId: "cat:bad",
          name: "PIZZA",
          sourceOrder: 0,
          commonIngredients: [],
          products: [
            {
              sourceId: "bad:1",
              categorySourceId: "cat:bad",
              name: "Syttede sds",
              sourceOrder: 0,
              basePrice: 0,
              basePriceOrigin: "SYSTEM_DEFAULT",
              ingredients: [],
              variants: [],
              addOns: [],
              productChoices: [],
              isCombo: false,
              status: "READY",
              issues: [],
            },
          ],
        },
      ],
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
      status: "READY",
      issues: [],
    };
    const quality = evaluateMenuQualityContract(menu);
    expect(quality.products[0]?.status).not.toBe("QUALITY_READY");
    expect(
      quality.products[0]?.checks.find((c) => c.id === "PRICE_SUPPORTED")?.pass,
    ).toBe(false);
  });

  it("keeps suspicious source coverage fail-closed", () => {
    const accounting: SourceAccounting = {
      sourceFile: "fixture.jpeg",
      generatedAt: new Date(0).toISOString(),
      entries: [],
      summary: {
        candidatesDetected: 1,
        extracted: 1,
        duplicateSourceEvidence: 0,
        manualReviewRequired: 0,
        blocked: 0,
        nonProduct: 0,
      },
    };
    const coverage = diagnoseSourceProductCoverage({
      accounting,
      uniqueProducts: 1,
      rawText: Array.from(
        { length: oracle.minimumPriceAnchors },
        (_, index) => `Product ${index + 1} Kr. ${50 + index}`,
      ).join("\n"),
    });
    expect(coverage.suspicious).toBe(true);
  });

  it("contains no fixture or merchant hardcoding in src", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") || path.endsWith(".tsx")) files.push(path);
      }
    };
    walk(resolve(root, "src"));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, basename(file)).not.toMatch(
        /bella(?:\s|-|_)?kebab|bellakebab|Syttede sds/i,
      );
    }
  });
});
