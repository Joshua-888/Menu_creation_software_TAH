import { describe, expect, it } from "vitest";
import { composeIngredients } from "../../src/domain/ingredients.js";
import { ing } from "./helpers.js";

describe("composeIngredients", () => {
  it("merges category and product ingredients with case-insensitive dedup and capitalize", () => {
    const result = composeIngredients(
      [ing("Tomat"), ing("ost")],
      [ing("Ost"), ing("skinke"), ing("ananas")],
    );
    expect(result.map((i) => i.display)).toEqual([
      "Tomat",
      "Ost",
      "Skinke",
      "Ananas",
    ]);
  });

  it("dedupes whitespace-insensitively and keeps first display after hygiene", () => {
    const result = composeIngredients(
      [ing("Tomato  sauce")],
      [ing("tomato sauce"), ing("Basil")],
    );
    expect(result.map((i) => i.display)).toEqual(["Tomato sauce", "Basil"]);
  });

  it("does not invent ingredients", () => {
    expect(composeIngredients([], [])).toEqual([]);
  });

  it("strips price bleed from composed ingredients", () => {
    const result = composeIngredients([], [ing("dressing 95"), ing("salat")]);
    expect(result.map((i) => i.display)).toEqual(["Dressing", "Salat"]);
  });
});
