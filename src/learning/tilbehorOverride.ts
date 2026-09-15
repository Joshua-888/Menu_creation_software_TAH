/**
 * Loop D feedback — operator Tilbehør overrides become EXACT_PRODUCT BUSINESS_FACTs.
 * Probability / restaurant fan-out must not undo KEEP overrides.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  DecisionCase,
  HumanDecision,
  HumanReviewAnswer,
} from "../decisions/types.js";
import type { AdditionSetFact } from "../decisions/facts.js";
import { buildDecisionFeatures } from "../decisions/features.js";
import { classifyRisk } from "../decisions/gate.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
} from "../decisions/versions.js";
import type { DecisionStore } from "../decisions/store.js";
import type { FactRegistry } from "../decisions/factStore.js";
import { veroniDefaultTilbehorAdditions } from "../planning/structureMapping.js";
import type { ProductPolicyTrace } from "../planning/structureMapping.js";

/** Reuse ADDITION_CORRECTION — operator corrects Tilbehør application. */
export const TILBEHOR_OVERRIDE_DECISION_TYPE = "ADDITION_CORRECTION";

export type TilbehorOverrideResolution =
  | "ACCEPT_POLICY_STRIP"
  | "KEEP_TILBEHOR"
  | "SUPPRESS_TILBEHOR";

export const TILBEHOR_OVERRIDE_OPTIONS = [
  {
    id: "accept_policy_strip",
    label: "Accept policy (no mayo dips on this product)",
    resolution: "ACCEPT_POLICY_STRIP" as const,
  },
  {
    id: "keep_tilbehor",
    label: "Keep Tilbehør dips on this product (override)",
    resolution: "KEEP_TILBEHOR" as const,
  },
  {
    id: "suppress_tilbehor",
    label: "Confirm suppress Tilbehør (sticky empty)",
    resolution: "SUPPRESS_TILBEHOR" as const,
  },
] as const;

export type TilbehorOverrideEvidence = {
  menuNumber: string;
  override: "KEEP_TILBEHOR" | "SUPPRESS_TILBEHOR";
  productName?: string;
  categoryName?: string;
};

export function parseTilbehorOverrideEvidence(
  evidenceJson: string | null | undefined,
): TilbehorOverrideEvidence | null {
  if (!evidenceJson) return null;
  try {
    const ev = JSON.parse(evidenceJson) as Partial<TilbehorOverrideEvidence>;
    if (
      typeof ev.menuNumber !== "string" ||
      (ev.override !== "KEEP_TILBEHOR" && ev.override !== "SUPPRESS_TILBEHOR")
    ) {
      return null;
    }
    return {
      menuNumber: ev.menuNumber,
      override: ev.override,
      ...(ev.productName ? { productName: ev.productName } : {}),
      ...(ev.categoryName ? { categoryName: ev.categoryName } : {}),
    };
  } catch {
    return null;
  }
}

/** Traces that are useful for operator override review (fan-out then stripped). */
export function selectTilbehorOverrideTraces(
  traces: ProductPolicyTrace[],
  limit = 20,
): ProductPolicyTrace[] {
  return traces
    .filter(
      (t) =>
        t.menuNumber &&
        t.fanOutTilbehor &&
        t.removed.some((r) => r.reason === "DIP_DENY_KIND"),
    )
    .slice(0, limit);
}

export function buildTilbehorOverrideDecisionCase(input: {
  runId: string;
  restaurantKey: string;
  host?: string;
  trace: ProductPolicyTrace;
}): DecisionCase {
  const menuNumber = input.trace.menuNumber ?? "";
  const sourceText = [
    `tilbehor_override`,
    `menu=#${menuNumber}`,
    `name=${input.trace.name}`,
    `kind=${input.trace.kind}`,
    `before=${input.trace.additionsBefore.join(",")}`,
    `after=${input.trace.additionsAfter.join(",")}`,
    `reasons=${input.trace.reasonCodes.join(",")}`,
  ].join("\n");
  const features = buildDecisionFeatures({
    decisionType: TILBEHOR_OVERRIDE_DECISION_TYPE,
    sourceText,
    productName: input.trace.name,
    sourceCategory: input.trace.categoryName,
    restaurantKey: input.restaurantKey,
    menuNumber,
  });
  const now = new Date().toISOString();
  return {
    decisionCaseId: `dc_tilbehor_${randomUUID()}`,
    runId: input.runId,
    sourceId: input.trace.sourceId,
    restaurantId: input.restaurantKey,
    restaurantKey: input.restaurantKey,
    host: input.host ?? input.restaurantKey,
    menuNumber,
    productName: input.trace.name,
    sourceCategory: input.trace.categoryName,
    destinationCategoryCandidate: null,
    decisionType: TILBEHOR_OVERRIDE_DECISION_TYPE,
    sourceText,
    normalizedSourceText: sourceText.toLowerCase(),
    contextFeatures: features,
    sourceEvidenceJson: JSON.stringify({
      kind: input.trace.kind,
      reasonCodes: input.trace.reasonCodes,
      removed: input.trace.removed,
      additionsBefore: input.trace.additionsBefore,
      additionsAfter: input.trace.additionsAfter,
    }),
    currentCanonicalInterpretation: JSON.stringify({
      additionsAfter: input.trace.additionsAfter,
      kind: input.trace.kind,
    }),
    availableOptions: TILBEHOR_OVERRIDE_OPTIONS.map((o) => ({
      id: o.id,
      label: o.label,
      effect: o.resolution,
    })),
    recommendedOptionId: "accept_policy_strip",
    recommendedRationale:
      "System recommendation only — peer probability denies dips for this product kind",
    isSystemRecommendationOnly: true,
    status: "HUMAN_REVIEW_REQUIRED",
    riskClass: classifyRisk({
      decisionType: TILBEHOR_OVERRIDE_DECISION_TYPE,
      features,
    }),
    resolutionId: null,
    resolutionMethod: null,
    explanationJson: JSON.stringify({
      why: "Operator may override peer probability Tilbehør strip for this product",
    }),
    createdAt: now,
    updatedAt: now,
    decisionEngineVersion: DECISION_ENGINE_VERSION,
    schemaVersion: DECISION_SCHEMA_VERSION,
  };
}

