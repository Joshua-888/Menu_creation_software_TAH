import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Signed session cookie injected into the mocked `next/headers` jar. */
const hoisted = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "tah_portal_session" && hoisted.cookie
        ? { value: hoisted.cookie }
        : undefined,
  }),
}));

/**
 * App-layer routes import the engine through the Next `@engine/*` alias, which
 * plain vitest does not resolve. Re-export the real modules under those
 * specifiers so the route under test runs against the exact same store
 * singleton (and SQLite file) as this suite.
 */
vi.mock("@engine/portal/index.js", async () => {
  const store = await import("../../../src/portal/store.js");
  const auth = await import("../../../src/portal/auth.js");
  const artifacts = await import("../../../src/portal/artifacts.js");
  return {
    getPortalStore: store.getPortalStore,
    resetPortalStoreForTests: store.resetPortalStoreForTests,
    parseSignedSession: auth.parseSignedSession,
    SESSION_COOKIE: auth.SESSION_COOKIE,
    sessionSecret: auth.sessionSecret,
    readJobArtifact: artifacts.readJobArtifact,
  };
});

vi.mock("@engine/portal/worker.js", async () => {
  const worker = await import("../../../src/portal/worker.js");
  return {
    schedulePostReviewLiveIfReady: worker.schedulePostReviewLiveIfReady,
  };
});

import {
  SESSION_COOKIE,
  sessionSecret,
  signSessionValue,
} from "../../../src/portal/auth.js";
import { submitReviewAnswer } from "../../../src/portal/review.js";
import {
  getPortalStore,
  resetPortalStoreForTests,
} from "../../../src/portal/store.js";
import type { PortalStore } from "../../../src/portal/store.js";
import type { JobStatus } from "../../../src/portal/types.js";
import { schedulePostReviewLiveIfReady } from "../../../src/portal/worker.js";

const ENV_KEYS = [
  "PORTAL_DB_PATH",
  "PORTAL_DATA_DIR",
  "PORTAL_SESSION_SECRET",
  "PORTAL_LIVE_WRITES",
  "TAH_ADMIN_EMAIL",
  "TAH_ADMIN_PASSWORD",
] as const;

/** Quality contract states used by the safety gate. */
type QualityArtifact =
  | "MENU_QUALITY_BLOCKED"
  | "MENU_QUALITY_READY"
  | "MENU_QUALITY_REVIEW"
  | null;

