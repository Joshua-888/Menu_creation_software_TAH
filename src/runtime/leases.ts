import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { normalizeDestinationHost } from "../tah/write/hostAllowlist.js";

export const LEASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS job_leases (
  job_id TEXT PRIMARY KEY,
  run_id TEXT,
  owner TEXT NOT NULL,
  stage TEXT NOT NULL,
  state TEXT NOT NULL,
  lease_started_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  current_operation_id TEXT,
  last_completed_checkpoint TEXT,
  deadline_at TEXT,
  failure_classification TEXT,
  resume_eligible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS destination_write_locks (
  destination_host TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  lease_started_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocker_records (
  blocker_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  operation_id TEXT,
  classification TEXT NOT NULL,
  scope TEXT NOT NULL,
  severity TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  endpoint TEXT,
  http_status INTEGER,
  adapter_version TEXT,
  contract_fingerprint TEXT,
  production_sha TEXT,
  destination_host TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  safe_automatic_action TEXT,
  retry_policy TEXT,
  requires_human INTEGER NOT NULL DEFAULT 1,
  evidence_json TEXT NOT NULL
);
`;

const DEFAULT_LEASE_MS = 120_000;

function nowIso(): string {
  return new Date().toISOString();
}

function expiresIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export type JobLease = {
  jobId: string;
  runId: string | null;
  owner: string;
  stage: string;
  state: string;
  leaseStartedAt: string;
  leaseExpiresAt: string;
  lastHeartbeatAt: string;
  currentOperationId: string | null;
  lastCompletedCheckpoint: string | null;
  deadlineAt: string | null;
  failureClassification: string | null;
  resumeEligible: boolean;
};

export function ensureLeaseSchema(db: DatabaseSync): void {
  db.exec(LEASE_SCHEMA);
}

export function acquireJobLease(
  db: DatabaseSync,
  input: {
    jobId: string;
    owner: string;
    stage: string;
    now?: Date;
    ttlMs?: number;
  },
): { ok: true; lease: JobLease } | { ok: false; code: "WORKER_LEASE_HELD" } {
  ensureLeaseSchema(db);
  const now = input.now ?? new Date();
  const ttl = input.ttlMs ?? DEFAULT_LEASE_MS;
  const existing = db
    .prepare(`SELECT * FROM job_leases WHERE job_id = ?`)
    .get(input.jobId) as Record<string, unknown> | undefined;
  if (existing && String(existing.lease_expires_at) > now.toISOString()) {
    if (String(existing.owner) !== input.owner) {
      return { ok: false, code: "WORKER_LEASE_HELD" };
    }
  }
  const started = now.toISOString();
  const expires = new Date(now.getTime() + ttl).toISOString();
  db.prepare(
    `INSERT INTO job_leases (
      job_id, run_id, owner, stage, state, lease_started_at, lease_expires_at,
      last_heartbeat_at, current_operation_id, last_completed_checkpoint,
      deadline_at, failure_classification, resume_eligible
    ) VALUES (?, NULL, ?, ?, 'RUNNING', ?, ?, ?, NULL, NULL, NULL, NULL, 1)
    ON CONFLICT(job_id) DO UPDATE SET
      owner = excluded.owner,
      stage = excluded.stage,
      state = 'RUNNING',
      lease_started_at = excluded.lease_started_at,
      lease_expires_at = excluded.lease_expires_at,
      last_heartbeat_at = excluded.last_heartbeat_at,
      resume_eligible = 1`,
  ).run(input.jobId, input.owner, input.stage, started, expires, started);
  return {
    ok: true,
    lease: {
      jobId: input.jobId,
      runId: null,
      owner: input.owner,
      stage: input.stage,
      state: "RUNNING",
      leaseStartedAt: started,
      leaseExpiresAt: expires,
      lastHeartbeatAt: started,
      currentOperationId: null,
      lastCompletedCheckpoint: null,
      deadlineAt: null,
      failureClassification: null,
      resumeEligible: true,
    },
  };
}

export function heartbeatJobLease(
  db: DatabaseSync,
  input: { jobId: string; owner: string; ttlMs?: number; checkpoint?: string; operationId?: string },
): { ok: true } | { ok: false; code: "WORKER_LEASE_EXPIRED" } {
  const now = nowIso();
  const expires = expiresIso(input.ttlMs ?? DEFAULT_LEASE_MS);
  const row = db
    .prepare(`SELECT owner, lease_expires_at FROM job_leases WHERE job_id = ?`)
    .get(input.jobId) as { owner: string; lease_expires_at: string } | undefined;
  if (!row || row.owner !== input.owner || row.lease_expires_at < now) {
    return { ok: false, code: "WORKER_LEASE_EXPIRED" };
  }
  db.prepare(
    `UPDATE job_leases SET last_heartbeat_at = ?, lease_expires_at = ?,
      last_completed_checkpoint = COALESCE(?, last_completed_checkpoint),
      current_operation_id = COALESCE(?, current_operation_id)
     WHERE job_id = ? AND owner = ?`,
  ).run(
    now,
    expires,
    input.checkpoint ?? null,
    input.operationId ?? null,
    input.jobId,
    input.owner,
  );
  return { ok: true };
}

export function releaseJobLease(
  db: DatabaseSync,
  input: { jobId: string; owner: string; state?: string },
): void {
  db.prepare(
    `UPDATE job_leases SET state = ?, lease_expires_at = ? WHERE job_id = ? AND owner = ?`,
  ).run(input.state ?? "RELEASED", nowIso(), input.jobId, input.owner);
}

export function acquireDestinationWriteLock(
  db: DatabaseSync,
  input: {
    destinationHost: string;
    jobId: string;
    owner: string;
    ttlMs?: number;
    now?: Date;
  },
): { ok: true } | { ok: false; code: "DESTINATION_WRITE_LOCKED"; holder: string } {
  ensureLeaseSchema(db);
  const host = normalizeDestinationHost(input.destinationHost);
  const now = (input.now ?? new Date()).toISOString();
  const ttl = input.ttlMs ?? DEFAULT_LEASE_MS;
  const existing = db
    .prepare(`SELECT job_id, owner, lease_expires_at FROM destination_write_locks WHERE destination_host = ?`)
    .get(host) as
    | { job_id: string; owner: string; lease_expires_at: string }
    | undefined;
  if (existing && existing.lease_expires_at > now) {
    if (existing.job_id !== input.jobId && existing.owner !== input.owner) {
      return {
        ok: false,
        code: "DESTINATION_WRITE_LOCKED",
        holder: existing.job_id,
      };
    }
  }
  const started = now;
  const expires = expiresIso(ttl);
  db.prepare(
    `INSERT INTO destination_write_locks (
      destination_host, job_id, owner, lease_started_at, lease_expires_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(destination_host) DO UPDATE SET
      job_id = excluded.job_id,
      owner = excluded.owner,
      lease_started_at = excluded.lease_started_at,
      lease_expires_at = excluded.lease_expires_at`,
  ).run(host, input.jobId, input.owner, started, expires);
  return { ok: true };
}

export function releaseDestinationWriteLock(
  db: DatabaseSync,
  input: { destinationHost: string; jobId: string },
): void {
  const host = normalizeDestinationHost(input.destinationHost);
  db.prepare(
    `DELETE FROM destination_write_locks WHERE destination_host = ? AND job_id = ?`,
  ).run(host, input.jobId);
}

export function newLeaseOwner(): string {
  return `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
}

export function reclaimExpiredLeases(
  db: DatabaseSync,
  now: Date = new Date(),
): { expiredJobs: string[] } {
  ensureLeaseSchema(db);
  const n = now.toISOString();
  const expired = db
    .prepare(
      `SELECT job_id FROM job_leases WHERE state = 'RUNNING' AND lease_expires_at < ?`,
    )
    .all(n) as Array<{ job_id: string }>;
  db.prepare(
    `UPDATE job_leases SET state = 'WORKER_LEASE_EXPIRED', failure_classification = 'WORKER_LEASE_EXPIRED'
     WHERE state = 'RUNNING' AND lease_expires_at < ?`,
  ).run(n);
  db.prepare(
    `DELETE FROM destination_write_locks WHERE lease_expires_at < ?`,
  ).run(n);
  return { expiredJobs: expired.map((row) => row.job_id) };
}

export function persistBlockerRecord(
  db: DatabaseSync,
  record: {
    blockerId: string;
    runId: string;
    operationId?: string | null;
    classification: string;
    scope: string;
    severity: string;
    fingerprint: string;
    endpoint?: string | null;
    httpStatus?: number | null;
    adapterVersion?: string | null;
    contractFingerprint?: string | null;
    productionSha?: string | null;
    destinationHost?: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    occurrenceCount?: number;
    safeAutomaticAction?: string | null;
    retryPolicy?: string | null;
    requiresHuman?: boolean;
    evidenceJson?: string;
  },
): void {
  ensureLeaseSchema(db);
  db.prepare(
    `INSERT INTO blocker_records (
      blocker_id, run_id, operation_id, classification, scope, severity, fingerprint,
      endpoint, http_status, adapter_version, contract_fingerprint, production_sha,
      destination_host, first_seen_at, last_seen_at, occurrence_count,
      safe_automatic_action, retry_policy, requires_human, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(blocker_id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      occurrence_count = blocker_records.occurrence_count + 1`,
  ).run(
    record.blockerId,
    record.runId,
    record.operationId ?? null,
    record.classification,
    record.scope,
    record.severity,
    record.fingerprint,
    record.endpoint ?? null,
    record.httpStatus ?? null,
    record.adapterVersion ?? null,
    record.contractFingerprint ?? null,
    record.productionSha ?? null,
    record.destinationHost ?? null,
    record.firstSeenAt,
    record.lastSeenAt,
    record.occurrenceCount ?? 1,
    record.safeAutomaticAction ?? "none",
    record.retryPolicy ?? "none",
    record.requiresHuman === false ? 0 : 1,
    record.evidenceJson ?? "[]",
  );
}
