import { describe, expect, it } from "vitest";
import {
  assignMenuNumbers,
  parsePureIntegerMenuNumber,
} from "../../src/domain/numbering.js";
import { category, menu, product } from "./helpers.js";

describe("parsePureIntegerMenuNumber", () => {
  it("accepts pure integers including leading zeros as numeric value", () => {
    expect(parsePureIntegerMenuNumber("01")).toBe(1);
    expect(parsePureIntegerMenuNumber("205")).toBe(205);
  });

  it("rejects alphanumeric and does not use numeric prefix", () => {
    expect(parsePureIntegerMenuNumber("220A")).toBeNull();
    expect(parsePureIntegerMenuNumber("A12")).toBeNull();
  });
});

describe("assignMenuNumbers", () => {
  it("preserves alphanumeric and leading-zero source numbers exactly", () => {
    const source = menu({
      restaurantName: "Test",
      categories: [
        category({
          sourceId: "cat-1",
          name: "Pizza",
          sourceOrder: 1,
          products: [
            product({
              sourceId: "p1",
              name: "A",
              sourceOrder: 1,
              sourceMenuNumber: "01",
            }),
            product({
              sourceId: "p2",
              name: "B",
              sourceOrder: 2,
              sourceMenuNumber: "220A",
            }),
          ],
        }),
      ],
    });

    const result = assignMenuNumbers(source);
    expect(result.products[0]?.assignedMenuNumber).toBe("01");
    expect(result.products[1]?.assignedMenuNumber).toBe("220A");
  });

  it("ignores alphanumeric when computing highest numeric (198,199,220A,205 → next 206)", () => {
    const source = menu({
      restaurantName: "Test",
      categories: [
        category({
          sourceId: "cat-1",
          name: "Pizza",
          sourceOrder: 1,
          products: [
            product({
              sourceId: "p1",
              name: "A",
              sourceOrder: 1,
              sourceMenuNumber: "198",
            }),
            product({
              sourceId: "p2",
              name: "B",
              sourceOrder: 2,
              sourceMenuNumber: "199",
            }),
            product({
              sourceId: "p3",
              name: "C",
              sourceOrder: 3,
              sourceMenuNumber: "220A",
            }),
            product({
              sourceId: "p4",
              name: "D",
              sourceOrder: 4,
              sourceMenuNumber: "205",
            }),
            product({
              sourceId: "p5",
              name: "E",
              sourceOrder: 5,
            }),
          ],
        }),
      ],
    });

    const result = assignMenuNumbers(source);
    expect(result.highestExistingNumeric).toBe(205);
    expect(result.products[4]?.assignedMenuNumber).toBe("206");
    expect(result.products[4]?.wasGenerated).toBe(true);
  });

  it("uses numeric high value appearing late in source order", () => {
    const source = menu({
      restaurantName: "Test",
      categories: [
        category({
          sourceId: "cat-1",
          name: "Pizza",
          sourceOrder: 1,
          products: [
            product({ sourceId: "p1", name: "A", sourceOrder: 1 }),
            product({ sourceId: "p2", name: "B", sourceOrder: 2 }),
            product({
              sourceId: "p3",
              name: "C",
              sourceOrder: 3,
              sourceMenuNumber: "87",
            }),
          ],
        }),
      ],
    });

    const result = assignMenuNumbers(source);
    expect(result.highestExistingNumeric).toBe(87);
    expect(result.products[0]?.assignedMenuNumber).toBe("88");
    expect(result.products[1]?.assignedMenuNumber).toBe("89");
    expect(result.products[2]?.assignedMenuNumber).toBe("87");
  });

  it("detects duplicate source display numbers", () => {
    const source = menu({
      restaurantName: "Test",
      categories: [
        category({
          sourceId: "cat-1",
          name: "Pizza",
          sourceOrder: 1,
          products: [
            product({
              sourceId: "p1",
              name: "A",
              sourceOrder: 1,
              sourceMenuNumber: "10",
            }),
            product({
              sourceId: "p2",
              name: "B",
              sourceOrder: 2,
              sourceMenuNumber: "10",
            }),
          ],
        }),
      ],
    });

    const result = assignMenuNumbers(source);
    expect(result.sourceDuplicateNumbers).toEqual(["10"]);
  });
});
