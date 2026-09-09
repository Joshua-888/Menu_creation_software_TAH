import { describe, expect, it } from "vitest";
import { composeIngredients } from "../../src/domain/ingredients.js";
import { ing } from "./helpers.js";

describe("composeIngredients", () => {
  it("merges category and product ingredients with case-insensitive dedup", () => {
    const result = composeIngredients(
      [ing("Tomat"), ing("ost")],
      [ing("Ost"), ing("skinke"), ing("ananas")],
    );
    expect(result.map((i) => i.display)).toEqual([
      "Tomat",
      "ost",
      "skinke",
      "ananas",
    ]);
  });

  it("dedupes whitespace-insensitively and keeps first display", () => {
    const result = composeIngredients(
      [ing("Tomato  sauce")],
      [ing("tomato sauce"), ing("Basil")],
    );
    expect(result.map((i) => i.display)).toEqual(["Tomato  sauce", "Basil"]);
  });

  it("does not invent ingredients", () => {
    expect(composeIngredients([], [])).toEqual([]);
  });
});
