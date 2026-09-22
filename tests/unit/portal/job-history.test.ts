import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PortalStore, resetPortalStoreForTests } from "../../../src/portal/store.js";
import { buildJobHistory } from "../../../apps/portal/src/components/history/historyView.js";

/**
 * UI-3 history: the two new store queries (listJobRuns, listReviewAnswers) and
 * the pure timeline assembly that consumes them. Ordering matters because the
 * timeline must be deterministic and newest-first from the database.
 */
describe("portal job history", () => {
  let dir: string;
  let store: PortalStore;

  beforeEach(() => {
    resetPortalStoreForTests();
    dir = mkdtempSync(join(tmpdir(), "portal-history-"));
    process.env.PORTAL_DB_PATH = join(dir, "portal.sqlite");
    process.env.PORTAL_DATA_DIR = dir;
    store = new PortalStore(process.env.PORTAL_DB_PATH);
  });

  afterEach(() => {
    store.close();
    resetPortalStoreForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeJob() {
    const emp = store.createEmployee({
      email: `h-${Date.now()}@takeawayhero.test`,
      name: "Historian",
      password: "s3cret-pass",
      role: "operator",
    });
    const job = store.createJob({
      merchantName: "History Merchant",
      destinationHost: "https://example.com",
      sourceType: "pdf_upload",
      sourceUrl: null,
      createdByEmployeeId: emp.id,
      status: "ARTIFACTS",
    });
    return { emp, job };
  }

  it("listJobRuns returns all runs newest first", () => {
    const { job } = makeJob();
    const first = store.createJobRun(job.id, "/runs/first", "EXTRACTING");
    const second = store.createJobRun(job.id, "/runs/second", "COMPLETED");
    // startedAt is timestamped on insert; force deterministic ordering.
    store.finishJobRun(first.id, "COMPLETED", null, null);
    store.finishJobRun(second.id, "COMPLETED", null, null);

    const runs = store.listJobRuns(job.id);
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((r) => r.runDir))).toEqual(
      new Set(["/runs/first", "/runs/second"]),
    );
    const times = runs.map((r) => Date.parse(r.startedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("listReviewAnswers returns only this job's answers, newest first", () => {
    const { emp, job } = makeJob();
    const other = makeJob();
    store.replaceOpenQuestions(job.id, [
      {
        questionType: "INGREDIENTS",
        title: "Q1",
        prompt: "p",
        optionsJson: JSON.stringify([
          { id: "a", label: "A", resolution: "KEEP" },
        ]),
        productRef: null,
        batchKey: null,
        decisionCaseId: null,
      },
    ]);
    store.replaceOpenQuestions(other.job.id, [
      {
        questionType: "INGREDIENTS",
        title: "Other",
        prompt: "p",
        optionsJson: JSON.stringify([
          { id: "a", label: "A", resolution: "KEEP" },
        ]),
        productRef: null,
        batchKey: null,
        decisionCaseId: null,
      },
    ]);
    const mine = store.listOpenQuestions(job.id)[0]!;
    const theirs = store.listOpenQuestions(other.job.id)[0]!;
    store.answerQuestion({
      questionId: mine.id,
      employeeId: emp.id,
      selectedOptionId: "a",
      scopePreference: "single",
    });
    store.answerQuestion({
      questionId: theirs.id,
      employeeId: other.emp.id,
      selectedOptionId: "a",
      scopePreference: "single",
    });

    const answers = store.listReviewAnswers(job.id);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.jobId).toBe(job.id);
    expect(answers[0]!.resolution).toBe("KEEP");
  });

  it("buildJobHistory orders entries newest first and includes creation", () => {
    const { job } = makeJob();
    const entries = buildJobHistory({
      job: { createdAt: job.createdAt, workflow: job.workflow, status: job.status },
      runs: [
        {
          id: "run_1",
          jobId: job.id,
          runDir: "/runs/one",
          startedAt: "2026-01-01T10:00:00.000Z",
          finishedAt: "2026-01-01T10:05:00.000Z",
          status: "COMPLETED",
          metricsJson: null,
          errorMessage: null,
        },
      ],
      reviewAnswers: [],
    });
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("CREATED");
    expect(kinds).toContain("RUN");
    expect(kinds).toContain("APPROVAL");
    expect(kinds).toContain("EXECUTION");
    const times = entries.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("buildJobHistory resolves review-answer authors to display names", () => {
    const entries = buildJobHistory({
      job: {
        createdAt: "2026-01-01T09:00:00.000Z",
        workflow: "CREATE_MENU",
        status: "AWAITING_REVIEW",
      },
      runs: [],
      reviewAnswers: [
        {
          id: "ra_1",
          questionId: "q_1",
          jobId: "job_1",
          employeeId: "emp_1",
          selectedOptionId: "a",
          resolution: "KEEP",
          scopePreference: "single",
          comment: "looks fine",
          createdAt: "2026-01-01T09:30:00.000Z",
        },
      ],
      employeeNames: { emp_1: "Ada Operator" },
    });
    const answer = entries.find((e) => e.kind === "REVIEW_ANSWER");
    expect(answer?.detail).toContain("Ada Operator");
    expect(answer?.detail).toContain("looks fine");
  });
});
