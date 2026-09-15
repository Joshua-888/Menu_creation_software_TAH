/**
 * Persist peer-distilled MENU_STRUCTURE as an ACTIVE SEMANTIC_RULE policy
 * and (separately) Veroni Tilbehør as RESTAURANT BUSINESS_FACT.
 */

import { randomUUID } from "node:crypto";
import type { DecisionStore } from "../decisions/store.js";
import type { DecisionPolicy } from "../decisions/types.js";
import type { AdditionSetFact } from "../decisions/facts.js";
import {
  encodeStructureSemanticRule,
  parseStructureSemanticRule,
  type StructurePatternSummary,
} from "./peerMenuStructure.js";
import { veroniDefaultTilbehorAdditions } from "../planning/structureMapping.js";

export const STRUCTURE_POLICY_DECISION_TYPE = "VARIANT_SEMANTICS";

export function upsertStructureSemanticPolicy(input: {
  store: DecisionStore;
  summary: StructurePatternSummary;
  createdBy?: string;
}): DecisionPolicy {
  const resolution = encodeStructureSemanticRule(input.summary);
  const existing = input.store
    .listPolicies("ACTIVE")
    .filter((p) => p.decisionType === STRUCTURE_POLICY_DECISION_TYPE)
    .find((p) => parseStructureSemanticRule(p.resolution) != null);

  if (existing) {
    input.store.newPolicyStatus(existing.policyId, existing.policyVersion, "DEPRECATED");
  }

  const policy: DecisionPolicy = {
    policyId:
      existing?.policyId ??
      `pol_structure_semantic_${randomUUID().slice(0, 8)}`,
    policyVersion: existing ? existing.policyVersion + 2 : 1,
    decisionType: STRUCTURE_POLICY_DECISION_TYPE,
    scope: "GLOBAL",
    scopeRestaurant: null,
    scopeCategory: null,
    conditions: {
      all: [
        {
          field: "decisionType",
          op: "eq",
          value: STRUCTURE_POLICY_DECISION_TYPE,
        },
      ],
    },
    resolution,
    resolutionOptionId: "menu_structure_semantic",
    status: "ACTIVE",
    createdFromDecisionIds: [],
    confidenceEvidence: `peer-menus:${input.summary.hosts.join(",")}`,
    createdAt: new Date().toISOString(),
    activatedAt: new Date().toISOString(),
    deprecatedAt: null,
    createdBy: input.createdBy ?? "peer-menu-distill",
    validationSummary: `fingerprint=${input.summary.fingerprint}`,
    inventsMissingFacts: false,
    knowledgeKind: "SEMANTIC_RULE",
  };

  input.store.insertPolicyVersion(policy);
  return policy;
}

export function loadActiveStructurePattern(
  store: DecisionStore,
): StructurePatternSummary | null {
  const active = store
    .listPolicies("ACTIVE")
    .filter((p) => p.decisionType === STRUCTURE_POLICY_DECISION_TYPE);
  for (const p of active) {
    const parsed = parseStructureSemanticRule(p.resolution);
    if (parsed) return parsed;
  }
  return null;
}

/** Default fallback when no peers observed yet (safe Veroni-oriented defaults). */
export function defaultStructurePattern(): StructurePatternSummary {
  return {
    restaurantsAnalyzed: 0,
    hosts: [],
    meatChoiceWithoutSize: "variants",
    meatChoiceWithSize: "additions",
    sharedAdditionCoverage: 0,
    tilbehorScope: "RESTAURANT",
    categoryVariantFanOut: {
      enabled: true,
      mode: "SOURCE_CATEGORY",
      peerSizeCoverage: 0,
      peerEnableMinCoverage: 0.35,
      fanOutKinds: [
        "alm",
        "familie",
        "deep",
        "glutenfri",
        "fuldkorn",
        "hjemmelavet",
      ],
    },
    fingerprint: "default|variants|additions|RESTAURANT|cvf:SOURCE_CATEGORY",
    evidence: {
      typeVariantProducts: 0,
      sizeVariantProducts: 0,
      sharedAdditionSets: [],
    },
  };
}

export function shouldSeedDefaultTilbehor(restaurantKey: string): boolean {
  const host = restaurantKey.trim().toLowerCase().replace(/^www\./, "");
  // Veroni pilot only — never invent Tilbehør for other merchants
  if (host === "veronipizza.dk") return true;
  const extra = (process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
  return extra.includes(host);
}

export function upsertVeroniTilbehorBusinessFact(input: {
  store: DecisionStore;
  restaurantKey: string;
  excludedMenuNumbers?: string[];
}): AdditionSetFact | null {
  if (!shouldSeedDefaultTilbehor(input.restaurantKey)) {
    return null;
  }
  const existing = input.store.facts
    .listActiveAdditionSets(input.restaurantKey)
    .find((f) => f.factId.startsWith("addset_veroni_tilbehor_"));
  const additions = veroniDefaultTilbehorAdditions();
  if (
    existing &&
    existing.additions.map((a) => a.nameKey).join("|") ===
      additions.map((a) => a.nameKey).join("|")
  ) {
    return existing;
  }
  const nextVersion = existing ? existing.factVersion + 1 : 1;
  if (existing) {
    input.store.facts.insertAdditionSet({
      ...existing,
      factVersion: nextVersion,
      status: "SUPERSEDED",
      createdAt: new Date().toISOString(),
    });
  }
  const fact: AdditionSetFact = {
    factId: existing?.factId ?? `addset_veroni_tilbehor_${input.restaurantKey}`,
    factVersion: existing ? nextVersion + 1 : 1,
    restaurantKey: input.restaurantKey,
    sourceCategory: null,
    destinationCategoryId: null,
    scope: "RESTAURANT",
    additions,
    excludedSourceIds: [],
    excludedMenuNumbers: input.excludedMenuNumbers ?? ["49"],
    humanDecisionId: null,
    knowledgeKind: "BUSINESS_FACT",
    supersedesFactId: existing?.factId ?? null,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    originalOperatorText:
      "Veroni #49 Ekstra tilbehør: Salatmayonnaise, Remoulade, Ketchup @ 10kr",
    evidenceJson: JSON.stringify({ sourceMenuNumber: "49" }),
  };
  input.store.facts.insertAdditionSet(fact);
  return fact;
}
