import { describe, expect, it } from "vitest";
import {
  buildMerchantDashboard,
  restaurantOptions,
  statusLabel,
  workflowLabel,
} from "../../../src/portal/merchantDashboard.js";
import type { MigrationJob } from "../../../src/portal/types.js";

function job(partial: Partial<MigrationJob> & Pick<MigrationJob, "id" | "restaurantKey" | "status">): MigrationJob {
  return {
    merchantName: partial.merchantName ?? "Merchant",
    destinationHost: partial.destinationHost ?? "https://x.dk",
    sourceType: "pdf_upload",
    workflow: partial.workflow ?? "CREATE_MENU",
    sourceUrl: null,
    createdByEmployeeId: "emp_1",
    errorMessage: null,
    remainingQuestions: partial.remainingQuestions ?? 0,
    createdAt: partial.createdAt ?? "2026-01-02T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-02T00:00:00.000Z",
    ...partial,
  };
}

describe("merchant dashboard", () => {
  it("rolls up one row per merchant with latest status", () => {
    const rows = buildMerchantDashboard([
      job({
        id: "j2",
        restaurantKey: "veronipizza.dk",
        merchantName: "Veroni",
        status: "AWAITING_REVIEW",
        workflow: "QA_RECONCILE",
        remainingQuestions: 3,
        updatedAt: "2026-01-03T00:00:00.000Z",
      }),
      job({
        id: "j1",
        restaurantKey: "veronipizza.dk",
        merchantName: "Veroni",
        status: "COMPLETED",
        workflow: "CREATE_MENU",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      job({
        id: "j3",
        restaurantKey: "other.dk",
        merchantName: "Other",
        status: "QUEUED",
        workflow: "CREATE_MENU",
      }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.restaurantKey).toBe("veronipizza.dk");
    expect(rows[0]!.latestStatus).toBe("AWAITING_REVIEW");
    expect(rows[0]!.latestWorkflow).toBe("QA_RECONCILE");
    expect(rows[0]!.createJobCount).toBe(1);
    expect(rows[0]!.qaJobCount).toBe(1);
    expect(workflowLabel("QA_RECONCILE")).toBe("Quality check");
    expect(statusLabel("AWAITING_REVIEW")).toBe("Needs review");
  });

  it("lists distinct restaurants for selection, most recent first", () => {
    const options = restaurantOptions([
      job({
        id: "j2",
        restaurantKey: "veronipizza.dk",
        merchantName: "Veroni",
        destinationHost: "https://veronipizza.dk",
        status: "COMPLETED",
        updatedAt: "2026-01-03T00:00:00.000Z",
      }),
      job({
        id: "j1",
        restaurantKey: "veronipizza.dk",
        merchantName: "Veroni",
        status: "COMPLETED",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      job({
        id: "j3",
        restaurantKey: "other.dk",
        merchantName: "Other",
        destinationHost: "https://other.dk",
        status: "QUEUED",
        updatedAt: "2026-01-04T00:00:00.000Z",
      }),
    ]);
    expect(options).toHaveLength(2);
    expect(options[0]!.restaurantKey).toBe("other.dk");
    expect(options[1]!.restaurantKey).toBe("veronipizza.dk");
    expect(options[1]!.destinationHost).toBe("https://veronipizza.dk");
  });
});