export function portalQuestionFromTilbehorCase(c: DecisionCase): {
  decisionCaseId: string;
  questionType: string;
  title: string;
  prompt: string;
  optionsJson: string;
  productRef: string | null;
  batchKey: string | null;
} {
  return {
    decisionCaseId: c.decisionCaseId,
    questionType: TILBEHOR_OVERRIDE_DECISION_TYPE,
    title: `Tilbehør policy · #${c.menuNumber ?? "?"} ${c.productName ?? ""}`.trim(),
    prompt: `Peer probability stripped mayo dips from #${c.menuNumber} ${c.productName}. Accept strip, keep dips (override), or confirm sticky suppress?`,
    optionsJson: JSON.stringify(
      TILBEHOR_OVERRIDE_OPTIONS.map((o) => ({
        id: o.id,
        label: o.label,
        resolution: o.resolution,
      })),
    ),
    productRef: c.sourceId,
    batchKey: `${TILBEHOR_OVERRIDE_DECISION_TYPE}:${c.menuNumber ?? c.sourceId}`,
  };
}

export function menuNumbersWithKeepTilbehorOverride(
  registry: FactRegistry,
  restaurantKey: string,
): Set<string> {
  const out = new Set<string>();
  for (const s of registry.listActiveAdditionSets(restaurantKey)) {
    if (s.scope !== "EXACT_PRODUCT" && s.scope !== "EXACT_CASE") continue;
    const ev = parseTilbehorOverrideEvidence(s.evidenceJson);
    if (ev?.override === "KEEP_TILBEHOR") out.add(ev.menuNumber);
  }
  return out;
}

export function applyTilbehorOverrideFromAnswer(input: {
  store: DecisionStore;
  decisionCase: DecisionCase;
  answer: HumanReviewAnswer;
  humanDecision: HumanDecision;
}): AdditionSetFact | null {
  const resolution = input.answer.resolution as TilbehorOverrideResolution;
  if (resolution === "ACCEPT_POLICY_STRIP") return null;

  const menuNumber = input.decisionCase.menuNumber;
  if (!menuNumber) return null;

  const override: TilbehorOverrideEvidence["override"] =
    resolution === "KEEP_TILBEHOR" ? "KEEP_TILBEHOR" : "SUPPRESS_TILBEHOR";
  const additions =
    override === "KEEP_TILBEHOR" ? veroniDefaultTilbehorAdditions() : [];

  const existing = input.store.facts
    .listActiveAdditionSets(input.decisionCase.restaurantKey)
    .find((f) => {
      const ev = parseTilbehorOverrideEvidence(f.evidenceJson);
      return (
        (f.scope === "EXACT_PRODUCT" || f.scope === "EXACT_CASE") &&
        ev?.menuNumber === menuNumber
      );
    });

  if (existing) {
    input.store.facts.insertAdditionSet({
      ...existing,
      factVersion: existing.factVersion + 1,
      status: "SUPERSEDED",
      createdAt: new Date().toISOString(),
    });
  }

  const fact: AdditionSetFact = {
    factId:
      existing?.factId ??
      `addset_tilbehor_override_${input.decisionCase.restaurantKey}_${menuNumber}`,
    factVersion: existing ? existing.factVersion + 2 : 1,
    restaurantKey: input.decisionCase.restaurantKey,
    sourceCategory: input.decisionCase.sourceCategory,
    destinationCategoryId: null,
    scope: "EXACT_PRODUCT",
    additions,
    excludedSourceIds: [],
    excludedMenuNumbers: [],
    humanDecisionId: input.humanDecision.humanDecisionId,
    knowledgeKind: "BUSINESS_FACT",
    supersedesFactId: existing?.factId ?? null,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    originalOperatorText:
      `${resolution} for #${menuNumber} ${input.decisionCase.productName}`.trim(),
    evidenceJson: JSON.stringify({
      menuNumber,
      override,
      productName: input.decisionCase.productName,
      ...(input.decisionCase.sourceCategory
        ? { categoryName: input.decisionCase.sourceCategory }
        : {}),
    } satisfies TilbehorOverrideEvidence),
  };
  input.store.facts.insertAdditionSet(fact);
  return fact;
}

export function portalDecisionDbPath(repoRoot: string): string {
  return join(repoRoot, "runs", "decisions", "portal-decisions.sqlite");
}

export function resolvePortalDecisionDbPath(repoRoot: string): string {
  return process.env.PORTAL_DECISION_DB_PATH || portalDecisionDbPath(repoRoot);
}
