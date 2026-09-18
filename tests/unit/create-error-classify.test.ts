import { describe, expect, it } from "vitest";
import {
  classifyCreateFailureFromMessage,
  classifyCreateHttpFailure,
  isDeterministicCreateRejection,
  formatCreateFailureMessage,
} from "../../src/tah/write/createErrorClassify.js";

describe("TAH CREATE error classification", () => {
  it("classifies generic HTTP 500 OOPS as deterministic server exception", () => {
    const classified = classifyCreateHttpFailure({
      httpStatus: 500,
      bodyText: "OOPS! INTERNAL SERVER ERROR / SOMETHING IS WRONG",
    });
    expect(classified.class).toBe("TAH_SERVER_EXCEPTION");
    expect(classified.normalizedBody).toBe("oops_internal_server_error");
    expect(classified.retryable).toBe(false);
    expect(isDeterministicCreateRejection(classified)).toBe(true);
    expect(classified.signature).toContain("500");
  });

  it("classifies CSRF 419 as retryable session failure", () => {
    const classified = classifyCreateHttpFailure({
      httpStatus: 419,
      bodyText: "Page Expired",
    });
    expect(classified.class).toBe("SESSION_OR_CSRF_FAILURE");
    expect(classified.retryable).toBe(true);
    expect(isDeterministicCreateRejection(classified)).toBe(false);
  });

  it("round-trips CREATE_RESPONSE_ERROR messages used by the destination port", () => {
    const original = classifyCreateHttpFailure({
      httpStatus: 500,
      bodyText: "oops internal server error",
    });
    const parsed = classifyCreateFailureFromMessage(
      formatCreateFailureMessage(original),
    );
    expect(parsed?.httpStatus).toBe(500);
    expect(parsed?.class).toBe("TAH_SERVER_EXCEPTION");
    expect(isDeterministicCreateRejection(parsed!)).toBe(true);
  });

  it("does not treat SQL duplicate-entry 500 as a generic unknown", () => {
    const classified = classifyCreateHttpFailure({
      httpStatus: 500,
      bodyText: "SQLSTATE[23000]: Duplicate entry '22' for key 'menu_number'",
    });
    expect(classified.class).toBe("MENU_NUMBER_CREATE_CONFLICT");
    expect(classified.fieldClass).toBe("menu_number");
  });
});
