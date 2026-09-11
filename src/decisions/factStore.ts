/**
 * Fact registry persistence — extends DecisionStore SQLite DB.
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  AdditionSetFact,
  ChoiceOptionsFact,
  PriceFact,
} from "./facts.js";
import { normalizeAdditionName } from "./facts.js";

const FACT_SCHEMA = `
CREATE TABLE IF NOT EXISTS decision_price_facts (
  fact_id TEXT NOT NULL,
  fact_version INTEGER NOT NULL,
  restaurant_key TEXT NOT NULL,
  source_id TEXT,
  menu_number TEXT,
  source_category TEXT,
  destination_category_id TEXT,
  fact_type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  applies_to TEXT NOT NULL,
  label TEXT,
  evidence_json TEXT,
  human_decision_id TEXT,
  scope TEXT NOT NULL,
  origin TEXT NOT NULL,
  knowledge_kind TEXT NOT NULL,
  supersedes_fact_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  original_operator_text TEXT,
  PRIMARY KEY (fact_id, fact_version)
);

CREATE TABLE IF NOT EXISTS decision_addition_set_facts (
  fact_id TEXT NOT NULL,
  fact_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  restaurant_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (fact_id, fact_version)
);

CREATE TABLE IF NOT EXISTS decision_choice_option_facts (
  fact_id TEXT NOT NULL,
  fact_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  restaurant_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (fact_id, fact_version)
);

CREATE TABLE IF NOT EXISTS decision_fact_conflicts (
  conflict_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  restaurant_key TEXT NOT NULL,
  fact_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function migrateFactTables(db: DatabaseSync): void {
  db.exec(FACT_SCHEMA);
}

export class FactRegistry {
  constructor(private readonly db: DatabaseSync) {
    migrateFactTables(db);
  }

  insertPriceFact(f: PriceFact): void {
    this.db
      .prepare(
        `INSERT INTO decision_price_facts (
          fact_id, fact_version, restaurant_key, source_id, menu_number,
          source_category, destination_category_id, fact_type, amount_minor,
          currency, applies_to, label, evidence_json, human_decision_id, scope,
          origin, knowledge_kind, supersedes_fact_id, status, created_at,
          original_operator_text
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        f.factId,
        f.factVersion,
        f.restaurantKey,
        f.sourceId,
        f.menuNumber,
        f.sourceCategory,
        f.destinationCategoryId,
        f.factType,
        f.amountMinor,
        f.currency,
        f.appliesTo,
        f.label,
        f.evidenceJson,
        f.humanDecisionId,
        f.scope,
        f.origin,
        f.knowledgeKind,
        f.supersedesFactId,
        f.status,
        f.createdAt,
        f.originalOperatorText,
      );
  }

  listActivePriceFacts(restaurantKey: string): PriceFact[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM decision_price_facts WHERE restaurant_key=? AND status='ACTIVE'
         ORDER BY fact_id, fact_version DESC`,
      )
      .all(restaurantKey) as Record<string, unknown>[];
    const latest = new Map<string, PriceFact>();
    for (const r of rows) {
      const f = rowToPrice(r);
      if (!latest.has(f.factId)) latest.set(f.factId, f);
    }
    return [...latest.values()];
  }

  insertAdditionSet(f: AdditionSetFact): void {
    this.db
      .prepare(
        `INSERT INTO decision_addition_set_facts (
          fact_id, fact_version, payload_json, restaurant_key, status, created_at
        ) VALUES (?,?,?,?,?,?)`,
      )
      .run(
        f.factId,
        f.factVersion,
        JSON.stringify(f),
        f.restaurantKey,
        f.status,
        f.createdAt,
      );
  }

  listActiveAdditionSets(restaurantKey: string): AdditionSetFact[] {
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM decision_addition_set_facts
         WHERE restaurant_key=? AND status='ACTIVE'
         ORDER BY fact_id, fact_version DESC`,
      )
      .all(restaurantKey) as Array<{ payload_json: string }>;
    const latest = new Map<string, AdditionSetFact>();
    for (const r of rows) {
      const f = JSON.parse(r.payload_json) as AdditionSetFact;
      if (!latest.has(f.factId)) latest.set(f.factId, f);
    }
    return [...latest.values()];
  }

  insertChoiceOptionsFact(f: ChoiceOptionsFact): void {
    this.db
      .prepare(
        `INSERT INTO decision_choice_option_facts (
          fact_id, fact_version, payload_json, restaurant_key, status, created_at
        ) VALUES (?,?,?,?,?,?)`,
      )
      .run(
        f.factId,
        f.factVersion,
        JSON.stringify(f),
        f.restaurantKey,
        f.status,
        f.createdAt,
      );
  }

  listActiveChoiceOptions(restaurantKey: string): ChoiceOptionsFact[] {
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM decision_choice_option_facts
         WHERE restaurant_key=? AND status='ACTIVE'
         ORDER BY fact_id, fact_version DESC`,
      )
      .all(restaurantKey) as Array<{ payload_json: string }>;
    const latest = new Map<string, ChoiceOptionsFact>();
    for (const r of rows) {
      const f = JSON.parse(r.payload_json) as ChoiceOptionsFact;
      if (!latest.has(f.factId)) latest.set(f.factId, f);
    }
    return [...latest.values()];
  }

  recordConflict(input: {
    conflictId: string;
    code: string;
    message: string;
    restaurantKey: string;
    factId: string | null;
    payload: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO decision_fact_conflicts (
          conflict_id, code, message, restaurant_key, fact_id, payload_json, created_at
        ) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        input.conflictId,
        input.code,
        input.message,
        input.restaurantKey,
        input.factId,
        JSON.stringify(input.payload),
        new Date().toISOString(),
      );
  }

  listConflicts(restaurantKey?: string): unknown[] {
    if (restaurantKey) {
      return this.db
        .prepare(
          `SELECT * FROM decision_fact_conflicts WHERE restaurant_key=? ORDER BY created_at`,
        )
        .all(restaurantKey);
    }
    return this.db
      .prepare(`SELECT * FROM decision_fact_conflicts ORDER BY created_at`)
      .all();
  }
}

function rowToPrice(r: Record<string, unknown>): PriceFact {
  return {
    factId: String(r.fact_id),
    factVersion: Number(r.fact_version),
    restaurantKey: String(r.restaurant_key),
    sourceId: r.source_id != null ? String(r.source_id) : null,
    menuNumber: r.menu_number != null ? String(r.menu_number) : null,
    sourceCategory: r.source_category != null ? String(r.source_category) : null,
    destinationCategoryId:
      r.destination_category_id != null
        ? String(r.destination_category_id)
        : null,
    factType: String(r.fact_type) as PriceFact["factType"],
    amountMinor: Number(r.amount_minor),
    currency: "DKK",
    appliesTo: String(r.applies_to),
    label: r.label != null ? String(r.label) : null,
    evidenceJson: r.evidence_json != null ? String(r.evidence_json) : null,
    humanDecisionId:
      r.human_decision_id != null ? String(r.human_decision_id) : null,
    scope: String(r.scope) as PriceFact["scope"],
    origin: String(r.origin) as PriceFact["origin"],
    knowledgeKind: "BUSINESS_FACT",
    supersedesFactId:
      r.supersedes_fact_id != null ? String(r.supersedes_fact_id) : null,
    status: String(r.status) as PriceFact["status"],
    createdAt: String(r.created_at),
    originalOperatorText:
      r.original_operator_text != null
        ? String(r.original_operator_text)
        : null,
  };
}

export function buildAdditionDefinition(input: {
  name: string;
  priceMinor: number | null;
  origin: AdditionSetFact["additions"][0]["origin"];
  required?: boolean;
}): AdditionSetFact["additions"][0] {
  return {
    additionId: `add_${normalizeAdditionName(input.name).replace(/\s+/g, "-")}`,
    name: input.name,
    nameKey: normalizeAdditionName(input.name),
    priceMinor: input.priceMinor,
    currency: "DKK",
    required: input.required ?? false,
    minSelections: null,
    maxSelections: null,
    origin: input.origin,
  };
}
