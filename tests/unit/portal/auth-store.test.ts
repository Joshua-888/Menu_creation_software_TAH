import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashPassword,
  parseSignedSession,
  signSessionValue,
  verifyPassword,
} from "../../../src/portal/auth.js";
import { PortalStore, resetPortalStoreForTests } from "../../../src/portal/store.js";
import { submitReviewAnswer } from "../../../src/portal/review.js";

describe("portal auth", () => {
  it("hashes and verifies passwords with scrypt", () => {
    const hash = hashPassword("correct-horse");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct-horse", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("signs and verifies session cookies", () => {
    const token = "abc123token";
    const signed = signSessionValue(token, "test-secret-value!!");
    expect(parseSignedSession(signed, "test-secret-value!!")).toBe(token);
    expect(parseSignedSession(signed, "other-secret!!!!!!")).toBeNull();
  });
});

describe("portal store + review", () => {
  let dir: string;
  let store: PortalStore;

  beforeEach(() => {
    resetPortalStoreForTests();
    dir = mkdtempSync(join(tmpdir(), "portal-test-"));
    process.env.PORTAL_DB_PATH = join(dir, "portal.sqlite");
    process.env.PORTAL_DATA_DIR = dir;
    delete process.env.ADMIN_BOOTSTRAP_EMAIL;
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    store = new PortalStore(process.env.PORTAL_DB_PATH);
  });

  afterEach(() => {
    store.close();
    resetPortalStoreForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates employee sessions and jobs", () => {
    const emp = store.createEmployee({
      email: "ops@takeawayhero.test",
      name: "Ops",
      password: "s3cret-pass",
      role: "operator",
    });
    expect(store.authenticate("ops@takeawayhero.test", "s3cret-pass")?.id).toBe(
      emp.id,
    );
    expect(store.authenticate("ops@takeawayhero.test", "nope")).toBeNull();

    const session = store.createSession(emp.id);
    expect(store.getSessionEmployee(session.token)?.email).toBe(
      "ops@takeawayhero.test",
    );

    const job = store.createJob({
      merchantName: "Veroni Pizza",
      destinationHost: "https://veronipizza.dk",
      sourceType: "pdf_upload",
      sourceUrl: null,
      createdByEmployeeId: emp.id,
    });
    expect(job.restaurantKey).toContain("veroni");
    expect(store.listJobs()).toHaveLength(1);
  });

  it("batch-resolves similar review questions", () => {
    const emp = store.createEmployee({
      email: "reviewer@takeawayhero.test",
      name: "Reviewer",
      password: "s3cret-pass",
      role: "operator",
    });
    const job = store.createJob({
      merchantName: "Test Merchant",
      destinationHost: "https://example.com",
      sourceType: "pdf_upload",
      sourceUrl: null,
      createdByEmployeeId: emp.id,
    });
    store.replaceOpenQuestions(job.id, [
      {
        decisionCaseId: null,
        questionType: "MISSING_INGREDIENTS",
        title: "Q1",
        prompt: "Missing ingredients",
        optionsJson: JSON.stringify([
          { id: "accept", label: "Accept", resolution: "ACCEPT" },
        ]),
        productRef: "p1",
        batchKey: "MISSING_INGREDIENTS:ingredients",
      },
      {
        decisionCaseId: null,
        questionType: "MISSING_INGREDIENTS",
        title: "Q2",
        prompt: "Missing ingredients",
        optionsJson: JSON.stringify([
          { id: "accept", label: "Accept", resolution: "ACCEPT" },
        ]),
        productRef: "p2",
        batchKey: "MISSING_INGREDIENTS:ingredients",
      },
    ]);
    const open = store.listOpenQuestions(job.id);
    expect(open).toHaveLength(2);

    const result = submitReviewAnswer(
      {
        questionId: open[0]!.id,
        employeeId: emp.id,
        selectedOptionId: "accept",
        resolution: "ACCEPT",
        scopePreference: "batch_similar",
      },
      store,
    );
    expect(result.resolvedIds).toHaveLength(2);
    expect(result.remaining).toBe(0);
    expect(store.getJob(job.id)?.status).toBe("READY_DRY_RUN");
  });
});
