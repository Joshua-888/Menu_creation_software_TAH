import { describe, expect, it } from "vitest";
import { runDomainEngine } from "../../src/domain/engine.js";
import { applyPizzaToppingRecovery } from "../../src/planning/applyPizzaToppingRecovery.js";
import { category, menu, product, variant } from "../domain/helpers.js";

describe("M79 pizza topping recovery → domain status", () => {
  it("clears MISSING_SOURCE_SUPPORTED_INGREDIENTS after description recovery", () => {
    const source = menu({
      restaurantName: "Veroni",
      categories: [
        category({
          sourceId: "cat-pizza",
          name: "Pizza",
          sourceOrder: 0,
          products: [
            product({
              sourceId: "p-hot",
              name: "Hotchicken",
              sourceOrder: 0,
              description: "Tomat, ost, kylling, ketchup",
              sourceMenuNumber: "12",
              variants: [variant("v1", "Alm.", { totalKroner: 89 })],
              ingredients: [],
            }),
          ],
        }),
      ],
    });

    const domain = runDomainEngine(source);
    const before = domain.menu.categories[0]!.products[0]!;
    expect(before.ingredients).toHaveLength(0);
    expect(
      before.issues.some((i) => i.code === "MISSING_SOURCE_SUPPORTED_INGREDIENTS"),
    ).toBe(true);
    expect(before.status).toBe("MANUAL_REVIEW_REQUIRED");

    const recovered = applyPizzaToppingRecovery(domain.menu);
    const after = recovered.menu.categories[0]!.products[0]!;
    expect(after.ingredients.map((i) => i.display)).toEqual([
      "Tomat",
      "Ost",
      "Kylling",
    ]);
    expect(after.ingredients.every((i) => i.origin === "DERIVED")).toBe(true);
    expect(
      after.issues.some((i) => i.code === "MISSING_SOURCE_SUPPORTED_INGREDIENTS"),
    ).toBe(false);
    expect(after.status).not.toBe("MANUAL_REVIEW_REQUIRED");
    expect(recovered.recovered).toHaveLength(1);
    expect(recovered.recovered[0]!.proposal.excludedDips.map((d) => d.toLowerCase())).toContain(
      "ketchup",
    );
  });

  it("does not invent toppings without a description list", () => {
    const source = menu({
      restaurantName: "Veroni",
      categories: [
        category({
          sourceId: "cat-pizza",
          name: "Pizza",
          sourceOrder: 0,
          products: [
            product({
              sourceId: "p-x",
              name: "Mystery",
              sourceOrder: 0,
              description: "Vores klassiker",
              sourceMenuNumber: "13",
              variants: [variant("v1", "Alm.", { totalKroner: 89 })],
              ingredients: [],
            }),
          ],
        }),
      ],
    });
    const domain = runDomainEngine(source);
    const recovered = applyPizzaToppingRecovery(domain.menu);
    const p = recovered.menu.categories[0]!.products[0]!;
    expect(p.ingredients).toHaveLength(0);
    expect(
      p.issues.some((i) => i.code === "MISSING_SOURCE_SUPPORTED_INGREDIENTS"),
    ).toBe(true);
    expect(recovered.recovered).toHaveLength(0);
  });
});
