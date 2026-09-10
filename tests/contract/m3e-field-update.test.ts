import { describe, expect, it } from "vitest";
import {
  ADMIN_CONTRACT_V1,
  assertExactlyAllowedSemanticDiff,
  assertPlanAllowsOnly,
  createDescriptionUpdatePlan,
  mayRetryOpdaterAfterAmbiguousResult,
  semanticDiff,
  type SemanticProductSnapshot,
} from "../../src/tah/index.js";

const baseSnap = (): SemanticProductSnapshot => ({
  menuNumber: "99001",
  name: "__TAH_CANARY_PRODUCT_M3__",
  description: "Automated TakeAwayHero inactive canary test",
  basePriceOre: 9900,
  basePriceRaw: "99",
  categoryIds: ["1"],
  variants: [{ databaseId: "17", name: "Alm.", priceOre: 0, priceRaw: "0" }],
  ingredients: [
    { databaseId: "1", name: "Test ingredient A" },
    { databaseId: "2", name: "Test ingredient B" },
  ],
  additions: [],
});

describe("M3E controlled field update plan", () => {
  it("allows only description in the immutable plan", () => {
    const plan = createDescriptionUpdatePlan({
      databaseId: "18",
      expectedBeforeDescription: "old",
      expectedAfterDescription: "Automated TakeAwayHero canary test v2",
      preserved: { name: "__TAH_CANARY_PRODUCT_M3__" },
    });
    expect(plan.immutable).toBe(true);
    expect(plan.action).toBe("UPDATE_PRODUCT");
    expect(plan.allowedChanges).toEqual(["description"]);
    assertPlanAllowsOnly(plan, ["description"]);
    expect(plan.mustPreserve).toContain("variants");
    expect(plan.expectedAfter.description).toBe(
      "Automated TakeAwayHero canary test v2",
    );
  });

  it("requires exactly one semantic field diff for description update", () => {
    const before = baseSnap();
    const after = {
      ...baseSnap(),
      description: "Automated TakeAwayHero canary test v2",
    };
    const diffs = semanticDiff(before, after);
    expect(diffs).toEqual(["description"]);
    expect(assertExactlyAllowedSemanticDiff(diffs, ["description"]).ok).toBe(
      true,
    );
  });

  it("fails VERIFY when unauthorized fields change", () => {
    const before = baseSnap();
    const after = {
      ...baseSnap(),
      description: "Automated TakeAwayHero canary test v2",
      basePriceRaw: "100",
      basePriceOre: 10000,
    };
    const diffs = semanticDiff(before, after);
    const check = assertExactlyAllowedSemanticDiff(diffs, ["description"]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.unauthorized).toEqual(
        expect.arrayContaining(["basePriceOre", "basePriceRaw"]),
      );
    }
  });

  it("fails when expected description did not persist", () => {
    const before = baseSnap();
    const after = baseSnap(); // no change
    const diffs = semanticDiff(before, after);
    expect(diffs).toEqual([]);
    const check = assertExactlyAllowedSemanticDiff(diffs, ["description"]);
    expect(check.ok).toBe(false);
  });

  it("forbids blind Opdater retry after ambiguous result", () => {
    expect(mayRetryOpdaterAfterAmbiguousResult()).toBe(false);
  });

  it("does not certify unrestricted updateProduct from description attempt", () => {
    expect(ADMIN_CONTRACT_V1.capabilities.write.updateProduct).toBe(
      "UNCERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.setProductHidden).toBe(
      "UNCERTIFIED",
    );
  });
});
