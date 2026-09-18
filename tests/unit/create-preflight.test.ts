import { describe, expect, it } from "vitest";
import {
  assessCreateIdentityAvailability,
  auditTahInputContract,
  findTargetMenuDuplicateMenuNumbers,
  findTargetMenuDuplicateNames,
  preflightCreateWrites,
} from "../../src/planning/createPreflight.js";
import type { PlannedProductPayload } from "../../src/runner/writePlan.js";

function payload(
  overrides: Partial<PlannedProductPayload> = {},
): PlannedProductPayload {
  return {
    sourceId: "src-1",
    menuNumber: "1",
    name: "Smash burger",
    description: "Oksekød, Salat",
    basePriceOre: 7500,
    categoryIds: ["7"],
    variants: [{ name: "Alm.", surchargeOre: 0 }],
    ingredients: ["Oksekød"],
    additions: [],
    intendedHidden: true,
    ...overrides,
  };
}

describe("create preflight", () => {
  it("detects exact and numeric-equivalent menu-number duplicates", () => {
    const hits = findTargetMenuDuplicateMenuNumbers([
      { sourceId: "a", menuNumber: "1", name: "One" },
      { sourceId: "b", menuNumber: "01", name: "Uno" },
      { sourceId: "c", menuNumber: "2", name: "Two" },
    ]);
    expect(hits.some((h) => h.sourceIds.includes("a") && h.sourceIds.includes("b"))).toBe(
      true,
    );
  });

  it("detects case/whitespace/unicode-normalized name duplicates", () => {
    const hits = findTargetMenuDuplicateNames([
      { sourceId: "a", menuNumber: "1", name: "Durum Menu" },
      { sourceId: "b", menuNumber: "2", name: " durum   menu " },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sourceIds).toEqual(["a", "b"]);
  });

  it("does not treat visible emptiness as identity availability", () => {
    expect(
      assessCreateIdentityAvailability({
        visibleDestinationProducts: 0,
        visibleMenuNumberConflicts: 0,
      }),
    ).toBe("UNKNOWN");
    const report = preflightCreateWrites({
      targetProducts: [{ sourceId: "a", menuNumber: "1", name: "Smash burger" }],
      destinationProducts: [],
    });
    expect(report.VISIBLE_DESTINATION_EMPTY).toBe(true);
    expect(report.CREATE_IDENTITY_AVAILABILITY).toBe("UNKNOWN");
    expect(report.ok).toBe(true);
  });

  it("blocks visible destination menu-number conflicts", () => {
    const report = preflightCreateWrites({
      targetProducts: [{ sourceId: "a", menuNumber: "22", name: "Durum menu" }],
      destinationProducts: [
        { databaseId: "7", menuNumber: "22", name: "Old durum" },
      ],
    });
    expect(report.VISIBLE_DESTINATION_MENU_NUMBER_CONFLICTS.length).toBe(1);
    expect(report.CREATE_IDENTITY_AVAILABILITY).toBe("CONFLICT");
    expect(report.ok).toBe(false);
  });

  it("classifies invalid input contract values without mutating them", () => {
    const hits = auditTahInputContract(
      payload({
        menuNumber: "  ",
        name: "Bad\u0007name",
        basePriceOre: -1,
        variants: [
          { name: "Alm.", surchargeOre: 0 },
          { name: "Alm.", surchargeOre: 0 },
        ],
      }),
    );
    expect(hits.some((h) => h.field === "menuNumber")).toBe(true);
    expect(hits.some((h) => h.field === "name")).toBe(true);
    expect(hits.some((h) => h.field === "basePriceOre")).toBe(true);
    expect(hits.some((h) => h.field === "variants.name")).toBe(true);
  });
});