describe("BLOCKED menu-quality approval gate (Part A safety fix)", () => {
  let dir: string;
  let store: PortalStore;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    resetPortalStoreForTests();
    dir = mkdtempSync(join(tmpdir(), "quality-block-gate-"));
    process.env.PORTAL_DB_PATH = join(dir, "portal.sqlite");
    process.env.PORTAL_DATA_DIR = dir;
    process.env.PORTAL_SESSION_SECRET = "test-session-secret-value";
    // Singleton so the route + worker under test share this exact database.
    store = getPortalStore();
  });

  afterEach(() => {
    resetPortalStoreForTests();
    hoisted.cookie = undefined;
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Seeds a CREATE_MENU job plus its latest run dir, optionally writing the
   * quality-contract artifact that gates approval.
   */
  function seed(input: {
    status?: JobStatus;
    quality: QualityArtifact;
    openQuestion?: boolean;
    qualityArtifactName?: "menu-quality-contract.json" | "quality-report.json";
  }): { jobId: string; employeeId: string; runDir: string } {
    const employee = store.createEmployee({
      email: `operator-${Math.random().toString(36).slice(2)}@example.test`,
      name: "Operator",
      password: "password-123",
      role: "operator",
    });
    const job = store.createJob({
      merchantName: "Blocked Fixture",
      destinationHost: "blocked.example.test",
      sourceType: "pdf_upload",
      sourceUrl: null,
      createdByEmployeeId: employee.id,
      workflow: "CREATE_MENU",
      status: input.status ?? "AWAITING_OPERATOR_APPROVAL",
    });
    const runDir = join(dir, "runs", job.id);
    store.createJobRun(job.id, runDir, job.status);
    mkdirSync(runDir, { recursive: true });
    if (input.quality) {
      writeFileSync(
        join(runDir, input.qualityArtifactName ?? "menu-quality-contract.json"),
        JSON.stringify({ menuStatus: input.quality }),
        "utf8",
      );
    }
    if (input.openQuestion) {
      store.replaceOpenQuestions(job.id, [
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
    }
    return { jobId: job.id, employeeId: employee.id, runDir };
  }

  it("API returns 409 with a quality-block error for a BLOCKED menu", async () => {
    const s = seed({ quality: "MENU_QUALITY_BLOCKED" });
    const session = store.createSession(s.employeeId);
    hoisted.cookie = signSessionValue(session.token, sessionSecret());
    expect(hoisted.cookie).toBe(
      signSessionValue(session.token, sessionSecret()),
    );
    expect(SESSION_COOKIE).toBe("tah_portal_session");

    const { POST } = await vi.importActual<{
      POST: (
        req: Request,
        ctx: { params: Promise<{ id: string }> },
      ) => Promise<Response>;
    }>("../../../apps/portal/src/app/api/jobs/[id]/approve/route.ts");
    const response = await POST(
      new Request(`http://localhost/api/jobs/${s.jobId}/approve`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: s.jobId }) },
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: string };
    expect(body.error ?? "").toMatch(/MENU_QUALITY_BLOCKED/);
    expect(store.getJob(s.jobId)?.status).toBe("AWAITING_OPERATOR_APPROVAL");
  });

  it("schedulePostReviewLiveIfReady refuses a BLOCKED menu even when live writes are enabled", () => {
    process.env.PORTAL_LIVE_WRITES = "1";
    process.env.TAH_ADMIN_EMAIL = "admin@example.test";
    process.env.TAH_ADMIN_PASSWORD = "secret-password";
    const s = seed({ quality: "MENU_QUALITY_BLOCKED" });

    expect(schedulePostReviewLiveIfReady(s.jobId)).toBe(false);
    expect(store.getJob(s.jobId)?.status).toBe("AWAITING_OPERATOR_APPROVAL");
  });

  it("does not schedule a BLOCKED menu when live writes are disabled", () => {
    const s = seed({ quality: "MENU_QUALITY_BLOCKED" });
    expect(schedulePostReviewLiveIfReady(s.jobId)).toBe(false);
    expect(store.getJob(s.jobId)?.status).toBe("AWAITING_OPERATOR_APPROVAL");
  });

  it("review transition does not promote a BLOCKED menu to AWAITING_OPERATOR_APPROVAL", () => {
    const s = seed({
      status: "AWAITING_REVIEW",
      quality: "MENU_QUALITY_BLOCKED",
      openQuestion: true,
    });
    const [question] = store.listOpenQuestions(s.jobId);

    const result = submitReviewAnswer(
      {
        questionId: question!.id,
        employeeId: s.employeeId,
        selectedOptionId: "accept",
        scopePreference: "single",
      },
      store,
    );

    expect(result.remaining).toBe(0);
    expect(store.getJob(s.jobId)?.status).toBe("READY_DRY_RUN");
  });

  it("treats a BLOCKED quality-report.json fallback as BLOCKED", () => {
    const s = seed({
      status: "AWAITING_REVIEW",
      quality: "MENU_QUALITY_BLOCKED",
      openQuestion: true,
      qualityArtifactName: "quality-report.json",
    });
    const [question] = store.listOpenQuestions(s.jobId);

    submitReviewAnswer(
      {
        questionId: question!.id,
        employeeId: s.employeeId,
        selectedOptionId: "accept",
        scopePreference: "single",
      },
      store,
    );

    expect(store.getJob(s.jobId)?.status).toBe("READY_DRY_RUN");
  });

  it("still promotes a READY menu to AWAITING_OPERATOR_APPROVAL", () => {
    const s = seed({
      status: "AWAITING_REVIEW",
      quality: "MENU_QUALITY_READY",
      openQuestion: true,
    });
    const [question] = store.listOpenQuestions(s.jobId);

    submitReviewAnswer(
      {
        questionId: question!.id,
        employeeId: s.employeeId,
        selectedOptionId: "accept",
        scopePreference: "single",
      },
      store,
    );

    expect(store.getJob(s.jobId)?.status).toBe("AWAITING_OPERATOR_APPROVAL");
  });

  it("degrades gracefully when no quality artifact exists (older jobs)", () => {
    const s = seed({
      status: "AWAITING_REVIEW",
      quality: null,
      openQuestion: true,
    });
    const [question] = store.listOpenQuestions(s.jobId);

    submitReviewAnswer(
      {
        questionId: question!.id,
        employeeId: s.employeeId,
        selectedOptionId: "accept",
        scopePreference: "single",
      },
      store,
    );

    expect(store.getJob(s.jobId)?.status).toBe("AWAITING_OPERATOR_APPROVAL");
  });

  it("API still returns 409 for a job that is not awaiting approval", async () => {
    const s = seed({ status: "LIVE_EXECUTING", quality: "MENU_QUALITY_READY" });
    const session = store.createSession(s.employeeId);
    hoisted.cookie = signSessionValue(session.token, sessionSecret());

    const { POST } = await vi.importActual<{
      POST: (
        req: Request,
        ctx: { params: Promise<{ id: string }> },
      ) => Promise<Response>;
    }>("../../../apps/portal/src/app/api/jobs/[id]/approve/route.ts");
    const response = await POST(
      new Request(`http://localhost/api/jobs/${s.jobId}/approve`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: s.jobId }) },
    );

    expect(response.status).toBe(409);
  });
});
