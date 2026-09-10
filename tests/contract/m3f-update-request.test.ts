import { describe, expect, it } from "vitest";
import { ErrorCategory } from "../../src/domain/errors.js";
import {
  buttonClickAloneMeansWritten,
  canTransition,
  assertEditPathRequiresOpdater,
} from "../../src/tah/write/stateMachine.js";
import {
  classifyUpdateOutcome,
  isProductUpdateRequest,
} from "../../src/tah/write/updateRequestObserve.js";
import { ADMIN_CONTRACT_V1 } from "../../src/tah/index.js";

function fakeReq(input: {
  method: string;
  url: string;
  postData: string | null;
}): {
  method: () => string;
  url: () => string;
  postData: () => string | null;
} {
  return {
    method: () => input.method,
    url: () => input.url,
    postData: () => input.postData,
  };
}

describe("M3H multipart-safe update request observation", () => {
  it("matches POST /admin/menu/18 by method+path without requiring postData", () => {
    expect(
      isProductUpdateRequest(
        fakeReq({
          method: "POST",
          url: "https://veronipizza.dk/admin/menu/18",
          postData: null,
        }) as never,
        "18",
      ),
    ).toBe(true);
    expect(
      isProductUpdateRequest(
        fakeReq({
          method: "POST",
          url: "https://veronipizza.dk/admin/menu/18",
          postData: "",
        }) as never,
        "18",
      ),
    ).toBe(true);
    expect(
      isProductUpdateRequest(
        fakeReq({
          method: "POST",
          url: "https://veronipizza.dk/admin/menu/18/",
          postData: null,
        }) as never,
        "18",
      ),
    ).toBe(true);
    expect(
      isProductUpdateRequest(
        fakeReq({
          method: "POST",
          url: "https://veronipizza.dk/admin/menu/18",
          postData: "_method=put&description=x",
        }) as never,
        "18",
      ),
    ).toBe(true);
  });

  it("rejects non-POST and wrong path (M3G false-negative regression guard)", () => {
    expect(
      isProductUpdateRequest(
        fakeReq({
          method: "GET",
          url: "https://veronipizza.dk/admin/menu/18",
          postData: null,
        }) as never,
        "18",
      ),
    ).toBe(false);
    expect(
      isProductUpdateRequest(
        fakeReq({
          method: "POST",
          url: "https://veronipizza.dk/admin/menu",
          postData: null,
        }) as never,
        "18",
      ),
    ).toBe(false);
    expect(
      isProductUpdateRequest(
        fakeReq({
          method: "POST",
          url: "https://veronipizza.dk/admin/menu/19",
          postData: null,
        }) as never,
        "18",
      ),
    ).toBe(false);
  });

  it("classifies no request as UPDATE_REQUEST_NOT_OBSERVED", () => {
    expect(
      classifyUpdateOutcome({
        requestObserved: false,
        responseStatus: 0,
        descriptionExpected: "v2",
        descriptionActual: null,
        validationMessages: [],
      }).code,
    ).toBe("UPDATE_REQUEST_NOT_OBSERVED");
    expect(
      classifyUpdateOutcome({
        requestObserved: true,
        responseStatus: 200,
        descriptionExpected: "v2",
        descriptionActual: "v2",
        validationMessages: ["Fejl"],
      }).code,
    ).toBe("ADMIN_VALIDATION_ERROR");
    expect(
      classifyUpdateOutcome({
        requestObserved: true,
        responseStatus: 500,
        descriptionExpected: "v2",
        descriptionActual: "v2",
        validationMessages: [],
      }).code,
    ).toBe("UPDATE_RESPONSE_ERROR");
    expect(
      classifyUpdateOutcome({
        requestObserved: true,
        responseStatus: 200,
        descriptionExpected: "v2",
        descriptionActual: "old",
        validationMessages: [],
      }).code,
    ).toBe("READBACK_MISMATCH");
  });

  it("button click alone never means WRITTEN", () => {
    expect(buttonClickAloneMeansWritten()).toBe(false);
    expect(canTransition("UPDATE_SUBMITTED", "WRITTEN")).toBe(false);
    expect(() =>
      assertEditPathRequiresOpdater([
        "FORM_MODIFIED",
        "UPDATE_SUBMITTED",
        "WRITTEN",
      ]),
    ).toThrow(/SUBMIT_REQUEST_OBSERVED/);
  });

  it("includes granular update error codes in taxonomy", () => {
    expect(ErrorCategory).toContain("UPDATE_REQUEST_NOT_SENT");
    expect(ErrorCategory).toContain("UPDATE_REQUEST_NOT_OBSERVED");
    expect(ErrorCategory).toContain("ADMIN_VALIDATION_ERROR");
    expect(ErrorCategory).toContain("UPDATE_RESPONSE_ERROR");
    expect(ErrorCategory).toContain("READBACK_MISMATCH");
  });

  it("documents M3H-certified narrow update capabilities; updateProduct stays UNCERTIFIED", () => {
    expect(ADMIN_CONTRACT_V1.capabilities.write.updateExistingProductForm).toBe(
      "CERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.updateProductDescription).toBe(
      "CERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.updateScalarProductField).toBe(
      "CERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.updateProduct).toBe(
      "UNCERTIFIED",
    );
  });
});
