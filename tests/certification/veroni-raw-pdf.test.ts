/**
 * Veroni RAW PDF certification — production extract → intelligence.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runRawSourceCertification,
  canonicalToSemantic,
} from "../../src/certification/runRawCertification.js";
import { compareSemanticMenus } from "../../src/certification/semanticComparator.js";
import { isForbiddenMenuVariantName } from "../../src/learning/categorySizeVariantPolicy.js";
import { assertStatusAccounting } from "../../src/intelligence/explainNonReady.js";

const root = process.cwd();
const rawPath = resolve(
  root,
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const goldenV2 = JSON.parse(
  readFileSync(
    resolve(root, "fixtures/golden/veroni/VERONI_GOLDEN_V2.json"),
    "utf8",
  ),
) as {
  products: Array<{
    name: string;
    category: string;
    ingredients: string[];
    variants: string[];
    additions: Array<{ name: string }>;
    isCombo?: boolean;
  }>;
  targetProductCount: number;
  statusAccounting?: {
    ready: number;
    review: number;
    blocked: number;
    productCount: number;
  };
};

describe("Veroni RAW PDF certification (production path)", () => {
  it(
    "extracts from raw PDF with zero Menu variants, reconciled statuses, Golden V2 PASS",
    async () => {
      const result = await runRawSourceCertification({
        restaurantName: "Veroni Fixture",
        restaurantKey: "fixture-veroni.example",
        rawFilePath: rawPath,
        kind: "pdf",
        repoRoot: root,
      });

      expect(result.pageCount).toBeGreaterThan(0);
      expect(result.sourceProductCount).toBeGreaterThan(50);
      expect(result.menuVariantCount).toBe(0);
      assertStatusAccounting(result.intelligence.quality);
      expect(result.stats.statusAccounting.reconciles).toBe(true);
      expect(
        result.stats.statusAccounting.ready +
          result.stats.statusAccounting.review +
          result.stats.statusAccounting.blocked,
      ).toBe(result.stats.statusAccounting.productCount);
      if (goldenV2.statusAccounting) {
        expect(result.stats.statusAccounting.ready).toBe(
          goldenV2.statusAccounting.ready,
        );
        expect(result.stats.statusAccounting.review).toBe(
          goldenV2.statusAccounting.review,
        );
        expect(result.stats.statusAccounting.blocked).toBe(
          goldenV2.statusAccounting.blocked,
        );
      }
      if ((result.stats.statusAccounting.blocked ?? 0) > 0) {
        expect(result.stats.menuStatus).toBe("MENU_QUALITY_BLOCKED");
        expect(
          result.intelligence.quality.products.some((product) =>
            product.checks.some(
              (check) => check.id === "PRICE_SUPPORTED" && !check.pass,
            ),
          ),
        ).toBe(true);
      } else if ((result.stats.statusAccounting.review ?? 0) > 0) {
        // Unresolved non-burger Menu combos stay REVIEW.
        expect(result.stats.menuStatus).toBe("MENU_QUALITY_REVIEW");
      }

      for (const p of result.semantic.products) {
        for (const v of p.variants) {
          expect(isForbiddenMenuVariantName(v)).toBe(false);
        }
      }

      const blob = JSON.stringify(result.semantic);
      expect(blob).not.toMatch(/Dirty Smash|Classic Smash|Crunch Murphy/);
      expect(result.intelligence.constitutionVersion).toBe("MenuConstitutionV1");

      const cmp = compareSemanticMenus(
        {
          products: goldenV2.products.map((p) => {
            const item: {
              name: string;
              category: string;
              ingredients: string[];
              variants: string[];
              additions: Array<{ name: string }>;
              isCombo?: boolean;
            } = {
              name: p.name,
              category: p.category,
              ingredients: p.ingredients,
              variants: p.variants,
              additions: p.additions,
            };
            if (p.isCombo != null) item.isCombo = p.isCombo;
            return item;
          }),
        },
        canonicalToSemantic(result.targetMenu),
        { requireExactIngredients: false },
      );
      expect(cmp.ok, JSON.stringify(cmp.mismatches.slice(0, 5))).toBe(true);
      expect(result.stats.targetProducts).toBe(goldenV2.targetProductCount);
    },
    300_000,
  );
});
