import { describe, expect, it } from "vitest";
import {
  ADMIN_CONTRACT_V1,
  assertInactiveCreatePayloadSafe,
  assertVerificationPath,
  assertWritePlanExactlyOneCreateProduct,
  assertWritePlanImmutable,
  assertVeroniTargetLock,
  canTransition,
  CANARY_NAMES,
  createInactiveProductWritePlan,
  evaluateEmptyProductBaseline,
  isMilestone3CanaryExecutable,
  parseFormBody,
  runInactiveProductDryRun,
  sanitizeCreatePayload,
  selectExistingCategoryDeterministic,
  transitionWriteState,
} from "../../src/tah/index.js";

describe("M3 resume target lock", () => {
  it("allows only veronipizza.dk", () => {
    expect(
      assertVeroniTargetLock({
        hostname: "veronipizza.dk",
        restaurantName: "Veroni Pizza",
      }).ok,
    ).toBe(true);
  });
  it("blocks NEW WAY host", () => {
    const r = assertVeroniTargetLock({
      hostname: "newwaypizzaringsted.dk",
      restaurantName: "Veroni Pizza",
    });
    expect(r.ok).toBe(false);
  });
});

describe("M3 resume WritePlan", () => {
  it("contains exactly one CREATE_PRODUCT and no CREATE_CATEGORY", () => {
    const plan = createInactiveProductWritePlan({
      runId: "t",
      dryRun: true,
      menuNumber: "99001",
      productName: CANARY_NAMES.product,
      description: CANARY_NAMES.description,
      basePriceOre: 9900,
      categoryDatabaseId: "1",
      categoryName: "Pizza",
      variants: [{ name: "Alm.", priceOre: 0 }],
      ingredients: [CANARY_NAMES.ingredientA, CANARY_NAMES.ingredientB],
    });
    assertWritePlanImmutable(plan);
    assertWritePlanExactlyOneCreateProduct(plan);
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]?.action).toBe("CREATE_PRODUCT");
    expect(plan.operations.some((o) => o.action === "CREATE_CATEGORY")).toBe(
      false,
    );
  });
});

describe("M3 category selection", () => {
  it("picks lowest numeric database id", () => {
    const selected = selectExistingCategoryDeterministic([
      { databaseId: "10", name: "Z" },
      { databaseId: "2", name: "Pizza" },
      { databaseId: "7", name: "A" },
    ]);
    expect(selected).toEqual({ databaseId: "2", name: "Pizza" });
  });
});

describe("M3 payload inspect", () => {
  it("rejects active=true payloads", () => {
    const payload = sanitizeCreatePayload({
      method: "POST",
      url: "https://veronipizza.dk/admin/menu",
      postData:
        "name=__TAH_CANARY_PRODUCT_M3__&menu_number=99001&price=99&categories%5B%5D=1&active=1&_token=SECRET",
    });
    expect(payload.fields).not.toHaveProperty("_token");
    expect(payload.looksActiveTrue).toBe(true);
    const check = assertInactiveCreatePayloadSafe(payload, {
      name: CANARY_NAMES.product,
      menuNumber: "99001",
      categoryDatabaseId: "1",
      basePriceKr: "99",
    });
    expect(check.ok).toBe(false);
  });

  it("parses multipart inactive create payloads", () => {
    const multipart = [
      "------WebKitFormBoundaryX",
      'Content-Disposition: form-data; name="_token"',
      "",
      "SECRET",
      "------WebKitFormBoundaryX",
      'Content-Disposition: form-data; name="menu_number"',
      "",
      "99001",
      "------WebKitFormBoundaryX",
      'Content-Disposition: form-data; name="name"',
      "",
      "__TAH_CANARY_PRODUCT_M3__",
      "------WebKitFormBoundaryX",
      'Content-Disposition: form-data; name="price"',
      "",
      "99",
      "------WebKitFormBoundaryX",
      'Content-Disposition: form-data; name="categories[]"',
      "",
      "1",
      "------WebKitFormBoundaryX--",
    ].join("\r\n");
    const payload = sanitizeCreatePayload({
      method: "POST",
      url: "https://veronipizza.dk/admin/menu",
      postData: multipart,
      headers: { "content-type": "multipart/form-data; boundary=----WebKitFormBoundaryX" },
    });
    expect(payload.fields).not.toHaveProperty("_token");
    expect(payload.activeFieldPresent).toBe(false);
    expect(
      assertInactiveCreatePayloadSafe(payload, {
        name: CANARY_NAMES.product,
        menuNumber: "99001",
        categoryDatabaseId: "1",
        basePriceKr: "99",
      }).ok,
    ).toBe(true);
  });

  it("accepts omitted active with expected fields", () => {
    const body = [
      "name=__TAH_CANARY_PRODUCT_M3__",
      "menu_number=99001",
      "price=99",
      "categories[]=1",
      "variants[0][name]=Alm.",
      "variants[0][price]=0",
      "ingredients[0][name]=Test ingredient A",
      "ingredients[1][name]=Test ingredient B",
    ].join("&");
    const payload = sanitizeCreatePayload({
      method: "POST",
      url: "https://veronipizza.dk/admin/menu",
      postData: body,
    });
    expect(payload.activeFieldPresent).toBe(false);
    expect(
      assertInactiveCreatePayloadSafe(payload, {
        name: CANARY_NAMES.product,
        menuNumber: "99001",
        categoryDatabaseId: "1",
        basePriceKr: "99",
      }).ok,
    ).toBe(true);
    expect(parseFormBody("a=1&a=2").a).toEqual(["1", "2"]);
  });
});

