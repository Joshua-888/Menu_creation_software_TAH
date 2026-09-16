import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { submitReviewAnswer } from "../../../src/portal/review.js";
import { PortalStore } from "../../../src/portal/store.js";

describe("CREATE_MENU approval gate", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not auto-schedule live execution when review reaches zero", () => {
    const directory = mkdtempSync(join(tmpdir(), "approval-gate-"));
    directories.push(directory);
    const store = new PortalStore(join(directory, "portal.sqlite"));
    const employee = store.createEmployee({
      email: "operator@example.test",
      name: "Operator",
      password: "password-123",
      role: "operator",
    });
    const job = store.createJob({
      merchantName: "Fixture",
      destinationHost: "fixture.test",
      sourceType: "pdf_upload",
      sourceUrl: null,
      createdByEmployeeId: employee.id,
      workflow: "CREATE_MENU",
    });
    const [question] = store.replaceOpenQuestions(job.id, [
      {
        decisionCaseId: null,
        questionType: "QUALITY",
        title: "Review",
        prompt: "Review product",
        optionsJson: JSON.stringify([
          {
            id: "accept",
            label: "Accept",
            resolution: "ACCEPT_EXCEPTION",
          },
        ]),
        productRef: null,
        batchKey: null,
      },
    ]);

    const result = submitReviewAnswer(
      {
        questionId: question!.id,
        employeeId: employee.id,
        selectedOptionId: "accept",
        scopePreference: "single",
      },
      store,
    );

    expect(result.remaining).toBe(0);
    expect(result.scheduledPostReviewLive).toBe(false);
    expect(store.getJob(job.id)?.status).toBe("AWAITING_OPERATOR_APPROVAL");
    store.close();
  });
});
