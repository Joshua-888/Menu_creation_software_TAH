import { describe, expect, it } from "vitest";
import {
  buildQaDashboard,
  isQaAwaitingReview,
} from "../../../src/portal/qaDashboard.js";
import type { MigrationJob } from "../../../src/portal/types.js";

function job(
  partial: Partial<MigrationJob> & Pick<MigrationJob, "id" | "workflow" | "status">,
): MigrationJob {
  return {
    restaurantKey: partial.restaurantKey ?? "veronipizza.dk",
    merchantName: partial.merchantName ?? "Merchant",
    destinationHost: partial.destinationHost ?? "https://x.dk",
    sourceType: "pdf_upload",
    sourceUrl: null,
    createdByEmployeeId: "emp_1",
    errorMessage: null,
    remainingQuestions: partial.remainingQuestions ?? 0,
    createdAt: partial.createdAt ?? "2026-01-02T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-02T00:00:00.000Z",
    ...partial,
  };
}

describe("isQaAwaitingReview", () => {
  it("flags open questions or the awaiting-review status", () => {
    expect(isQaAwaitingReview({ status: "AWAITING_REVIEW", remainingQuestions: 0 })).toBe(true);
    expect(isQaAwaitingReview({ status: "COMPLETED", remainingQuestions: 2 })).toBe(true);
    expect(isQaAwaitingReview({ status: "COMPLETED", remainingQuestions: 0 })).toBe(false);
  });
});

describe("buildQaDashboard", () => {
  it("only counts QA_RECONCILE jobs", () => {
    const model = buildQaDashboard({
      jobs: [
        job({ id: "qa1", workflow: "QA_RECONCILE", status: "COMPLETED" }),
        job({ id: "c1", workflow: "CREATE_MENU", status: "COMPLETED" }),
      ],
    });
    expect(model.stats.totalQaJobs).toBe(1);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]!.jobId).toBe("qa1");
  });

  it("aggregates compared products and diffs from findings", () => {
    const model = buildQaDashboard({
      jobs: [
        job({ id: "qa1", workflow: "QA_RECONCILE", status: "COMPLETED" }),
        job({ id: "qa2", workflow: "QA_RECONCILE", status: "COMPLETED" }),
      ],
      findings: {
        qa1: { productCount: 40, withDiffs: 5, blocked: 1 },
        qa2: { productCount: 60, withDiffs: 3 },
      },
    });
    expect(model.stats.comparedProducts).toBe(100);
    expect(model.stats.diffsFound).toBe(8);
  });

  it("counts awaiting-review jobs", () => {
    const model = buildQaDashboard({
      jobs: [
        job({
          id: "qa1",
          workflow: "QA_RECONCILE",
          status: "AWAITING_REVIEW",
          remainingQuestions: 0,
        }),
        job({
          id: "qa2",
          workflow: "QA_RECONCILE",
          status: "COMPLETED",
          remainingQuestions: 2,
        }),
        job({ id: "qa3", workflow: "QA_RECONCILE", status: "COMPLETED" }),
      ],
    });
    expect(model.stats.awaitingReview).toBe(2);
  });

  it("formats a diff summary and tolerates missing findings", () => {
    const model = buildQaDashboard({
      jobs: [
        job({ id: "qa1", workflow: "QA_RECONCILE", status: "COMPLETED" }),
        job({ id: "qa2", workflow: "QA_RECONCILE", status: "COMPLETED" }),
      ],
      findings: { qa1: { productCount: 40, withDiffs: 5 } },
    });
    const row1 = model.rows.find((row) => row.jobId === "qa1")!;
    const row2 = model.rows.find((row) => row.jobId === "qa2")!;
    expect(row1.diffSummary).toBe("5 of 40 with diffs");
    expect(row1.comparedProducts).toBe(40);
    expect(row1.withDiffs).toBe(5);
    expect(row2.diffSummary).toBe("No findings yet");
    expect(row2.comparedProducts).toBeNull();
    expect(row2.withDiffs).toBeNull();
  });

  it("handles partial findings gracefully", () => {
    const model = buildQaDashboard({
      jobs: [job({ id: "qa1", workflow: "QA_RECONCILE", status: "COMPLETED" })],
      findings: { qa1: { withDiffs: 4 } },
    });
    const row = model.rows[0]!;
    expect(row.comparedProducts).toBeNull();
    expect(row.withDiffs).toBe(4);
    expect(row.diffSummary).toBe("4 diffs");
    expect(model.stats.comparedProducts).toBe(0);
    expect(model.stats.diffsFound).toBe(4);
  });

  it("returns an empty model when there are no QA jobs", () => {
    const model = buildQaDashboard({
      jobs: [job({ id: "c1", workflow: "CREATE_MENU", status: "COMPLETED" })],
    });
    expect(model.stats.totalQaJobs).toBe(0);
    expect(model.rows).toEqual([]);
  });
});
