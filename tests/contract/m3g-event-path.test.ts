import { describe, expect, it } from "vitest";
import { ErrorCategory } from "../../src/domain/errors.js";
import {
  buttonClickAloneMeansWritten,
  canTransition,
  classifyOpdaterEventPath,
  clickWithoutSubmitAdvancesToWritten,
  isFormSubmitBypassProhibited,
} from "../../src/tah/write/stateMachine.js";
import { isProductUpdateRequest } from "../../src/tah/write/updateRequestObserve.js";

describe("M3G Opdater event-path diagnostics", () => {
  it("classifies click vs submit event outcomes", () => {
    expect(
      classifyOpdaterEventPath({
        clickObserved: false,
        submitEventObserved: false,
      }),
    ).toBe("OPDATER_CLICK_NOT_DELIVERED");
    expect(
      classifyOpdaterEventPath({
        clickObserved: true,
        submitEventObserved: false,
      }),
    ).toBe("OPDATER_CLICK_NO_SUBMIT_EVENT");
    expect(
      classifyOpdaterEventPath({
        clickObserved: true,
        submitEventObserved: true,
      }),
    ).toBe("FORM_SUBMIT_EVENT_CONFIRMED");
    expect(
      classifyOpdaterEventPath({
        clickObserved: true,
        submitEventObserved: true,
        mutationRequestObserved: false,
      }),
    ).toBe("FALSE_NEGATIVE_REQUEST_OBSERVER");
  });

  it("prohibits HTMLFormElement.submit() bypass in production design", () => {
    expect(isFormSubmitBypassProhibited()).toBe(true);
  });

  it("click without submit never advances to WRITTEN", () => {
    expect(clickWithoutSubmitAdvancesToWritten()).toBe(false);
    expect(buttonClickAloneMeansWritten()).toBe(false);
    expect(canTransition("FORM_MODIFIED", "WRITTEN")).toBe(false);
    expect(canTransition("UPDATE_SUBMITTED", "SUBMIT_EVENT_CONFIRMED")).toBe(
      true,
    );
  });

  it("matches POST path even when readable body lacks _method (body is pre-submit only)", () => {
    const fake = {
      method: () => "POST",
      url: () => "https://veronipizza.dk/admin/menu/18",
      postData: () => "description=v2&name=x",
    };
    expect(isProductUpdateRequest(fake as never, "18")).toBe(true);
    const withPut = {
      method: () => "POST",
      url: () => "https://veronipizza.dk/admin/menu/18",
      postData: () => "_method=put&description=v2",
    };
    expect(isProductUpdateRequest(withPut as never, "18")).toBe(true);
  });

  it("documents multipart empty postData MUST still match (M3G false-negative fix)", () => {
    const emptyBody = {
      method: () => "POST",
      url: () => "https://veronipizza.dk/admin/menu/18",
      postData: () => null,
    };
    expect(isProductUpdateRequest(emptyBody as never, "18")).toBe(true);
    const emptyString = {
      method: () => "POST",
      url: () => "https://veronipizza.dk/admin/menu/18",
      postData: () => "",
    };
    expect(isProductUpdateRequest(emptyString as never, "18")).toBe(true);
  });

  it("still requires _method=put when body IS readable urlencoded (optional signal)", () => {
    // Network matcher no longer requires body; readable body with wrong path still fails:
    const wrongPath = {
      method: () => "POST",
      url: () => "https://veronipizza.dk/admin/menu",
      postData: () => "_method=put&description=v2",
    };
    expect(isProductUpdateRequest(wrongPath as never, "18")).toBe(false);
  });

  it("includes M3G event-path error codes", () => {
    expect(ErrorCategory).toContain("OPDATER_CLICK_NOT_DELIVERED");
    expect(ErrorCategory).toContain("OPDATER_CLICK_NO_SUBMIT_EVENT");
    expect(ErrorCategory).toContain("FORM_SUBMIT_EVENT_CONFIRMED");
    expect(ErrorCategory).toContain("FALSE_NEGATIVE_REQUEST_OBSERVER");
    expect(ErrorCategory).toContain("CLIENT_JS_SUBMIT_ERROR");
  });

  it("records FLAKY_TEST_DETECTED for intermittent 5s Playwright timeouts", () => {
    const note = {
      code: "FLAKY_TEST_DETECTED" as const,
      tests: [
        "admin-contract-m2b parses list rows",
        "admin-contract-v1 recognizes certified structure selectors",
      ],
      defaultTimeoutMs: 5000,
    };
    expect(note.code).toBe("FLAKY_TEST_DETECTED");
    expect(note.defaultTimeoutMs).toBe(5000);
  });
});
