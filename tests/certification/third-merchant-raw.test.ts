/**
 * Third-merchant RAW PDF — realistic Thai takeaway; no burger/Veroni leak.
 */

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { runRawSourceCertification } from "../../src/certification/runRawCertification.js";
import { assertStatusAccounting } from "../../src/intelligence/explainNonReady.js";

const root = process.cwd();
const rawPath = resolve(
  root,
  "fixtures/golden/third-merchant/raw-source.pdf",
);

describe("Third merchant RAW PDF certification (Thai takeaway)", () => {
  it(
    "runs production path with realistic product count and no leakage",
    async () => {
      const result = await runRawSourceCertification({
        restaurantName: "Fixture Thai House",
        restaurantKey: "fixture-thai.example",
        rawFilePath: rawPath,
        kind: "pdf",
        repoRoot: root,
      });

      assertStatusAccounting(result.intelligence.quality);
      expect(result.stats.statusAccounting.reconciles).toBe(true);
      expect(
        result.stats.statusAccounting.ready +
          result.stats.statusAccounting.review +
          result.stats.statusAccounting.blocked,
      ).toBe(result.stats.statusAccounting.productCount);

      expect(result.sourceProductCount).toBeGreaterThanOrEqual(10);
      expect(result.stats.targetProducts).toBeGreaterThanOrEqual(8);
      expect(result.menuVariantCount).toBe(0);
      expect(result.stats.statusAccounting.blocked).toBe(0);
      expect(result.stats.menuStatus).toBe("MENU_QUALITY_READY");

      const blob = JSON.stringify(result.targetMenu);
      expect(blob).not.toMatch(
        /Dirty Smash|Classic Smash|veronipizza|Salatmayonnaise/i,
      );

      for (const p of result.semantic.products) {
        if (
          /\b(cola|fanta|vand|iste)\b/i.test(p.name) ||
          /drikke/i.test(p.category)
        ) {
          expect(
            p.additions.some((a) =>
              /mayo|ketchup|remoulade|salatmayonnaise/i.test(a.name),
            ),
          ).toBe(false);
        }
      }

      for (const p of result.semantic.products) {
        if (/pad thai|curry|wok|satay|tom yam/i.test(p.name)) {
          expect(p.ingredients.some((i) => /^oksekød$/i.test(i))).toBe(false);
        }
      }
    },
    180_000,
  );
});
