/**
 * Certification: RAW Smash photo → production extract → MenuIntelligenceEngine.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runRawSourceCertification } from "../../src/certification/runRawCertification.js";
import { isForbiddenMenuVariantName } from "../../src/learning/categorySizeVariantPolicy.js";

const root = process.cwd();
const rawPath = resolve(root, "fixtures/golden/smash/raw-source.jpg");
const oracle = JSON.parse(
  readFileSync(
    resolve(root, "fixtures/golden/smash/expected-final-menu.json"),
    "utf8",
  ),
) as {
  burgerProducts: string[];
  menuerProducts: string[];
  burgersCategory: string;
  acceptance: { menuVariantCount: number; burgerMinIngredients: number };
};

describe("Smash RAW PHOTO certification (production path)", () => {
  it(
    "extracts and intelligences from raw bytes without merchant hardcoding",
    async () => {
      const result = await runRawSourceCertification({
        restaurantName: "Smash Fixture",
        restaurantKey: "fixture-smash.example",
        rawFilePath: rawPath,
        kind: "image",
        repoRoot: root,
      });

      expect(result.sourceProductCount).toBeGreaterThan(0);
      expect(result.menuVariantCount).toBe(0);

      for (const name of oracle.burgerProducts) {
        const p = result.semantic.products.find((x) => x.name === name);
        expect(p, name).toBeTruthy();
        expect(p!.category).toBe(oracle.burgersCategory);
        expect(p!.ingredients.length).toBeGreaterThanOrEqual(
          oracle.acceptance.burgerMinIngredients,
        );
        expect((p!.description ?? "").length).toBeGreaterThan(0);
        expect(p!.variants.every((v) => !isForbiddenMenuVariantName(v))).toBe(
          true,
        );
      }

      for (const name of oracle.menuerProducts) {
        const p = result.semantic.products.find((x) => x.name === name);
        expect(p, name).toBeTruthy();
        expect(p!.category.toLowerCase()).toMatch(/menuer/);
        expect(p!.variants.every((v) => !isForbiddenMenuVariantName(v))).toBe(
          true,
        );
      }

      const blob = JSON.stringify(result.intelligence.policyTraces);
      expect(blob).not.toMatch(/if\s*\(.*smashmburger/i);
      expect(result.stats.menuStatus).not.toBe("MENU_QUALITY_BLOCKED");
    },
    180_000,
  );
});
