import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runDomainEngine } from "../../src/domain/engine.js";
import {
  assignMenuNumbers,
  parsePureIntegerMenuNumber,
} from "../../src/domain/numbering.js";
import { priceVariants } from "../../src/domain/pricing.js";
import { category, menu, product, variant } from "./helpers.js";

describe("property: numbering", () => {
  it("preserves existing source numbers, generates unique after highest numeric, in order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 12 }),
            sourceMenuNumber: fc.option(
              fc.oneof(
                fc.integer({ min: 1, max: 50 }).map(String),
                fc.constantFrom("220A", "A12", "01", "99B"),
              ),
              { nil: undefined },
            ),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (rows) => {
          // Ensure unique sourceIds
          const products = rows.map((row, index) =>
            product({
              sourceId: `${row.id}-${index}`,
              name: row.name,
              sourceOrder: index + 1,
              ...(row.sourceMenuNumber !== undefined
                ? { sourceMenuNumber: row.sourceMenuNumber }
                : {}),
              ingredients: [{ display: "Salt", origin: "SOURCE" }],
              variants: [variant(`v-${index}`, "Alm.", { totalKroner: 50 })],
            }),
          );

          const source = menu({
            restaurantName: "Prop",
            categories: [
              category({
                sourceId: "cat",
                name: "Cat",
                sourceOrder: 1,
                products,
              }),
            ],
          });

          const before = JSON.stringify(source);
          const numbering = assignMenuNumbers(source);
          expect(JSON.stringify(source)).toBe(before);

          for (const n of numbering.products) {
            if (
              n.sourceMenuNumber !== undefined &&
              n.sourceMenuNumber.trim().length > 0
            ) {
              expect(n.assignedMenuNumber).toBe(n.sourceMenuNumber.trim());
              expect(n.wasGenerated).toBe(false);
            }
          }

          const preserved = numbering.products.filter((p) => !p.wasGenerated);
          const generated = numbering.products.filter((p) => p.wasGenerated);
          const preservedSet = new Set(
            preserved.map((p) => p.assignedMenuNumber),
          );
          const generatedAssigned = generated.map((p) => p.assignedMenuNumber);

          // Generated numbers must be unique and must not collide with preserved source numbers.
          expect(new Set(generatedAssigned).size).toBe(generatedAssigned.length);
          for (const g of generatedAssigned) {
            expect(preservedSet.has(g)).toBe(false);
          }

          const highest = numbering.highestExistingNumeric;
          for (const g of generated) {
            const num = parsePureIntegerMenuNumber(g.assignedMenuNumber);
            expect(num).not.toBeNull();
            if (highest !== null && num !== null) {
              expect(num).toBeGreaterThan(highest);
            }
          }

          // Generated numbers follow source order among generated products
          const genNums = generated.map((g) =>
            parsePureIntegerMenuNumber(g.assignedMenuNumber),
          );
          for (let i = 1; i < genNums.length; i++) {
            expect(genNums[i]!).toBeGreaterThan(genNums[i - 1]!);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("property: pricing identity", () => {
  it("basePrice + surcharge === sourceTotalPrice for total-based variants", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 200 }),
        fc.integer({ min: 0, max: 150 }),
        fc.integer({ min: 0, max: 200 }),
        (baseK, deepExtra, famExtra) => {
          const variants = [
            variant("alm", "Alm.", { totalKroner: baseK }),
            variant("deep", "Deep", { totalKroner: baseK + deepExtra }),
            variant("fam", "Family", { totalKroner: baseK + famExtra }),
          ];
          const priced = priceVariants("p", variants, "alm");
          expect(priced.basePrice).toBe(baseK * 100);
          for (const v of priced.variants) {
            if (v.sourceTotalPrice !== undefined && priced.basePrice !== undefined) {
              expect(priced.basePrice + v.surcharge).toBe(v.sourceTotalPrice);
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("property: purity and determinism of engine", () => {
  it("does not mutate input and is deterministic", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (n) => {
        const source = menu({
          restaurantName: "Prop",
          categories: [
            category({
              sourceId: "c1",
              name: "Pizza",
              sourceOrder: 1,
              commonIngredients: [{ display: "Tomat", origin: "SOURCE" }],
              products: [
                product({
                  sourceId: "p1",
                  name: "Item",
                  sourceOrder: 1,
                  sourceMenuNumber: String(n),
                  ingredients: [{ display: "Ost", origin: "SOURCE" }],
                  variants: [
                    variant("alm", "Alm.", { totalKroner: 80 + n }),
                    variant("fam", "Familie", { totalKroner: 120 + n }),
                  ],
                }),
              ],
            }),
          ],
        });

        const before = JSON.stringify(source);
        const a = runDomainEngine(source);
        const mid = JSON.stringify(source);
        const b = runDomainEngine(source);
        expect(mid).toBe(before);
        expect(JSON.stringify(source)).toBe(before);
        expect(JSON.stringify(a.menu)).toBe(JSON.stringify(b.menu));
      }),
      { numRuns: 25 },
    );
  });
});
