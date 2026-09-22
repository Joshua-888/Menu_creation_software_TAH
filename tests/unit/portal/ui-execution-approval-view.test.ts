import { describe, expect, it } from "vitest";
import {
  buildWriteScopeSummary,
  buildBundleIdentityRows,
  approvalDisabledReason,
  isQualityBlocked,
} from "../../../apps/portal/src/components/approval/approvalView.js";
import {
  buildExecutionResultTiles,
  classifyExecutionFailures,
  deriveExecutionStages,
  isVerificationFailure,
} from "../../../apps/portal/src/components/execution/executionView.js";

/**
 * UI-3 (Part A + Part B) display logic.
 *
 * The most important assertion here is the Part-A safety guard: a TargetMenu
 * whose quality contract reports MENU_QUALITY_BLOCKED MUST disable approval in
 * the UI, regardless of source coverage. This is the app-layer half of the
 * defense-in-depth fix (the API/worker/store halves are covered by
 * quality-block-approval-gate.test.ts).
 */
describe("approval panel safety guard", () => {
  it("disables approval when the quality contract is BLOCKED", () => {
    const reason = approvalDisabledReason({
      coverageBlocked: false,
      menuStatus: "MENU_QUALITY_BLOCKED",
    });
    expect(reason).toBe(
      "TargetMenu quality is BLOCKED. Cannot approve blocked menus.",
    );
    expect(isQualityBlocked("MENU_QUALITY_BLOCKED")).toBe(true);
  });

  it("does not disable approval for READY/REVIEW quality or good coverage", () => {
    expect(
      approvalDisabledReason({
        coverageBlocked: false,
        menuStatus: "MENU_QUALITY_READY",
      }),
    ).toBeUndefined();
    expect(
      approvalDisabledReason({
        coverageBlocked: false,
        menuStatus: "MENU_QUALITY_REVIEW",
      }),
    ).toBeUndefined();
  });

  it("lets the BLOCKED message win over the coverage message", () => {
    const reason = approvalDisabledReason({
      coverageBlocked: true,
      coverageDetail: "coverage detail",
      menuStatus: "MENU_QUALITY_BLOCKED",
    });
    expect(reason).toBe(
      "TargetMenu quality is BLOCKED. Cannot approve blocked menus.",
    );
  });

  it("still disables approval on suspicious coverage with no quality block", () => {
    expect(
      approvalDisabledReason({
        coverageBlocked: true,
        coverageDetail: null,
        menuStatus: "MENU_QUALITY_READY",
      }),
    ).toBe("Source coverage is suspicious; re-extract before approval.");
  });
});

describe("bundle identity + write scope", () => {
  it("returns no bundle rows without a bundle (graceful degradation)", () => {
    expect(buildBundleIdentityRows(null)).toEqual([]);
  });

  it("summarises the frozen bundle identity, degrading missing values to —", () => {
    const rows = buildBundleIdentityRows({
      bundleVersion: "ExecutionBundleV1",
      writePlanHash: "wp-hash",
    });
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map["WritePlan hash"]).toBe("wp-hash");
    expect(map["Target menu hash"]).toBe("—");
    expect(map["Production SHA"]).toBe("—");
  });

  it("breaks down write scope and flags unsupported capabilities", () => {
    const summary = buildWriteScopeSummary({
      writePlan: { categoryCreates: 4, productCreates: 42 },
      bundle: { operationCount: 46, capabilityRequirements: ["CATEGORY_CREATE"] },
      missingCapabilities: ["CATEGORY_CREATE", "CHOICE_MODIFIER", "ADDITIONS"],
    });
    expect(summary.categoryCreates).toBe(4);
    expect(summary.productCreates).toBe(42);
    expect(summary.unsupportedCapabilities).toEqual([
      "CHOICE_MODIFIER",
      "ADDITIONS",
    ]);
  });
});

