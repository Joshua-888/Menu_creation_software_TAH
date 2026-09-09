import { describe, expect, it } from "vitest";
import { aggregateStatus } from "../../src/domain/status.js";

describe("aggregateStatus", () => {
  it("returns READY for empty list", () => {
    expect(aggregateStatus([])).toBe("READY");
  });

  it("uses precedence BLOCKED > MANUAL_REVIEW_REQUIRED > WARNING > READY", () => {
    expect(aggregateStatus(["READY", "WARNING"])).toBe("WARNING");
    expect(
      aggregateStatus(["WARNING", "MANUAL_REVIEW_REQUIRED", "READY"]),
    ).toBe("MANUAL_REVIEW_REQUIRED");
    expect(
      aggregateStatus([
        "READY",
        "WARNING",
        "MANUAL_REVIEW_REQUIRED",
        "BLOCKED",
      ]),
    ).toBe("BLOCKED");
  });
});
