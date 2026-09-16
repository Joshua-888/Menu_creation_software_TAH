/**
 * Portal SQLite store — employees, sessions, migration jobs, review queue.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  createSessionToken,
  hashPassword,
  normalizeEmail,
  readBootstrapFromEnv,
  sessionExpiresAt,
  verifyPassword,
} from "./auth.js";
import { portalDbPath } from "./paths.js";
import type {
  Employee,
  EmployeeRole,
  JobFile,
  JobMetrics,
  JobRun,
  JobSourceType,
  JobStatus,
  JobWorkflow,
  MigrationJob,
  ReviewAnswer,
  ReviewQuestion,
  Session,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  merchant_name TEXT NOT NULL,
  restaurant_key TEXT NOT NULL,
  destination_host TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  workflow TEXT NOT NULL DEFAULT 'CREATE_MENU',
  status TEXT NOT NULL,
  created_by_employee_id TEXT NOT NULL,
  error_message TEXT,
  remaining_questions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by_employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS job_files (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  run_dir TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  metrics_json TEXT,
  error_message TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS review_questions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  decision_case_id TEXT,
  question_type TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL,
  product_ref TEXT,
  batch_key TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS review_answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  selected_option_id TEXT NOT NULL,
  resolution TEXT NOT NULL,
  scope_preference TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (question_id) REFERENCES review_questions(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
`;

function nowIso(): string {
  return new Date().toISOString();
}

import { normalizeDestinationHost } from "../tah/write/hostAllowlist.js";

function restaurantKeyFromDestinationHost(destinationHost: string): string {
  return normalizeDestinationHost(destinationHost);
}

export function tryNormalizeHost(input: string): string | null {
  try {
    let u = input.trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    const url = new URL(u);
    if (!url.hostname) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function normalizeHost(input: string): string {
  const host = tryNormalizeHost(input);
  if (!host) {
    throw new Error("Invalid destination host");
  }
  return host;
}

export class PortalStore {
  readonly db: DatabaseSync;

  constructor(dbPath = portalDbPath()) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrateSchema();
  }

  /** Additive migrations for existing portal DBs. */
  private migrateSchema(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(jobs)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "workflow")) {
      this.db.exec(
        `ALTER TABLE jobs ADD COLUMN workflow TEXT NOT NULL DEFAULT 'CREATE_MENU'`,
      );
    }
  }

  close(): void {
    this.db.close();
  }

  ensureBootstrapAdmin(): Employee | null {
    const cfg = readBootstrapFromEnv();
    if (!cfg) return null;
    const existing = this.getEmployeeByEmail(cfg.email);
    if (existing) return existing;
    return this.createEmployee({
      email: cfg.email,
      name: cfg.name ?? "Portal Admin",
      password: cfg.password,
      role: cfg.role ?? "admin",
    });
  }

  createEmployee(input: {
    email: string;
    name: string;
    password: string;
    role: EmployeeRole;
  }): Employee {
    const employee: Employee = {
      id: `emp_${randomUUID()}`,
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash: hashPassword(input.password),
      role: input.role,
      active: true,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO employees (id, email, name, password_hash, role, active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        employee.id,
        employee.email,
        employee.name,
        employee.passwordHash,
        employee.role,
        employee.createdAt,
      );
    return employee;
  }

  getEmployeeById(id: string): Employee | null {
    const row = this.db
      .prepare(
        `SELECT id, email, name, password_hash, role, active, created_at
         FROM employees WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          email: string;
          name: string;
          password_hash: string;
          role: string;
          active: number;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      role: row.role as EmployeeRole,
      active: row.active === 1,
      createdAt: row.created_at,
    };
  }

  getEmployeeByEmail(email: string): Employee | null {
    const row = this.db
      .prepare(
        `SELECT id, email, name, password_hash, role, active, created_at
         FROM employees WHERE email = ?`,
      )
      .get(normalizeEmail(email)) as
      | {
          id: string;
          email: string;
          name: string;
          password_hash: string;
          role: string;
          active: number;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      role: row.role as EmployeeRole,
      active: row.active === 1,
      createdAt: row.created_at,
    };
  }

  authenticate(email: string, password: string): Employee | null {
    const emp = this.getEmployeeByEmail(email);
    if (!emp || !emp.active) return null;
    if (!verifyPassword(password, emp.passwordHash)) return null;
    return emp;
  }

  createSession(employeeId: string): Session {
    const session: Session = {
      token: createSessionToken(),
      employeeId,
      expiresAt: sessionExpiresAt(12),
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO sessions (token, employee_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(session.token, session.employeeId, session.expiresAt, session.createdAt);
    return session;
  }

  deleteSession(token: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  }

  getSessionEmployee(token: string): Employee | null {
    const row = this.db
      .prepare(
        `SELECT token, employee_id, expires_at, created_at FROM sessions WHERE token = ?`,
      )
      .get(token) as
      | {
          token: string;
          employee_id: string;
          expires_at: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.deleteSession(token);
      return null;
    }
    const emp = this.getEmployeeById(row.employee_id);
    if (!emp || !emp.active) {
      this.deleteSession(token);
      return null;
    }
    return emp;
  }

  createJob(input: {
    merchantName: string;
    destinationHost: string;
    sourceType: JobSourceType;
    sourceUrl: string | null;
    createdByEmployeeId: string;
    status?: JobStatus;
    workflow?: JobWorkflow;
  }): MigrationJob {
    const now = nowIso();
    const job: MigrationJob = {
      id: `job_${randomUUID()}`,
      merchantName: input.merchantName.trim(),
      restaurantKey: restaurantKeyFromDestinationHost(input.destinationHost),
      destinationHost: normalizeHost(input.destinationHost),
      sourceType: input.sourceType,
      workflow: input.workflow ?? "CREATE_MENU",
      sourceUrl: input.sourceUrl?.trim() || null,
      status: input.status ?? "QUEUED",
      createdByEmployeeId: input.createdByEmployeeId,
      errorMessage: null,
      remainingQuestions: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO jobs (
          id, merchant_name, restaurant_key, destination_host, source_type,
          source_url, workflow, status, created_by_employee_id, error_message,
          remaining_questions, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
      )
      .run(
        job.id,
        job.merchantName,
        job.restaurantKey,
        job.destinationHost,
        job.sourceType,
        job.sourceUrl,
        job.workflow,
        job.status,
        job.createdByEmployeeId,
        job.createdAt,
        job.updatedAt,
      );
    return job;
  }

  updateJobStatus(
    jobId: string,
    status: JobStatus,
    opts?: { errorMessage?: string | null; remainingQuestions?: number },
  ): void {
    const sets = ["status = ?", "updated_at = ?"];
    const params: Array<string | number | null> = [status, nowIso()];
    if (opts && "errorMessage" in opts) {
      sets.push("error_message = ?");
      params.push(opts.errorMessage ?? null);
    }
    if (opts && "remainingQuestions" in opts) {
      sets.push("remaining_questions = ?");
      params.push(opts.remainingQuestions ?? 0);
    }
    params.push(jobId);
    this.db
      .prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
  }

  getJob(jobId: string): MigrationJob | null {
    const row = this.db
      .prepare(
        `SELECT id, merchant_name, restaurant_key, destination_host, source_type,
                source_url, workflow, status, created_by_employee_id, error_message,
                remaining_questions, created_at, updated_at
         FROM jobs WHERE id = ?`,
      )
      .get(jobId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapJob(row);
  }

  /** Delete job and related portal rows (files/questions/answers/runs). */
  deleteJob(jobId: string): boolean {
    const existing = this.getJob(jobId);
    if (!existing) return false;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`DELETE FROM review_answers WHERE job_id = ?`)
        .run(jobId);
      this.db
        .prepare(`DELETE FROM review_questions WHERE job_id = ?`)
        .run(jobId);
      this.db.prepare(`DELETE FROM job_files WHERE job_id = ?`).run(jobId);
      this.db.prepare(`DELETE FROM job_runs WHERE job_id = ?`).run(jobId);
      this.db.prepare(`DELETE FROM jobs WHERE id = ?`).run(jobId);
      this.db.exec("COMMIT");
      return true;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  listJobs(): MigrationJob[] {
    const rows = this.db
      .prepare(
        `SELECT id, merchant_name, restaurant_key, destination_host, source_type,
                source_url, workflow, status, created_by_employee_id, error_message,
                remaining_questions, created_at, updated_at
         FROM jobs ORDER BY created_at DESC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapJob(r));
  }

  private mapJob(row: Record<string, unknown>): MigrationJob {
    const workflowRaw = String(row.workflow ?? "CREATE_MENU");
    const workflow: JobWorkflow =
      workflowRaw === "QA_RECONCILE" ? "QA_RECONCILE" : "CREATE_MENU";
    return {
      id: String(row.id),
      merchantName: String(row.merchant_name),
      restaurantKey: String(row.restaurant_key),
      destinationHost: String(row.destination_host),
      sourceType: row.source_type as JobSourceType,
      workflow,
      sourceUrl: (row.source_url as string | null) ?? null,
      status: row.status as JobStatus,
      createdByEmployeeId: String(row.created_by_employee_id),
      errorMessage: (row.error_message as string | null) ?? null,
      remainingQuestions: Number(row.remaining_questions ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  addJobFile(input: {
    jobId: string;
    originalName: string;
    storedPath: string;
    mimeType: string;
    sizeBytes: number;
  }): JobFile {
    const file: JobFile = {
      id: `file_${randomUUID()}`,
      jobId: input.jobId,
      originalName: input.originalName,
      storedPath: input.storedPath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO job_files (id, job_id, original_name, stored_path, mime_type, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        file.id,
        file.jobId,
        file.originalName,
        file.storedPath,
        file.mimeType,
        file.sizeBytes,
        file.createdAt,
      );
    return file;
  }

  listJobFiles(jobId: string): JobFile[] {
    const rows = this.db
      .prepare(
        `SELECT id, job_id, original_name, stored_path, mime_type, size_bytes, created_at
         FROM job_files WHERE job_id = ? ORDER BY created_at ASC`,
      )
      .all(jobId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      originalName: String(r.original_name),
      storedPath: String(r.stored_path),
      mimeType: String(r.mime_type),
      sizeBytes: Number(r.size_bytes),
      createdAt: String(r.created_at),
    }));
  }

  createJobRun(jobId: string, runDir: string, status: JobStatus): JobRun {
    const run: JobRun = {
      id: `run_${randomUUID()}`,
      jobId,
      runDir,
      startedAt: nowIso(),
      finishedAt: null,
      status,
      metricsJson: null,
      errorMessage: null,
    };
    this.db
      .prepare(
        `INSERT INTO job_runs (id, job_id, run_dir, started_at, finished_at, status, metrics_json, error_message)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL)`,
      )
      .run(run.id, run.jobId, run.runDir, run.startedAt, run.status);
    return run;
  }

  finishJobRun(
    runId: string,
    status: JobStatus,
    metrics: JobMetrics | null,
    errorMessage: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE job_runs SET finished_at = ?, status = ?, metrics_json = ?, error_message = ?
         WHERE id = ?`,
      )
      .run(
        nowIso(),
        status,
        metrics ? JSON.stringify(metrics) : null,
        errorMessage,
        runId,
      );
  }

  latestJobRun(jobId: string): JobRun | null {
    const row = this.db
      .prepare(
        `SELECT id, job_id, run_dir, started_at, finished_at, status, metrics_json, error_message
         FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1`,
      )
      .get(jobId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      runDir: String(row.run_dir),
      startedAt: String(row.started_at),
      finishedAt: (row.finished_at as string | null) ?? null,
      status: row.status as JobStatus,
      metricsJson: (row.metrics_json as string | null) ?? null,
      errorMessage: (row.error_message as string | null) ?? null,
    };
  }

  replaceOpenQuestions(jobId: string, questions: Omit<ReviewQuestion, "id" | "createdAt" | "status" | "jobId">[]): ReviewQuestion[] {
    this.db
      .prepare(`DELETE FROM review_questions WHERE job_id = ? AND status = 'open'`)
      .run(jobId);
    const created: ReviewQuestion[] = [];
    const insert = this.db.prepare(
      `INSERT INTO review_questions (
        id, job_id, decision_case_id, question_type, title, prompt, options_json,
        product_ref, batch_key, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    );
    for (const q of questions) {
      const row: ReviewQuestion = {
        id: `rq_${randomUUID()}`,
        jobId,
        decisionCaseId: q.decisionCaseId,
        questionType: q.questionType,
        title: q.title,
        prompt: q.prompt,
        optionsJson: q.optionsJson,
        productRef: q.productRef,
        batchKey: q.batchKey,
        status: "open",
        createdAt: nowIso(),
      };
      insert.run(
        row.id,
        row.jobId,
        row.decisionCaseId,
        row.questionType,
        row.title,
        row.prompt,
        row.optionsJson,
        row.productRef,
        row.batchKey,
        row.createdAt,
      );
      created.push(row);
    }
    const workflow = this.getJob(jobId)?.workflow;
    const nextStatus: JobStatus = questions.length
      ? "AWAITING_REVIEW"
      : workflow === "CREATE_MENU"
        ? "AWAITING_OPERATOR_APPROVAL"
        : "READY_DRY_RUN";
    this.updateJobStatus(jobId, nextStatus, {
      remainingQuestions: questions.length,
    });
    return created;
  }

  listOpenQuestions(jobId?: string): ReviewQuestion[] {
    const sql = jobId
      ? `SELECT * FROM review_questions WHERE job_id = ? AND status = 'open' ORDER BY created_at ASC`
      : `SELECT * FROM review_questions WHERE status = 'open' ORDER BY created_at ASC`;
    const rows = (
      jobId ? this.db.prepare(sql).all(jobId) : this.db.prepare(sql).all()
    ) as Record<string, unknown>[];
    return rows.map((r) => this.mapQuestion(r));
  }

  getQuestion(id: string): ReviewQuestion | null {
    const row = this.db
      .prepare(`SELECT * FROM review_questions WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapQuestion(row);
  }

  private mapQuestion(r: Record<string, unknown>): ReviewQuestion {
    return {
      id: String(r.id),
      jobId: String(r.job_id),
      decisionCaseId: (r.decision_case_id as string | null) ?? null,
      questionType: String(r.question_type),
      title: String(r.title),
      prompt: String(r.prompt),
      optionsJson: String(r.options_json),
      productRef: (r.product_ref as string | null) ?? null,
      batchKey: (r.batch_key as string | null) ?? null,
      status: r.status as ReviewQuestion["status"],
      createdAt: String(r.created_at),
    };
  }

  answerQuestion(input: {
    questionId: string;
    employeeId: string;
    selectedOptionId: string;
    /** Ignored — resolution is always taken from the matched option. */
    resolution?: string;
    scopePreference: ReviewAnswer["scopePreference"];
    comment?: string | null;
  }): { answer: ReviewAnswer; resolvedIds: string[] } {
    const q = this.getQuestion(input.questionId);
    if (!q || q.status !== "open") {
      throw new Error("Question not found or already answered");
    }
    let options: Array<{ id: string; label?: string; resolution: string }>;
    try {
      options = JSON.parse(q.optionsJson) as Array<{
        id: string;
        label?: string;
        resolution: string;
      }>;
    } catch {
      throw new Error("Question options are corrupt");
    }
    if (!Array.isArray(options)) {
      throw new Error("Question options are corrupt");
    }
    const selected = options.find((o) => o.id === input.selectedOptionId);
    if (!selected || typeof selected.resolution !== "string") {
      throw new Error("Invalid selected option");
    }
    const resolution = selected.resolution;
    const answer: ReviewAnswer = {
      id: `ra_${randomUUID()}`,
      questionId: q.id,
      jobId: q.jobId,
      employeeId: input.employeeId,
      selectedOptionId: input.selectedOptionId,
      resolution,
      scopePreference: input.scopePreference,
      comment: input.comment ?? null,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO review_answers (
          id, question_id, job_id, employee_id, selected_option_id, resolution,
          scope_preference, comment, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        answer.id,
        answer.questionId,
        answer.jobId,
        answer.employeeId,
        answer.selectedOptionId,
        answer.resolution,
        answer.scopePreference,
        answer.comment,
        answer.createdAt,
      );

    const resolvedIds = [q.id];
    this.db
      .prepare(`UPDATE review_questions SET status = 'answered' WHERE id = ?`)
      .run(q.id);

    if (
      (input.scopePreference === "batch_similar" ||
        input.scopePreference === "restaurant") &&
      q.batchKey
    ) {
      const siblings = this.db
        .prepare(
          `SELECT id FROM review_questions
           WHERE job_id = ? AND batch_key = ? AND status = 'open' AND id != ?`,
        )
        .all(q.jobId, q.batchKey, q.id) as { id: string }[];
      for (const s of siblings) {
        this.db
          .prepare(
            `UPDATE review_questions SET status = 'batch_resolved' WHERE id = ?`,
          )
          .run(s.id);
        resolvedIds.push(s.id);
      }
    }

    const remaining = this.listOpenQuestions(q.jobId).length;
    const workflow = this.getJob(q.jobId)?.workflow;
    const nextStatus: JobStatus = remaining
      ? "AWAITING_REVIEW"
      : workflow === "CREATE_MENU"
        ? "AWAITING_OPERATOR_APPROVAL"
        : "READY_DRY_RUN";
    this.updateJobStatus(q.jobId, nextStatus, {
      remainingQuestions: remaining,
    });
    return { answer, resolvedIds };
  }
}

let singleton: PortalStore | null = null;

export function getPortalStore(): PortalStore {
  if (!singleton) {
    singleton = new PortalStore();
    singleton.ensureBootstrapAdmin();
  }
  return singleton;
}

export function resetPortalStoreForTests(): void {
  if (singleton) {
    try {
      singleton.close();
    } catch {
      /* ignore */
    }
    singleton = null;
  }
}
