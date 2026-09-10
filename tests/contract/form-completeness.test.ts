import { describe, expect, it } from "vitest";
import { ErrorCategory } from "../../src/domain/errors.js";
import {
  ADMIN_CONTRACT_V1,
  DYNAMIC_ROW_COMPLETENESS_REQUIRED,
  countsFromWritePlan,
  missingFieldsForRow,
  unintendedBlankRows,
  validateAdminFormBeforeSubmit,
  validateInstantiatedRowsComplete,
} from "../../src/tah/index.js";
import type {
  AdminFormCompletenessSnapshot,
  AdminFormRowSnapshot,
  WritePlanDynamicCollections,
} from "../../src/tah/write/formCompleteness.js";

function row(
  partial: Partial<AdminFormRowSnapshot> & { name: string },
): AdminFormRowSnapshot {
  const out: AdminFormRowSnapshot = {
    name: partial.name,
    databaseId: partial.databaseId ?? null,
    isBlueprint: partial.isBlueprint ?? false,
    isInstantiated: partial.isInstantiated ?? true,
  };
  if (partial.price !== undefined) out.price = partial.price;
  return out;
}

function snap(
  overrides: Partial<AdminFormCompletenessSnapshot> = {},
): AdminFormCompletenessSnapshot {
  return {
    menuNumber: "99001",
    name: "__TAH_CANARY_PRODUCT_M3__",
    description: "Automated TakeAwayHero inactive canary test",
    basePrice: "0",
    categoryIds: ["1"],
    variants: [row({ name: "Alm.", price: "0" })],
    ingredients: [
      row({ name: "Test ingredient A" }),
      row({ name: "Test ingredient B" }),
    ],
    additions: [],
    nativeCheckValidity: true,
    ...overrides,
  };
}

