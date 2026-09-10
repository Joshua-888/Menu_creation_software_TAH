/**
 * M4 SQLite run persistence (Node built-in node:sqlite).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ErrorCategory } from "../domain/errors.js";
import type { MigrationEntityState } from "../domain/states.js";

export type RunMeta = {
  runId: string;
  restaurant: string;
  host: string;
  source: string;
  schemaVersion: string;
  domainRuleVersion: string;
  adapterVersion: string;
  contractFingerprint: string;
  startedAt: string;
  endedAt?: string;
  status: string;
};

export type OperationRecord = {
  runId: string;
  operationId: string;
  entityType: string;
  action: string;
  identityMenuNumber: string;
  identityName: string;
  expectedPayloadJson: string | null;
  destinationId: string | null;
  state: MigrationEntityState;
  attemptCount: number;
  lastErrorCategory: ErrorCategory | null;
  lastErrorMessage: string | null;
  verificationDiffJson: string | null;
  updatedAt: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  restaurant TEXT NOT NULL,
  host TEXT NOT NULL,
  source TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  domain_rule_version TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  contract_fingerprint TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operations (
  run_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  action TEXT NOT NULL,
  identity_menu_number TEXT NOT NULL,
  identity_name TEXT NOT NULL,
  expected_payload_json TEXT,
  destination_id TEXT,
  state TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_category TEXT,
  last_error_message TEXT,
  verification_diff_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, operation_id),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_run_state ON operations(run_id, state);
CREATE INDEX IF NOT EXISTS idx_ops_identity ON operations(run_id, identity_menu_number, identity_name);
`;

export class RunStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  upsertRun(meta: RunMeta): void {
    this.db
      .prepare(
        `INSERT INTO runs (
          run_id, restaurant, host, source, schema_version, domain_rule_version,
          adapter_version, contract_fingerprint, started_at, ended_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          ended_at=excluded.ended_at,
          status=excluded.status`,
      )
      .run(
        meta.runId,
        meta.restaurant,
        meta.host,
        meta.source,
        meta.schemaVersion,
        meta.domainRuleVersion,
        meta.adapterVersion,
        meta.contractFingerprint,
        meta.startedAt,
        meta.endedAt ?? null,
        meta.status,
      );
  }

  getRun(runId: string): RunMeta | null {
    const row = this.db
      .prepare(`SELECT * FROM runs WHERE run_id = ?`)
      .get(runId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      runId: String(row.run_id),
      restaurant: String(row.restaurant),
      host: String(row.host),
      source: String(row.source),
      schemaVersion: String(row.schema_version),
      domainRuleVersion: String(row.domain_rule_version),
      adapterVersion: String(row.adapter_version),
      contractFingerprint: String(row.contract_fingerprint),
      startedAt: String(row.started_at),
      ...(row.ended_at ? { endedAt: String(row.ended_at) } : {}),
      status: String(row.status),
    };
  }

  upsertOperation(op: OperationRecord): void {
    this.db
      .prepare(
        `INSERT INTO operations (
          run_id, operation_id, entity_type, action, identity_menu_number, identity_name,
          expected_payload_json, destination_id, state, attempt_count,
          last_error_category, last_error_message, verification_diff_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, operation_id) DO UPDATE SET
          destination_id=excluded.destination_id,
          state=excluded.state,
          attempt_count=excluded.attempt_count,
          last_error_category=excluded.last_error_category,
          last_error_message=excluded.last_error_message,
          verification_diff_json=excluded.verification_diff_json,
          updated_at=excluded.updated_at`,
      )
      .run(
        op.runId,
        op.operationId,
        op.entityType,
        op.action,
        op.identityMenuNumber,
        op.identityName,
        op.expectedPayloadJson,
        op.destinationId,
        op.state,
        op.attemptCount,
        op.lastErrorCategory,
        op.lastErrorMessage,
        op.verificationDiffJson,
        op.updatedAt,
      );
  }

  getOperation(runId: string, operationId: string): OperationRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM operations WHERE run_id = ? AND operation_id = ?`,
      )
      .get(runId, operationId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return mapOp(row);
  }

  listOperations(runId: string): OperationRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM operations WHERE run_id = ? ORDER BY operation_id`)
      .all(runId) as Record<string, unknown>[];
    return rows.map(mapOp);
  }

  findByIdentity(
    runId: string,
    menuNumber: string,
    name: string,
  ): OperationRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM operations WHERE run_id = ? AND identity_menu_number = ? AND identity_name = ?`,
      )
      .get(runId, menuNumber, name) as Record<string, unknown> | undefined;
    if (!row) return null;
    return mapOp(row);
  }
}

function mapOp(row: Record<string, unknown>): OperationRecord {
  return {
    runId: String(row.run_id),
    operationId: String(row.operation_id),
    entityType: String(row.entity_type),
    action: String(row.action),
    identityMenuNumber: String(row.identity_menu_number),
    identityName: String(row.identity_name),
    expectedPayloadJson:
      row.expected_payload_json == null
        ? null
        : String(row.expected_payload_json),
    destinationId:
      row.destination_id == null ? null : String(row.destination_id),
    state: String(row.state) as MigrationEntityState,
    attemptCount: Number(row.attempt_count),
    lastErrorCategory:
      row.last_error_category == null
        ? null
        : (String(row.last_error_category) as ErrorCategory),
    lastErrorMessage:
      row.last_error_message == null ? null : String(row.last_error_message),
    verificationDiffJson:
      row.verification_diff_json == null
        ? null
        : String(row.verification_diff_json),
    updatedAt: String(row.updated_at),
  };
}
