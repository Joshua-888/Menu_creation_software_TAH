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

/**
 * Beef-leakage guard: a non-beef-named Asian dish must never carry oksekød.
 * Exported via the test module boundary for a synthetic negative check.
 */
export function flagsBeefLeakInNonBeefDish(
  name: string,
  ingredients: readonly string[],
): boolean {
  const isAsianDish = /pad thai|curry|wok|satay|tom yam/i.test(name);
  const namesBeef = /oksekoed|oksekød|beef/i.test(name);
  const hasBeef = ingredients.some((i) => /^oksekød$/i.test(i));
  return isAsianDish && !namesBeef && hasBeef;
}

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

      // Beef must not LEAK into non-beef Asian dishes. A dish whose own name
      // explicitly encodes beef (e.g. "Rod Curry Oksekoed") is allowed to carry
      // oksekød; the guard still fails for chicken/vegetarian/other non-beef
      // names that would wrongly pick up oksekød.
      for (const p of result.semantic.products) {
        expect(
          flagsBeefLeakInNonBeefDish(p.name, p.ingredients),
          `unexpected oksekød leakage into non-beef dish: ${p.name}`,
        ).toBe(false);
      }
    },
    180_000,
  );

  it("guard still flags oksekød leakage into a non-beef-named curry (synthetic)", () => {
    // Negative control: the narrowed guard must NOT become a rubber stamp.
    expect(
      flagsBeefLeakInNonBeefDish("Gron Curry Kylling", ["Kokosmaelk", "Oksekød"]),
    ).toBe(true);
    expect(
      flagsBeefLeakInNonBeefDish("Vegetar Curry", ["Oksekød"]),
    ).toBe(true);
    // Beef-named dish is legitimately allowed to carry oksekød.
    expect(
      flagsBeefLeakInNonBeefDish("Rod Curry Oksekoed", ["Oksekød"]),
    ).toBe(false);
  });
});
