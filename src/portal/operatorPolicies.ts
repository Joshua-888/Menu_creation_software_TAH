/**
 * Operator-authored GLOBAL policies (SEMANTIC_RULE guidance) for the portal.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DecisionStore } from "../decisions/store.js";
import type { DecisionPolicy } from "../decisions/types.js";
import { resolvePortalDecisionDbPath } from "../learning/tilbehorOverride.js";

export const OPERATOR_GUIDANCE_DECISION_TYPE = "OPERATOR_GUIDANCE";

export type OperatorPolicyView = {
  policyId: string;
  policyVersion: number;
  decisionType: string;
  scope: string;
  status: string;
  title: string;
  body: string;
  knowledgeKind: "SEMANTIC_RULE" | "BUSINESS_FACT" | "UNKNOWN";
  createdAt: string;
  createdBy: string;
  activatedAt: string | null;
};

export function openPortalDecisionStore(
  cwd = process.cwd(),
): DecisionStore {
  const path = resolvePortalDecisionDbPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  return new DecisionStore(path);
}

export function listOperatorFacingPolicies(
  store: DecisionStore,
): OperatorPolicyView[] {
  const active = store.listPolicies("ACTIVE");
  return active
    .map(toOperatorPolicyView)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function toOperatorPolicyView(p: DecisionPolicy): OperatorPolicyView {
  let title = p.validationSummary?.trim() || p.decisionType;
  let body = p.resolution;
  let knowledgeKind: OperatorPolicyView["knowledgeKind"] =
    p.knowledgeKind ?? "UNKNOWN";
  try {
    const parsed = JSON.parse(p.resolution) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && parsed.kind === "OPERATOR_GLOBAL_GUIDANCE") {
      if (typeof parsed.title === "string") title = parsed.title;
      if (typeof parsed.body === "string") body = parsed.body;
      if (parsed.knowledgeKind === "SEMANTIC_RULE" || parsed.knowledgeKind === "BUSINESS_FACT") {
        knowledgeKind = parsed.knowledgeKind;
      }
    }
  } catch {
    /* plain resolution string */
  }
  return {
    policyId: p.policyId,
    policyVersion: p.policyVersion,
    decisionType: p.decisionType,
    scope: p.scope,
    status: p.status,
    title,
    body,
    knowledgeKind,
    createdAt: p.createdAt,
    createdBy: p.createdBy,
    activatedAt: p.activatedAt,
  };
}

export function createGlobalOperatorPolicy(input: {
  store: DecisionStore;
  title: string;
  body: string;
  createdBy: string;
  knowledgeKind?: "SEMANTIC_RULE" | "BUSINESS_FACT";
  decisionType?: string;
}): DecisionPolicy {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) {
    throw new Error("Title and policy text are required");
  }
  const knowledgeKind = input.knowledgeKind ?? "SEMANTIC_RULE";
  if (knowledgeKind === "BUSINESS_FACT") {
    throw new Error(
      "Global BUSINESS_FACT with fixed menu values is not allowed — use SEMANTIC_RULE guidance",
    );
  }
  const decisionType =
    (input.decisionType?.trim() || OPERATOR_GUIDANCE_DECISION_TYPE) as string;
  const resolution = JSON.stringify({
    kind: "OPERATOR_GLOBAL_GUIDANCE",
    knowledgeKind,
    title,
    body,
  });
  const policy: DecisionPolicy = {
    policyId: `pol_operator_${randomUUID().slice(0, 10)}`,
    policyVersion: 1,
    decisionType,
    scope: "GLOBAL",
    scopeRestaurant: null,
    scopeCategory: null,
    conditions: {
      all: [
        {
          field: "decisionType",
          op: "eq",
          value: decisionType,
        },
      ],
    },
    resolution,
    resolutionOptionId: "operator_guidance",
    status: "ACTIVE",
    createdFromDecisionIds: [],
    confidenceEvidence: "portal-operator-authored",
    createdAt: new Date().toISOString(),
    activatedAt: new Date().toISOString(),
    deprecatedAt: null,
    createdBy: input.createdBy,
    validationSummary: title,
    inventsMissingFacts: false,
    knowledgeKind: "SEMANTIC_RULE",
  };
  input.store.insertPolicyVersion(policy);
  return policy;
}

export function decisionStoreExists(cwd = process.cwd()): boolean {
  return existsSync(resolvePortalDecisionDbPath(cwd));
}
