/**
 * WP2 — field-requirement matrix.
 *
 * Isolated unit coverage for `getFieldRequirements`: verifies the matrix is the
 * single authoritative requirement source, is exhaustive over the family
 * taxonomy, deterministic, and free of self-contradictions. Nothing here wires
 * the matrix into runtime — that is a later WP.
 */

import { describe, expect, it } from "vitest";
import {
  getFieldRequirements,
  ALL_FIELD_NAMES,
  type FieldName,
} from "../../../src/intelligence/fieldRequirements.js";
import {
  ALL_PRODUCT_FAMILIES,
  type ProductFamily,
} from "../../../src/intelligence/peerCohorts.js";
import type { FieldRequirementLevel } from "../../../src/intelligence/types.js";

const LEVELS: FieldRequirementLevel[] = [
  "REQUIRED",
  "EXPECTED",
  "CONDITIONAL",
  "OPTIONAL",
  "FORBIDDEN",
  "NOT_APPLICABLE",
];

function expectFullMatrix(levels: Record<FieldName, FieldRequirementLevel>): void {
  for (const field of ALL_FIELD_NAMES) {
    expect(LEVELS).toContain(levels[field]);
  }
  expect(Object.keys(levels).sort()).toEqual([...ALL_FIELD_NAMES].sort());
}

describe("WP2 field requirement matrix", () => {
  it("covers every family in the taxonomy with a complete matrix", () => {
    for (const family of ALL_PRODUCT_FAMILIES) {
      expectFullMatrix(getFieldRequirements(family));
    }
  });

  it("keeps category, name and basePrice REQUIRED for all families", () => {
    for (const family of ALL_PRODUCT_FAMILIES) {
      const matrix = getFieldRequirements(family);
      expect(matrix.category, family).toBe("REQUIRED");
      expect(matrix.name, family).toBe("REQUIRED");
      expect(matrix.basePrice, family).toBe("REQUIRED");
    }
  });

  it("keeps menuNumber EXPECTED for all families (schema leaves it optional)", () => {
    for (const family of ALL_PRODUCT_FAMILIES) {
      expect(getFieldRequirements(family).menuNumber, family).toBe("EXPECTED");
    }
  });

  it("BURGER matches the Architect matrix", () => {
    const m = getFieldRequirements("BURGER");
    expect(m.ingredients).toBe("REQUIRED");
    expect(m.description).toBe("REQUIRED");
    expect(m.additions).toBe("EXPECTED");
    expect(m.variants).toBe("CONDITIONAL");
    expect(m.comboComponents).toBe("NOT_APPLICABLE");
    expect(m.productChoices).toBe("NOT_APPLICABLE");
  });

  it("PIZZA matches the Architect matrix", () => {
    const m = getFieldRequirements("PIZZA");
    expect(m.ingredients).toBe("REQUIRED");
    expect(m.description).toBe("REQUIRED");
    expect(m.variants).toBe("EXPECTED");
    expect(m.additions).toBe("EXPECTED");
    expect(m.comboComponents).toBe("NOT_APPLICABLE");
  });

  it("DRINK is non-food: no ingredients, no food additions", () => {
    const m = getFieldRequirements("DRINK");
    expect(m.ingredients).toBe("NOT_APPLICABLE");
    expect(m.additions).toBe("FORBIDDEN");
    expect(m.additionPrices).toBe("NOT_APPLICABLE");
    expect(m.description).toBe("OPTIONAL");
    expect(m.variants).toBe("CONDITIONAL");
  });

  it("COMBO_MENU requires combo components and forbids Menu-as-variant", () => {
    const m = getFieldRequirements("COMBO_MENU");
    expect(m.comboComponents).toBe("REQUIRED");
    expect(m.productChoices).toBe("CONDITIONAL");
    expect(m.variants).toBe("FORBIDDEN");
  });

  it("DURUM and PASTA are food families with REQUIRED ingredients", () => {
    expect(getFieldRequirements("DURUM").ingredients).toBe("REQUIRED");
    expect(getFieldRequirements("DURUM").comboComponents).toBe("NOT_APPLICABLE");
    expect(getFieldRequirements("PASTA").ingredients).toBe("REQUIRED");
  });

  it("contains no self-contradicting fields (FORBIDDEN never coexists with REQUIRED/EXPECTED intent)", () => {
    // A single field holds exactly one level, so verify the deliberate
    // contradictions never appear: a FORBIDDEN field must not be a food-family
    // REQUIRED field such as ingredients or additions for the same family.
    for (const family of ALL_PRODUCT_FAMILIES) {
      const m = getFieldRequirements(family);
      expect(m.ingredients, family).not.toBe("FORBIDDEN");
      // DRINK/COMBO-style additions must be either offerable or forbidden,
      // never both and never REQUIRED by accident on non-food families.
      if (family === "DRINK") {
        expect(m.additions).toBe("FORBIDDEN");
        expect(m.ingredients).toBe("NOT_APPLICABLE");
      }
      if (family === "COMBO_MENU") {
        expect(m.variants).toBe("FORBIDDEN");
        expect(m.comboComponents).toBe("REQUIRED");
      }
    }
  });

  it("returns a fresh copy each call (callers cannot corrupt the matrix)", () => {
    const first = getFieldRequirements("BURGER");
    first.additions = "FORBIDDEN";
    const second = getFieldRequirements("BURGER");
    expect(second.additions).toBe("EXPECTED");
  });

  it("is deterministic for the same family/subtype", () => {
    const families: ProductFamily[] = ["BURGER", "PIZZA", "DRINK", "PASTA"];
    for (const family of families) {
      expect(getFieldRequirements(family)).toEqual(getFieldRequirements(family));
      expect(getFieldRequirements(family, "alm")).toEqual(
        getFieldRequirements(family, "alm"),
      );
    }
  });
});