describe("M3 dry-run inactive protocol", () => {
  it("requires uncheck authorization and unchecked state", () => {
    const blocked = runInactiveProductDryRun({
      hostname: "veronipizza.dk",
      restaurantName: "Veroni Pizza",
      productCount: 0,
      categoryCount: 10,
      contractStatus: "CONTRACT_MATCH",
      inactiveUncheckProtocolAuthorized: true,
      activeDefaultChecked: true,
      activeCurrentlyUnchecked: false,
      selectedCategoryDatabaseId: "1",
      selectedCategoryName: "Pizza",
      runId: "x",
    });
    expect(blocked.status).toBe("BLOCKED");

    const ok = runInactiveProductDryRun({
      hostname: "veronipizza.dk",
      restaurantName: "Veroni Pizza",
      productCount: 0,
      categoryCount: 10,
      contractStatus: "CONTRACT_MATCH",
      inactiveUncheckProtocolAuthorized: true,
      activeDefaultChecked: true,
      activeCurrentlyUnchecked: true,
      selectedCategoryDatabaseId: "1",
      selectedCategoryName: "Pizza",
      runId: "y",
    });
    expect(ok.status).toBe("DRY_RUN_OK");
  });

  it("blocks baseline changes and contract drift", () => {
    expect(
      evaluateEmptyProductBaseline({ productCount: 1, categoryCount: 1 }).ok,
    ).toBe(false);
    const drift = runInactiveProductDryRun({
      hostname: "veronipizza.dk",
      restaurantName: "Veroni Pizza",
      productCount: 0,
      categoryCount: 10,
      contractStatus: "CONTRACT_DRIFT",
      inactiveUncheckProtocolAuthorized: true,
      activeDefaultChecked: true,
      activeCurrentlyUnchecked: true,
      selectedCategoryDatabaseId: "1",
      selectedCategoryName: "Pizza",
      runId: "d",
    });
    expect(drift.status).toBe("BLOCKED");
  });
});

describe("M3 state machine + ambiguous policy", () => {
  it("forbids skipping READ_BACK", () => {
    expect(canTransition("WRITTEN", "VERIFIED")).toBe(false);
    expect(() => transitionWriteState("WRITTEN", "VERIFIED")).toThrow();
    expect(() =>
      assertVerificationPath(["WRITTEN", "READ_BACK", "VERIFIED"]),
    ).not.toThrow();
  });

  it("forbids FORM_MODIFIED jumping to WRITTEN without Opdater", () => {
    expect(canTransition("FORM_MODIFIED", "WRITTEN")).toBe(false);
    expect(canTransition("FORM_MODIFIED", "UPDATE_SUBMITTED")).toBe(true);
    expect(canTransition("UPDATE_SUBMITTED", "WRITTEN")).toBe(false);
    expect(canTransition("UPDATE_SUBMITTED", "SUBMIT_EVENT_CONFIRMED")).toBe(
      true,
    );
  });

  it("documents no blind retry", () => {
    expect({ ifUncertain: "STOP", never: "CREATE_AGAIN_BLINDLY" }.ifUncertain).toBe(
      "STOP",
    );
  });
});

describe("M3 canary executable gate", () => {
  it("still requires inactive semantics for generic gate", () => {
    expect(
      isMilestone3CanaryExecutable({
        variantPriceSemantics: "SURCHARGE",
        capabilities: ADMIN_CONTRACT_V1.capabilities,
        activeDefaultChecked: true,
      }),
    ).toBe(false);
  });

  it("keeps visibility write capabilities uncertified until Opdater round-trip", () => {
    expect(ADMIN_CONTRACT_V1.capabilities.write.setProductHidden).toBe(
      "UNCERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.setProductAvailable).toBe(
      "UNCERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.updateExistingProductForm).toBe(
      "CERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.updateProduct).toBe(
      "UNCERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.createVsEdit.editSubmit.notes).toMatch(/Opdater/i);
    expect(ADMIN_CONTRACT_V1.notes.some((n) => /setProductHidden/i.test(n))).toBe(
      true,
    );
  });
});
