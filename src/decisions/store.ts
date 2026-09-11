/**
 * M6 SQLite persistence for decisions/policies — extends M4 node:sqlite pattern.
 * Historical HumanDecision rows are never mutated; corrections insert superseding rows.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DecisionCase,
  DecisionPolicy,
  HumanDecision,
  PolicyCandidate,
  PolicyConditions,
  PolicyStatus,
} from "./types.js";
import { FactRegistry, migrateFactTables } from "./factStore.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decision_cases (
  decision_case_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  restaurant_key TEXT NOT NULL,
  host TEXT NOT NULL,
  menu_number TEXT,
  product_name TEXT NOT NULL,
  source_category TEXT,
  destination_category_candidate TEXT,
  decision_type TEXT NOT NULL,
  source_text TEXT NOT NULL,
  normalized_source_text TEXT NOT NULL,
  context_features_json TEXT NOT NULL,
  source_evidence_json TEXT,
  current_interpretation TEXT NOT NULL,
  available_options_json TEXT NOT NULL,
  recommended_option_id TEXT,
  recommended_rationale TEXT,
  is_system_recommendation_only INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  risk_class TEXT NOT NULL,
  resolution_id TEXT,
  resolution_method TEXT,
  explanation_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decision_engine_version TEXT NOT NULL,
  schema_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS human_decisions (
  human_decision_id TEXT PRIMARY KEY,
  decision_case_id TEXT NOT NULL,
  selected_resolution TEXT NOT NULL,
  selected_option_id TEXT NOT NULL,
  operator_id TEXT,
  decision_type TEXT NOT NULL,
  scope_requested TEXT NOT NULL,
  scope_approved TEXT NOT NULL,
  comment TEXT,
  source_evidence_snapshot TEXT,
  decision_features_snapshot TEXT NOT NULL,
  canonical_before_json TEXT,
  canonical_after_json TEXT,
  created_at TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  supersedes_human_decision_id TEXT,
  FOREIGN KEY (decision_case_id) REFERENCES decision_cases(decision_case_id)
);

CREATE TABLE IF NOT EXISTS decision_policies (
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  decision_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_restaurant TEXT,
  scope_category TEXT,
  conditions_json TEXT NOT NULL,
  resolution TEXT NOT NULL,
  resolution_option_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_from_decision_ids_json TEXT NOT NULL,
  confidence_evidence TEXT,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  deprecated_at TEXT,
  created_by TEXT NOT NULL,
  validation_summary TEXT,
  invents_missing_facts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (policy_id, policy_version)
);

CREATE TABLE IF NOT EXISTS decision_policy_support (
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  human_decision_id TEXT NOT NULL,
  PRIMARY KEY (policy_id, policy_version, human_decision_id)
);

CREATE TABLE IF NOT EXISTS decision_outcomes (
  outcome_id TEXT PRIMARY KEY,
  decision_case_id TEXT NOT NULL,
  status TEXT NOT NULL,
  resolution TEXT,
  option_id TEXT,
  method TEXT NOT NULL,
  policy_id TEXT,
  policy_version INTEGER,
  precedent_ids_json TEXT,
  explanation TEXT NOT NULL,
  gate_json TEXT,
  reasoner_json TEXT,
  created_at TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  policy_registry_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_candidates (
  candidate_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dc_status ON decision_cases(status);
CREATE INDEX IF NOT EXISTS idx_dc_type ON decision_cases(decision_type);
CREATE INDEX IF NOT EXISTS idx_hd_case ON human_decisions(decision_case_id);
CREATE INDEX IF NOT EXISTS idx_pol_status ON decision_policies(status);
`;

function nowIso(): string {
  return new Date().toISOString();
}

export class DecisionStore {
  private readonly db: DatabaseSync;
  readonly facts: FactRegistry;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
    migrateFactTables(this.db);
    this.facts = new FactRegistry(this.db);
  }

  close(): void {
    this.db.close();
  }

  /** Fail-safe: verify core tables exist */
  assertIntegrity(): void {
    for (const t of [
      "decision_cases",
      "human_decisions",
      "decision_policies",
    ]) {
      const row = this.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        )
        .get(t);
      if (!row) {
        throw new Error(`POLICY_STORE_CORRUPT: missing table ${t}`);
      }
    }
  }

  upsertCase(c: DecisionCase): void {
    this.db
      .prepare(
        `INSERT INTO decision_cases (
          decision_case_id, run_id, source_id, restaurant_id, restaurant_key, host,
          menu_number, product_name, source_category, destination_category_candidate,
          decision_type, source_text, normalized_source_text, context_features_json,
          source_evidence_json, current_interpretation, available_options_json,
          recommended_option_id, recommended_rationale, is_system_recommendation_only,
          status, risk_class, resolution_id, resolution_method, explanation_json,
          created_at, updated_at, decision_engine_version, schema_version
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(decision_case_id) DO UPDATE SET
          status=excluded.status,
          resolution_id=excluded.resolution_id,
          resolution_method=excluded.resolution_method,
          explanation_json=excluded.explanation_json,
          is_system_recommendation_only=excluded.is_system_recommendation_only,
          risk_class=excluded.risk_class,
          updated_at=excluded.updated_at`,
      )
      .run(
        c.decisionCaseId,
        c.runId,
        c.sourceId,
        c.restaurantId,
        c.restaurantKey,
        c.host,
        c.menuNumber,
        c.productName,
        c.sourceCategory,
        c.destinationCategoryCandidate,
        c.decisionType,
        c.sourceText,
        c.normalizedSourceText,
        JSON.stringify(c.contextFeatures),
        c.sourceEvidenceJson,
        c.currentCanonicalInterpretation,
        JSON.stringify(c.availableOptions),
        c.recommendedOptionId,
        c.recommendedRationale,
        c.isSystemRecommendationOnly ? 1 : 0,
        c.status,
        c.riskClass,
        c.resolutionId,
        c.resolutionMethod,
        c.explanationJson,
        c.createdAt,
        c.updatedAt,
        c.decisionEngineVersion,
        c.schemaVersion,
      );
  }

  getCase(id: string): DecisionCase | null {
    const row = this.db
      .prepare(`SELECT * FROM decision_cases WHERE decision_case_id=?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToCase(row) : null;
  }

  listCases(filter?: { status?: string; runId?: string }): DecisionCase[] {
    let sql = `SELECT * FROM decision_cases WHERE 1=1`;
    const args: string[] = [];
    if (filter?.status) {
      sql += ` AND status=?`;
      args.push(filter.status);
    }
    if (filter?.runId) {
      sql += ` AND run_id=?`;
      args.push(filter.runId);
    }
    sql += ` ORDER BY created_at`;
    return (this.db.prepare(sql).all(...args) as Record<string, unknown>[]).map(
      rowToCase,
    );
  }

  /**
   * Insert immutable human decision. Never UPDATE historical rows.
   */
  insertHumanDecision(h: HumanDecision): void {
    this.db
      .prepare(
        `INSERT INTO human_decisions (
          human_decision_id, decision_case_id, selected_resolution, selected_option_id,
          operator_id, decision_type, scope_requested, scope_approved, comment,
          source_evidence_snapshot, decision_features_snapshot, canonical_before_json,
          canonical_after_json, created_at, engine_version, schema_version,
          supersedes_human_decision_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        h.humanDecisionId,
        h.decisionCaseId,
        h.selectedResolution,
        h.selectedOptionId,
        h.operatorId,
        h.decisionType,
        h.scopeRequested,
        h.scopeApproved,
        h.comment,
        h.sourceEvidenceSnapshot,
        h.decisionFeaturesSnapshot,
        h.canonicalBeforeJson,
        h.canonicalAfterJson,
        h.createdAt,
        h.engineVersion,
        h.schemaVersion,
        h.supersedesHumanDecisionId,
      );
  }

  updateHumanDecisionCanonical(
    humanDecisionId: string,
    canonicalBeforeJson: string | null,
    canonicalAfterJson: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE human_decisions SET canonical_before_json = ?, canonical_after_json = ?
         WHERE human_decision_id = ?`,
      )
      .run(canonicalBeforeJson, canonicalAfterJson, humanDecisionId);
  }

  listHumanDecisions(filter?: {
    decisionType?: string;
    restaurantKey?: string;
  }): HumanDecision[] {
    const rows = this.db
      .prepare(`SELECT * FROM human_decisions ORDER BY created_at`)
      .all() as Record<string, unknown>[];
    let out = rows.map(rowToHuman);
    if (filter?.decisionType) {
      out = out.filter((h) => h.decisionType === filter.decisionType);
    }
    if (filter?.restaurantKey) {
      out = out.filter((h) => {
        const c = this.getCase(h.decisionCaseId);
        return c?.restaurantKey === filter.restaurantKey;
      });
    }
    return out;
  }

  insertPolicyVersion(p: DecisionPolicy): void {
    this.db
      .prepare(
        `INSERT INTO decision_policies (
          policy_id, policy_version, decision_type, scope, scope_restaurant, scope_category,
          conditions_json, resolution, resolution_option_id, status,
          created_from_decision_ids_json, confidence_evidence, created_at, activated_at,
          deprecated_at, created_by, validation_summary, invents_missing_facts
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.policyId,
        p.policyVersion,
        p.decisionType,
        p.scope,
        p.scopeRestaurant,
        p.scopeCategory,
        JSON.stringify(p.conditions),
        p.resolution,
        p.resolutionOptionId,
        p.status,
        JSON.stringify(p.createdFromDecisionIds),
        p.confidenceEvidence,
        p.createdAt,
        p.activatedAt,
        p.deprecatedAt,
        p.createdBy,
        p.validationSummary,
        p.inventsMissingFacts ? 1 : 0,
      );
    for (const hid of p.createdFromDecisionIds) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO decision_policy_support (policy_id, policy_version, human_decision_id)
           VALUES (?,?,?)`,
        )
        .run(p.policyId, p.policyVersion, hid);
    }
  }

  /** Soft-status change creates a NEW version row (immutable versions). */
  newPolicyStatus(
    policyId: string,
    fromVersion: number,
    status: PolicyStatus,
    patch?: Partial<DecisionPolicy>,
  ): DecisionPolicy {
    const cur = this.getPolicy(policyId, fromVersion);
    if (!cur) throw new Error(`policy not found ${policyId}@${fromVersion}`);
    const next: DecisionPolicy = {
      ...cur,
      ...patch,
      policyVersion: fromVersion + 1,
      status,
      activatedAt:
        status === "ACTIVE" ? nowIso() : (patch?.activatedAt ?? cur.activatedAt),
      deprecatedAt:
        status === "DEPRECATED"
          ? nowIso()
          : (patch?.deprecatedAt ?? cur.deprecatedAt),
      createdAt: nowIso(),
    };
    this.insertPolicyVersion(next);
    return next;
  }

  getPolicy(policyId: string, version: number): DecisionPolicy | null {
    const row = this.db
      .prepare(
        `SELECT * FROM decision_policies WHERE policy_id=? AND policy_version=?`,
      )
      .get(policyId, version) as Record<string, unknown> | undefined;
    return row ? rowToPolicy(row) : null;
  }

  latestPolicy(policyId: string): DecisionPolicy | null {
    const row = this.db
      .prepare(
        `SELECT * FROM decision_policies WHERE policy_id=? ORDER BY policy_version DESC LIMIT 1`,
      )
      .get(policyId) as Record<string, unknown> | undefined;
    return row ? rowToPolicy(row) : null;
  }

  listPolicies(status?: PolicyStatus): DecisionPolicy[] {
    // latest version per policy_id
    const ids = this.db
      .prepare(`SELECT DISTINCT policy_id FROM decision_policies`)
      .all() as Array<{ policy_id: string }>;
    const out: DecisionPolicy[] = [];
    for (const { policy_id } of ids) {
      const p = this.latestPolicy(policy_id);
      if (p && (!status || p.status === status)) out.push(p);
    }
    return out;
  }

  saveCandidate(c: PolicyCandidate): void {
    this.db
      .prepare(
        `INSERT INTO policy_candidates (candidate_id, payload_json, created_at) VALUES (?,?,?)`,
      )
      .run(c.candidateId, JSON.stringify(c), c.createdAt);
  }

  listCandidates(): PolicyCandidate[] {
    return (
      this.db.prepare(`SELECT payload_json FROM policy_candidates`).all() as Array<{
        payload_json: string;
      }>
    ).map((r) => JSON.parse(r.payload_json) as PolicyCandidate);
  }

  insertOutcome(o: {
    outcomeId: string;
    decisionCaseId: string;
    status: string;
    resolution: string | null;
    optionId: string | null;
    method: string;
    policyId: string | null;
    policyVersion: number | null;
    precedentIds: string[];
    explanation: string;
    gateJson: string | null;
    reasonerJson: string | null;
    engineVersion: string;
    policyRegistryVersion: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO decision_outcomes (
          outcome_id, decision_case_id, status, resolution, option_id, method,
          policy_id, policy_version, precedent_ids_json, explanation, gate_json,
          reasoner_json, created_at, engine_version, policy_registry_version
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        o.outcomeId,
        o.decisionCaseId,
        o.status,
        o.resolution,
        o.optionId,
        o.method,
        o.policyId,
        o.policyVersion,
        JSON.stringify(o.precedentIds),
        o.explanation,
        o.gateJson,
        o.reasonerJson,
        nowIso(),
        o.engineVersion,
        o.policyRegistryVersion,
      );
  }
}

function rowToCase(row: Record<string, unknown>): DecisionCase {
  return {
    decisionCaseId: String(row.decision_case_id),
    runId: String(row.run_id),
    sourceId: String(row.source_id),
    restaurantId: String(row.restaurant_id),
    restaurantKey: String(row.restaurant_key),
    host: String(row.host),
    menuNumber: row.menu_number != null ? String(row.menu_number) : null,
    productName: String(row.product_name),
    sourceCategory:
      row.source_category != null ? String(row.source_category) : null,
    destinationCategoryCandidate:
      row.destination_category_candidate != null
        ? String(row.destination_category_candidate)
        : null,
    decisionType: String(row.decision_type),
    sourceText: String(row.source_text),
    normalizedSourceText: String(row.normalized_source_text),
    contextFeatures: JSON.parse(String(row.context_features_json)),
    sourceEvidenceJson:
      row.source_evidence_json != null ? String(row.source_evidence_json) : null,
    currentCanonicalInterpretation: String(row.current_interpretation),
    availableOptions: JSON.parse(String(row.available_options_json)),
    recommendedOptionId:
      row.recommended_option_id != null
        ? String(row.recommended_option_id)
        : null,
    recommendedRationale:
      row.recommended_rationale != null
        ? String(row.recommended_rationale)
        : null,
    isSystemRecommendationOnly: Number(row.is_system_recommendation_only) === 1,
    status: String(row.status) as DecisionCase["status"],
    riskClass: String(row.risk_class) as DecisionCase["riskClass"],
    resolutionId:
      row.resolution_id != null ? String(row.resolution_id) : null,
    resolutionMethod:
      row.resolution_method != null ? String(row.resolution_method) : null,
    explanationJson:
      row.explanation_json != null ? String(row.explanation_json) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    decisionEngineVersion: String(row.decision_engine_version),
    schemaVersion: String(row.schema_version),
  };
}

function rowToHuman(row: Record<string, unknown>): HumanDecision {
  return {
    humanDecisionId: String(row.human_decision_id),
    decisionCaseId: String(row.decision_case_id),
    selectedResolution: String(row.selected_resolution),
    selectedOptionId: String(row.selected_option_id),
    operatorId: row.operator_id != null ? String(row.operator_id) : null,
    decisionType: String(row.decision_type),
    scopeRequested: String(
      row.scope_requested,
    ) as HumanDecision["scopeRequested"],
    scopeApproved: String(row.scope_approved) as HumanDecision["scopeApproved"],
    comment: row.comment != null ? String(row.comment) : null,
    sourceEvidenceSnapshot:
      row.source_evidence_snapshot != null
        ? String(row.source_evidence_snapshot)
        : null,
    decisionFeaturesSnapshot: String(row.decision_features_snapshot),
    canonicalBeforeJson:
      row.canonical_before_json != null
        ? String(row.canonical_before_json)
        : null,
    canonicalAfterJson:
      row.canonical_after_json != null
        ? String(row.canonical_after_json)
        : null,
    createdAt: String(row.created_at),
    engineVersion: String(row.engine_version),
    schemaVersion: String(row.schema_version),
    supersedesHumanDecisionId:
      row.supersedes_human_decision_id != null
        ? String(row.supersedes_human_decision_id)
        : null,
  };
}

function rowToPolicy(row: Record<string, unknown>): DecisionPolicy {
  return {
    policyId: String(row.policy_id),
    policyVersion: Number(row.policy_version),
    decisionType: String(row.decision_type),
    scope: String(row.scope) as DecisionPolicy["scope"],
    scopeRestaurant:
      row.scope_restaurant != null ? String(row.scope_restaurant) : null,
    scopeCategory:
      row.scope_category != null ? String(row.scope_category) : null,
    conditions: JSON.parse(String(row.conditions_json)) as PolicyConditions,
    resolution: String(row.resolution),
    resolutionOptionId: String(row.resolution_option_id),
    status: String(row.status) as PolicyStatus,
    createdFromDecisionIds: JSON.parse(
      String(row.created_from_decision_ids_json),
    ) as string[],
    confidenceEvidence:
      row.confidence_evidence != null
        ? String(row.confidence_evidence)
        : null,
    createdAt: String(row.created_at),
    activatedAt: row.activated_at != null ? String(row.activated_at) : null,
    deprecatedAt: row.deprecated_at != null ? String(row.deprecated_at) : null,
    createdBy: String(row.created_by),
    validationSummary:
      row.validation_summary != null ? String(row.validation_summary) : null,
    inventsMissingFacts: Number(row.invents_missing_facts) === 1,
  };
}