describe("DYNAMIC_ROW_COMPLETENESS_REQUIRED (open-ended names, WritePlan truth)", () => {
  it("is HUMAN_CONFIRMED in contract and rejects fixed default of one", () => {
    expect(DYNAMIC_ROW_COMPLETENESS_REQUIRED.evidence).toBe("HUMAN_CONFIRMED");
    expect(
      ADMIN_CONTRACT_V1.semantics.dynamicRowCompletenessRequired.evidence,
    ).toBe("HUMAN_CONFIRMED");
    expect(DYNAMIC_ROW_COMPLETENESS_REQUIRED.notes.join(" ")).toMatch(
      /open-ended|no whitelist/i,
    );
    expect(DYNAMIC_ROW_COMPLETENESS_REQUIRED.notes.join(" ")).toMatch(
      /WritePlan/i,
    );
  });

  it("exposes incompleteness error codes", () => {
    expect(ErrorCategory).toContain("INCOMPLETE_ADMIN_ROW");
    expect(ErrorCategory).toContain("MISSING_REQUIRED_ADMIN_FIELD");
    expect(ErrorCategory).toContain("UNEXPECTED_DYNAMIC_ROW");
    expect(ErrorCategory).toContain("ADMIN_FORM_NOT_SUBMIT_READY");
  });

  it("variant: complete row PASS; missing name/price FAIL", () => {
    expect(missingFieldsForRow("variants", row({ name: "Alm.", price: "0" }))).toEqual(
      [],
    );
    expect(missingFieldsForRow("variants", row({ name: "", price: "0" }))).toEqual([
      "name",
    ]);
    expect(missingFieldsForRow("variants", row({ name: "Alm.", price: "" }))).toEqual([
      "price",
    ]);
  });

  it("accepts any open-ended complete variant names (no whitelist)", () => {
    const plan: WritePlanDynamicCollections = {
      variants: [
        { name: "Lille", price: "0" },
        { name: "Mellem", price: "20" },
        { name: "Stor", price: "40" },
        { name: "Deep Pan", price: "20" },
        { name: "20 cm", price: "0" },
        { name: "Restaurant-Specific Foo", price: "12" },
      ],
      ingredients: [],
      additions: [],
    };
    const result = validateAdminFormBeforeSubmit(
      snap({
        variants: plan.variants.map((v) =>
          row({ name: v.name, price: v.price }),
        ),
        ingredients: [],
        additions: [],
      }),
      plan,
    );
    expect(result.submitReady).toBe(true);
    expect(result.status).toBe("VALID");
    expect(result.instantiated.variants).toBe(6);
  });

  it("five complete variants PASS; blank middle row FAIL", () => {
    const five: WritePlanDynamicCollections = {
      variants: [
        { name: "Alm.", price: "0" },
        { name: "Deep Pan", price: "20" },
        { name: "Glutenfri", price: "25" },
        { name: "Fuldkorn", price: "10" },
        { name: "Familie", price: "80" },
      ],
      ingredients: [],
      additions: [],
    };
    expect(
      validateAdminFormBeforeSubmit(
        snap({
          variants: five.variants.map((v) =>
            row({ name: v.name, price: v.price }),
          ),
          ingredients: [],
        }),
        five,
      ).submitReady,
    ).toBe(true);

    const withBlank = validateInstantiatedRowsComplete(
      snap({
        variants: [
          row({ name: "Alm.", price: "0" }),
          row({ name: "", price: "" }),
          row({ name: "Familie", price: "80" }),
        ],
        ingredients: [],
      }),
      { requireScalars: true },
    );
    expect(withBlank.submitReady).toBe(false);
    expect(withBlank.issues.some((i) => i.code === "INCOMPLETE_ADMIN_ROW")).toBe(
      true,
    );
    expect(
      withBlank.issues.find((i) => i.rowIndex === 1)?.missingFields,
    ).toEqual(["name", "price"]);
  });

  it("ingredient: complete PASS; blank FAIL", () => {
    expect(
      missingFieldsForRow("ingredients", row({ name: "Tomat" })),
    ).toEqual([]);
    expect(missingFieldsForRow("ingredients", row({ name: "" }))).toEqual([
      "name",
    ]);
  });

  it("addition: zero rows PASS; complete PASS; blank / partial FAIL", () => {
    const zeroPlan: WritePlanDynamicCollections = {
      variants: [{ name: "Alm.", price: "0" }],
      ingredients: [],
      additions: [],
    };
    expect(
      validateAdminFormBeforeSubmit(
        snap({ ingredients: [], additions: [] }),
        zeroPlan,
      ).submitReady,
    ).toBe(true);

    const oneComplete: WritePlanDynamicCollections = {
      ...zeroPlan,
      additions: [{ name: "Ekstra ost", price: "15" }],
    };
    expect(
      validateAdminFormBeforeSubmit(
        snap({
          ingredients: [],
          additions: [row({ name: "Ekstra ost", price: "15" })],
        }),
        oneComplete,
      ).submitReady,
    ).toBe(true);

    const blankAddition = validateInstantiatedRowsComplete(
      snap({
        ingredients: [],
        additions: [row({ name: "", price: "" })],
      }),
    );
    expect(blankAddition.submitReady).toBe(false);

    expect(
      missingFieldsForRow("additions", row({ name: "Ekstra ost", price: "" })),
    ).toEqual(["price"]);
    expect(
      missingFieldsForRow("additions", row({ name: "", price: "15" })),
    ).toEqual(["name"]);
  });

  it("ignores blueprint/template rows but rejects instantiated blanks", () => {
    const plan: WritePlanDynamicCollections = {
      variants: [{ name: "Alm.", price: "0" }],
      ingredients: [],
      additions: [],
    };
    const result = validateAdminFormBeforeSubmit(
      snap({
        ingredients: [],
        variants: [
          row({ name: "Alm.", price: "0" }),
          row({
            name: "",
            price: "",
            isBlueprint: true,
            isInstantiated: false,
          }),
        ],
        additions: [
          row({
            name: "",
            price: "",
            isBlueprint: true,
            isInstantiated: false,
          }),
        ],
      }),
      plan,
    );
    expect(result.submitReady).toBe(true);
    expect(result.blueprintsIgnored.variants).toBe(1);
  });

  it("WritePlan additions=0 with one blank instantiated addition → BLOCK", () => {
    const plan: WritePlanDynamicCollections = {
      variants: [{ name: "Alm.", price: "0" }],
      ingredients: [],
      additions: [],
    };
    const result = validateAdminFormBeforeSubmit(
      snap({
        ingredients: [],
        additions: [row({ name: "", price: "" })],
      }),
      plan,
    );
    expect(result.submitReady).toBe(false);
    expect(result.issues.some((i) => i.code === "INCOMPLETE_ADMIN_ROW")).toBe(
      true,
    );
    expect(result.issues.some((i) => i.code === "UNEXPECTED_DYNAMIC_ROW")).toBe(
      true,
    );
    expect(unintendedBlankRows(snap({
      ingredients: [],
      additions: [row({ name: "", price: "" })],
    }), plan)).toEqual([{ section: "additions", rowIndex: 0 }]);
  });

  it("countsFromWritePlan is length-based, not a hardcoded 1", () => {
    expect(
      countsFromWritePlan({
        variants: [
          { name: "A", price: "0" },
          { name: "B", price: "1" },
          { name: "C", price: "2" },
        ],
        ingredients: [{ name: "x" }],
        additions: [],
      }),
    ).toEqual({ variants: 3, ingredients: 1, additions: 0 });
  });
});
