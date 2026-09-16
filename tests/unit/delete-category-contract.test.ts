import { describe, expect, it } from "vitest";
import {
  interpretCategoryDeleteReadBack,
  isCategoryDeletePath,
} from "../../src/tah/write/categoryDeleteObserve.js";
import { M2B_ADAPTER_CAPABILITIES } from "../../src/tah/contracts/evidence.js";
import { CANARY_NAMES } from "../../src/tah/write/types.js";

describe("deleteCategory contract helpers", () => {
  it("matches exact database id path", () => {
    expect(isCategoryDeletePath("/admin/categories/13", "13")).toBe(true);
    expect(isCategoryDeletePath("/admin/categories/13/", "13")).toBe(true);
    expect(isCategoryDeletePath("/admin/categories", "13")).toBe(false);
    expect(isCategoryDeletePath("/admin/categories/13/edit", "13")).toBe(false);
    expect(isCategoryDeletePath("/admin/categories/99", "13")).toBe(false);
  });

  it("interprets read-back idempotently without assuming HTTP success", () => {
    expect(
      interpretCategoryDeleteReadBack({
        databaseId: "13",
        categoriesAfter: [{ databaseId: "1" }, { databaseId: "2" }],
        responseStatus: 500,
      }),
    ).toBe("VERIFIED_DELETED");
    expect(
      interpretCategoryDeleteReadBack({
        databaseId: "13",
        categoriesAfter: [{ databaseId: "13" }],
        responseStatus: 200,
      }),
    ).toBe("DELETE_FAILED");
    expect(
      interpretCategoryDeleteReadBack({
        databaseId: "13",
        categoriesAfter: [{ databaseId: "13" }],
        responseStatus: 500,
      }),
    ).toBe("AMBIGUOUS");
  });

  it("exposes CERTIFIED deleteCategory after M80 canary evidence", () => {
    expect(M2B_ADAPTER_CAPABILITIES.write.deleteCategory).toBe("CERTIFIED");
    expect(CANARY_NAMES.categoryDelete).toMatch(/^__TAH_CANARY_/);
  });
});