describe("execution stepper", () => {
  const stateOf = (
    stages: ReturnType<typeof deriveExecutionStages>,
    id: string,
  ) => stages.find((s) => s.id === id)?.state;

  it("marks APPROVED current while awaiting operator approval", () => {
    const stages = deriveExecutionStages("AWAITING_OPERATOR_APPROVAL", null);
    expect(stateOf(stages, "PREPARING")).toBe("done");
    expect(stateOf(stages, "APPROVED")).toBe("current");
    expect(stateOf(stages, "EXECUTING")).toBe("pending");
  });

  it("marks EXECUTING current during a live write", () => {
    const stages = deriveExecutionStages("LIVE_EXECUTING", null);
    expect(stateOf(stages, "EXECUTING")).toBe("current");
  });

  it("marks VERIFIED done only when the read-back confirms the menu", () => {
    const verified = deriveExecutionStages("COMPLETED", {
      status: "COMPLETED",
      menuVerified: true,
      productsFailed: 0,
    });
    expect(stateOf(verified, "VERIFIED")).toBe("done");

    const mismatch = deriveExecutionStages("COMPLETED", {
      status: "COMPLETED",
      menuVerified: false,
      productsFailed: 2,
    });
    expect(stateOf(mismatch, "VERIFYING")).toBe("failed");
    expect(stateOf(mismatch, "VERIFIED")).toBe("pending");
  });

  it("treats a partial write as a failed verification", () => {
    const stages = deriveExecutionStages("PARTIAL_WRITE", {
      status: "PARTIAL_WRITE",
      menuVerified: false,
    });
    expect(stateOf(stages, "VERIFYING")).toBe("failed");
  });
});

describe("failure classification", () => {
  it("classifies a pre-write failure as NO_MUTATION", () => {
    const badges = classifyExecutionFailures({
      status: "LIVE_EXECUTION_FAILED",
      result: { status: "LIVE_EXECUTION_FAILED", processed: 0 },
    });
    expect(badges.map((b) => b.kind)).toContain("NO_MUTATION");
  });

  it("classifies PARTIAL_WRITE as PARTIAL_MUTATION", () => {
    const badges = classifyExecutionFailures({
      status: "PARTIAL_WRITE",
      result: {
        status: "PARTIAL_WRITE",
        processed: 5,
        failed: 2,
        menuVerified: false,
        productsFailed: 1,
      },
    });
    const kinds = badges.map((b) => b.kind);
    expect(kinds).toContain("PARTIAL_MUTATION");
    expect(kinds).toContain("VERIFICATION_MISMATCH");
  });

  it("classifies recoveryRequired as RECOVERY_REQUIRED", () => {
    const badges = classifyExecutionFailures({
      status: "RECOVERY_REQUIRED",
      result: { status: "PARTIAL_WRITE", recoveryRequired: true },
    });
    expect(badges.map((b) => b.kind)).toContain("RECOVERY_REQUIRED");
  });

  it("classifies a destination lock error message", () => {
    const badges = classifyExecutionFailures({
      status: "LIVE_EXECUTION_FAILED",
      result: null,
      errorMessage: "DESTINATION_WRITE_LOCKED: another writer holds the lease",
    });
    expect(badges.map((b) => b.kind)).toContain("DESTINATION_LOCKED");
  });

  it("classifies missing capabilities as UNSUPPORTED_CAPABILITY", () => {
    const badges = classifyExecutionFailures({
      status: "LIVE_EXECUTION_FAILED",
      result: null,
      missingCapabilities: ["CHOICE_MODIFIER"],
    });
    expect(badges.map((b) => b.kind)).toContain("UNSUPPORTED_CAPABILITY");
  });

  it("produces no badges for a clean success", () => {
    const badges = classifyExecutionFailures({
      status: "COMPLETED",
      result: { status: "COMPLETED", menuVerified: true, productsFailed: 0 },
    });
    expect(badges).toEqual([]);
  });

  it("does not treat a verified completed run as a verification failure", () => {
    expect(
      isVerificationFailure({ status: "COMPLETED", menuVerified: true }),
    ).toBe(false);
  });
});

describe("execution result tiles", () => {
  it("returns no tiles without a result", () => {
    expect(buildExecutionResultTiles(null)).toEqual([]);
  });

  it("renders verified/failed counts and a recovery tile", () => {
    const tiles = buildExecutionResultTiles({
      status: "PARTIAL_WRITE",
      categoriesVerified: 3,
      productsVerified: 10,
      productsFailed: 2,
      menuVerified: false,
      recoveryRequired: true,
    });
    const map = Object.fromEntries(tiles.map((t) => [t.label, t.value]));
    expect(map["Categories verified"]).toBe("3");
    expect(map["Products verified"]).toBe("10");
    expect(map["Products failed"]).toBe("2");
    expect(map["Menu verified"]).toBe("NO");
    expect(map["Recovery"]).toBe("REQUIRED");
  });
});
