import { describe, expect, it } from "vitest";
import {
  assignMenuNumbers,
  nextDecadeBlockStart,
  parsePureIntegerMenuNumber,
} from "../../src/domain/numbering.js";
import { category, menu, product } from "./helpers.js";

describe("nextDecadeBlockStart", () => {
  it("starts first category at 1 and jumps decades after 4, 13, …", () => {
    expect(nextDecadeBlockStart(null)).toBe(1);
    expect(nextDecadeBlockStart(4)).toBe(10);
    expect(nextDecadeBlockStart(13)).toBe(20);
    expect(nextDecadeBlockStart(9)).toBe(10);
  });
});

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

  it("assigns decade blocks per category when the menu has no printed numbers", () => {
    const source = menu({
      restaurantName: "Smash",
      categories: [
        category({
          sourceId: "cat-burger",
          name: "GRILL",
          sourceOrder: 0,
          products: [
            product({ sourceId: "b1", name: "Classic", sourceOrder: 0 }),
            product({ sourceId: "b2", name: "Dirty", sourceOrder: 1 }),
            product({ sourceId: "b3", name: "Spice", sourceOrder: 2 }),
            product({ sourceId: "b4", name: "Bearnaise", sourceOrder: 3 }),
          ],
        }),
        category({
          sourceId: "cat-pizza",
          name: "PIZZA",
          sourceOrder: 1,
          products: [
            product({ sourceId: "p1", name: "Margherita", sourceOrder: 0 }),
            product({ sourceId: "p2", name: "Pepperoni", sourceOrder: 1 }),
          ],
        }),
        category({
          sourceId: "cat-drink",
          name: "DRIKKEVARER",
          sourceOrder: 2,
          products: [
            product({ sourceId: "d1", name: "Cola", sourceOrder: 0 }),
            product({ sourceId: "d2", name: "Fanta", sourceOrder: 1 }),
          ],
        }),
      ],
    });

    const result = assignMenuNumbers(source);
    const nums = result.products.map((p) => p.assignedMenuNumber);
    expect(nums).toEqual(["1", "2", "3", "4", "10", "11", "20", "21"]);
    expect(result.products.every((p) => p.wasGenerated)).toBe(true);
  });

  it("starts an unnumbered category at the next decade after printed numbers", () => {
    const source = menu({
      restaurantName: "Mixed",
      categories: [
        category({
          sourceId: "cat-burger",
          name: "GRILL",
          sourceOrder: 0,
          products: [
            product({
              sourceId: "b1",
              name: "Classic",
              sourceOrder: 0,
              sourceMenuNumber: "1",
            }),
            product({
              sourceId: "b2",
              name: "Dirty",
              sourceOrder: 1,
              sourceMenuNumber: "4",
            }),
          ],
        }),
        category({
          sourceId: "cat-pizza",
          name: "PIZZA",
          sourceOrder: 1,
          products: [
            product({ sourceId: "p1", name: "Margherita", sourceOrder: 0 }),
            product({ sourceId: "p2", name: "Pepperoni", sourceOrder: 1 }),
          ],
        }),
      ],
    });

    const result = assignMenuNumbers(source);
    expect(result.products[2]?.assignedMenuNumber).toBe("10");
    expect(result.products[3]?.assignedMenuNumber).toBe("11");
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
