/**
 * Full visibility catalog: built-in SEMANTIC_RULEs, decision-store policies,
 * and peer artifact policies (probability / structure / addition likelihood).
 */

import { existsSync, readFileSync } from "node:fs";
import type { DecisionStore } from "../decisions/store.js";
import type { DecisionPolicy, PolicyStatus } from "../decisions/types.js";
import {
  peerAdditionLikelihoodPath,
  peerIngredientLikelihoodPath,
  peerProbabilityPolicyPath,
  peerStructureSummaryPath,
} from "../learning/peerArtifacts.js";
import {
  listOperatorFacingPolicies,
  type OperatorPolicyView,
} from "./operatorPolicies.js";

export type BuiltInSemanticRule = {
  id: string;
  title: string;
  summary: string;
  appliesTo: string;
  adjustableVia: string;
  details: string[];
};

/** Always-on / code-default SEMANTIC_RULEs (visibility even before peers run). */
export const BUILT_IN_SEMANTIC_RULES: BuiltInSemanticRule[] = [
  {
    id: "menu-structure-placement",
    title: "Menu structure — variants vs additions",
    summary:
      "Meat/type choices go to variants when no size axis; to additions when Alm/Fam (or similar size) is present. Tilbehør scope may be RESTAURANT / RESTAURANT_CATEGORY / PRODUCT_LOCAL.",
    appliesTo: "Create + QA dry-run write mapping",
    adjustableVia:
      "Peer structure distill (VARIANT_SEMANTICS policy) or operator VARIANT_SEMANTICS / ADDITION_SCOPE guidance",
    details: [
      "Encoded as MENU_STRUCTURE_SEMANTIC on decision-store policy",
      "Default fallback: meat without size → variants; with size → additions; Tilbehør RESTAURANT",
    ],
  },
  {
    id: "category-structural-variants",
    title: "Category structural-variant fan-out",
    summary:
      "If an eligible category shows Alm/Fam, Deep, Glutenfri, Fuldkorn, Hj., fan those variants onto siblings. Never drinks or dip/diverse. Never invent Fam. surcharge — use sibling median.",
    appliesTo: "Create + QA (before Tilbehør fan-out)",
    adjustableVia:
      "Structure SEMANTIC_RULE categoryVariantFanOut; operator VARIANT_SEMANTICS guidance",
    details: [
      "Eligible: pizza, burger, durum, pita, sandwich, indbagt (+ pizza-named)",
      "Excluded: drinks, dip / diverse",
    ],
  },
  {
    id: "category-probability",
    title: "Category probability — dips / Tilbehør kinds",
    summary:
      "P(feature|kind) from peers. Hard priors: drinks never Tilbehør; vegetarian never meat adds; sandwich/burger dips only when menu_with_fries.",
    appliesTo: "Create + QA probability filter",
    adjustableVia:
      "peer-probability-policy.json + PORTAL_APPLY_PEER_PROBABILITY*; operator guidance",
    details: [
      "Artifact: runs/decisions/peer-probability-policy.json",
      "Veroni applies by default; other hosts need opt-in env",
    ],
  },
  {
    id: "category-ingredient-tilbehor",
    title: "Category-ingredient Tilbehør fill",
    summary:
      "When source has no additions, compose ekstra Tilbehør from the union of category ingredients + Beskrivelse. Dips excluded from the union. Price: peer median or 10 kr.",
    appliesTo: "Create + QA when source addOns empty",
    adjustableVia:
      "Operator ADDITION_SCOPE / OPERATOR_GUIDANCE; EXACT_PRODUCT KEEP/SUPPRESS overrides",
    details: [
      "Precedence: EXACT_PRODUCT → category-ingredient union → RESTAURANT Tilbehør → peer category only if union empty",
      "Not applied to drinks / dip / diverse",
    ],
  },
  {
    id: "peer-ingredient-beskrivelse",
    title: "Peer ingredient + beskrivelse likelihood",
    summary:
      "P(ingredient | burger_subtype / product_kind) from peer menucards. QA/Create fill empty or thin Grill cards peer-first; Danish burger baseline is fallback prior only.",
    appliesTo: "Create + QA grill/burger card ingredients + Beskrivelse",
    adjustableVia:
      "peer-ingredient-likelihood.json via m71 observe → m73/m76 distill; corrections on peers become lasting ALLOW rows",
    details: [
      "Artifact: runs/decisions/peer-ingredient-likelihood.json",
      "Precedence: PEER_SUBTYPE → PEER_KIND → DOMAIN_PRIOR (grillCardFill)",
      "Never invents when neither peers nor domain prior apply",
    ],
  },
  {
    id: "label-quality",
    title: "Label quality gate",
    summary:
      "Blocks create when name looks like OCR garbage or an ingredient dump. Safe hygiene repairs only; header-like names (PIZZA Alm. Familie) are not yet auto-fixed into dish names on update.",
    appliesTo: "Create payload; QA reconcile name recovery (planned)",
    adjustableVia: "Learned label corrections + LABEL_QUALITY operator guidance",
    details: ["Learned corrections via decision store / M70 label path"],
  },
  {
    id: "live-write-gates",
    title: "Live write gates",
    summary:
      "Live admin writes are on when TAH_ADMIN_* credentials exist and the host is allowlisted. Kill switch: PORTAL_LIVE_WRITES=0. updateProduct full API stays UNCERTIFIED; narrow Opdater caps are CERTIFIED.",
    appliesTo: "Live execute only",
    adjustableVia: "Env flags + confirm JSON files (not decision policies)",
    details: [
      "Creates stay hidden until separately activated",
      "Existing products: QA reconcile Opdater rewrites the full product card and sets Aktiv? so items are storefront-visible by default (PORTAL_CREATE_HIDDEN=1 to keep Skjult).",
    ],
  },
];

export type ArtifactPolicyView = {
  id: string;
  title: string;
  path: string;
  present: boolean;
  fingerprint?: string;
  summary: string;
  preview?: string;
};

export type PolicyCatalog = {
  builtInSemanticRules: BuiltInSemanticRule[];
  storePolicies: OperatorPolicyView[];
  storeByStatus: Record<string, number>;
  artifacts: ArtifactPolicyView[];
};

function safeReadJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function loadArtifactPolicyViews(repoRoot: string): ArtifactPolicyView[] {
  const out: ArtifactPolicyView[] = [];

  const probPath = peerProbabilityPolicyPath(repoRoot);
  const prob = safeReadJson(probPath) as {
    fingerprint?: string;
    policy?: { dipAllowKinds?: string[]; dipDenyKinds?: string[] };
    rules?: string[];
  } | null;
  out.push({
    id: "peer-probability",
    title: "Peer category probability (SEMANTIC_RULE)",
    path: probPath,
    present: prob != null,
    ...(prob?.fingerprint ? { fingerprint: prob.fingerprint } : {}),
    summary: prob
      ? `Dip allow: ${(prob.policy?.dipAllowKinds ?? []).join(", ") || "(none)"}; deny: ${(prob.policy?.dipDenyKinds ?? []).join(", ") || "(none)"}`
      : "Not generated yet — run peer observe + m73/m76.",
    ...(prob?.rules?.length
      ? { preview: prob.rules.slice(0, 8).join("\n") }
      : {}),
  });

  const structPath = peerStructureSummaryPath(repoRoot);
  const struct = safeReadJson(structPath) as {
    fingerprint?: string;
    meatChoiceWithoutSize?: string;
    meatChoiceWithSize?: string;
    tilbehorScope?: string;
    categoryVariantFanOut?: { mode?: string; enabled?: boolean };
  } | null;
  out.push({
    id: "peer-structure",
    title: "Peer menu structure (SEMANTIC_RULE)",
    path: structPath,
    present: struct != null,
    ...(struct?.fingerprint ? { fingerprint: struct.fingerprint } : {}),
    summary: struct
      ? `Meat: ${struct.meatChoiceWithoutSize}/${struct.meatChoiceWithSize}; Tilbehør ${struct.tilbehorScope}; size fan-out ${struct.categoryVariantFanOut?.mode ?? "n/a"}`
      : "Not generated yet — run peer observe + structure distill.",
    ...(struct
      ? {
          preview: JSON.stringify(
            {
              meatChoiceWithoutSize: struct.meatChoiceWithoutSize,
              meatChoiceWithSize: struct.meatChoiceWithSize,
              tilbehorScope: struct.tilbehorScope,
              categoryVariantFanOut: struct.categoryVariantFanOut,
            },
            null,
            2,
          ),
        }
      : {}),
  });

  const addPath = peerAdditionLikelihoodPath(repoRoot);
  const add = safeReadJson(addPath) as {
    fingerprint?: string;
    proposedSets?: Array<{ kind: string; additions: unknown[] }>;
    rules?: string[];
  } | null;
  out.push({
    id: "peer-addition-likelihood",
    title: "Peer addition likelihood",
    path: addPath,
    present: add != null,
    ...(add?.fingerprint ? { fingerprint: add.fingerprint } : {}),
    summary: add
      ? `Proposed sets: ${(add.proposedSets ?? []).map((p) => `${p.kind}(${p.additions.length})`).join(", ") || "(none)"}`
      : "Not generated yet — run m73/m76 addition likelihood.",
    ...(add?.rules?.length
      ? { preview: add.rules.slice(0, 8).join("\n") }
      : {}),
  });

  const ingPath = peerIngredientLikelihoodPath(repoRoot);
  const ing = safeReadJson(ingPath) as {
    fingerprint?: string;
    bySubtype?: Record<string, { nProducts?: number; ingredients?: unknown[] }>;
    byKind?: Record<string, unknown>;
    rules?: string[];
  } | null;
  const subtypeKeys = Object.keys(ing?.bySubtype ?? {});
  out.push({
    id: "peer-ingredient-likelihood",
    title: "Peer ingredient + beskrivelse likelihood",
    path: ingPath,
    present: ing != null,
    ...(ing?.fingerprint ? { fingerprint: ing.fingerprint } : {}),
    summary: ing
      ? `Subtypes: ${subtypeKeys.map((k) => `${k}(n=${ing.bySubtype?.[k]?.nProducts ?? 0})`).join(", ") || "(none)"}; kinds=${Object.keys(ing.byKind ?? {}).length}`
      : "Not generated yet — run m71 observe then m73/m76 ingredient likelihood.",
    ...(ing?.rules?.length
      ? { preview: ing.rules.slice(0, 8).join("\n") }
      : {}),
  });

  return out;
}

export function listAllStorePolicyViews(
  store: DecisionStore,
): OperatorPolicyView[] {
  const statuses: PolicyStatus[] = [
    "ACTIVE",
    "SHADOW",
    "DEPRECATED",
    "DRAFT",
    "REJECTED",
  ];
  const byId = new Map<string, OperatorPolicyView>();
  // Prefer ACTIVE from helper, then fill other latest statuses
  for (const p of listOperatorFacingPolicies(store)) {
    byId.set(p.policyId, p);
  }
  for (const status of statuses) {
    if (status === "ACTIVE") continue;
    for (const p of store.listPolicies(status)) {
      if (byId.has(p.policyId)) continue;
      byId.set(p.policyId, toView(p));
    }
  }
  // Also include any latest that listPolicies without filter would get
  for (const p of store.listPolicies()) {
    const cur = byId.get(p.policyId);
    if (!cur || cur.policyVersion < p.policyVersion) {
      byId.set(p.policyId, toView(p));
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
    if (b.status === "ACTIVE" && a.status !== "ACTIVE") return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function toView(p: DecisionPolicy): OperatorPolicyView {
  let title = p.validationSummary?.trim() || p.decisionType;
  let body = p.resolution;
  let knowledgeKind: OperatorPolicyView["knowledgeKind"] =
    p.knowledgeKind ?? "UNKNOWN";
  try {
    const parsed = JSON.parse(p.resolution) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.kind === "OPERATOR_GLOBAL_GUIDANCE"
    ) {
      if (typeof parsed.title === "string") title = parsed.title;
      if (typeof parsed.body === "string") body = parsed.body;
      if (
        parsed.knowledgeKind === "SEMANTIC_RULE" ||
        parsed.knowledgeKind === "BUSINESS_FACT"
      ) {
        knowledgeKind = parsed.knowledgeKind;
      }
    } else if (parsed && typeof parsed === "object" && parsed.kind) {
      title = `${p.decisionType} (${String(parsed.kind)})`;
      if (parsed.knowledgeKind === "SEMANTIC_RULE") {
        knowledgeKind = "SEMANTIC_RULE";
      }
    }
  } catch {
    /* plain */
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

export function buildPolicyCatalog(
  store: DecisionStore,
  repoRoot: string,
): PolicyCatalog {
  const storePolicies = listAllStorePolicyViews(store);
  const storeByStatus: Record<string, number> = {};
  for (const p of storePolicies) {
    storeByStatus[p.status] = (storeByStatus[p.status] ?? 0) + 1;
  }
  return {
    builtInSemanticRules: BUILT_IN_SEMANTIC_RULES,
    storePolicies,
    storeByStatus,
    artifacts: loadArtifactPolicyViews(repoRoot),
  };
}

export function deprecateStorePolicy(
  store: DecisionStore,
  policyId: string,
): DecisionPolicy {
  const latest = store.latestPolicy(policyId);
  if (!latest) throw new Error(`Policy not found: ${policyId}`);
  if (latest.status === "DEPRECATED") return latest;
  return store.newPolicyStatus(policyId, latest.policyVersion, "DEPRECATED");
}

export function activateStorePolicy(
  store: DecisionStore,
  policyId: string,
): DecisionPolicy {
  const latest = store.latestPolicy(policyId);
  if (!latest) throw new Error(`Policy not found: ${policyId}`);
  if (latest.status === "ACTIVE") return latest;
  // Deprecate other ACTIVE with same decisionType+GLOBAL operator guidance collision is ok
  return store.newPolicyStatus(policyId, latest.policyVersion, "ACTIVE");
}

export function updateOperatorGuidancePolicy(input: {
  store: DecisionStore;
  policyId: string;
  title: string;
  body: string;
  createdBy: string;
}): DecisionPolicy {
  const latest = input.store.latestPolicy(input.policyId);
  if (!latest) throw new Error(`Policy not found: ${input.policyId}`);
  let isGuidance = latest.decisionType === "OPERATOR_GUIDANCE";
  try {
    const parsed = JSON.parse(latest.resolution) as { kind?: string };
    if (parsed?.kind === "OPERATOR_GLOBAL_GUIDANCE") isGuidance = true;
  } catch {
    /* non-JSON resolution */
  }
  if (!isGuidance) {
    throw new Error(
      "Only operator global guidance policies can be edited from the portal",
    );
  }
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new Error("Title and body required");

  // Deprecate current then insert new ACTIVE version with updated resolution
  input.store.newPolicyStatus(
    input.policyId,
    latest.policyVersion,
    "DEPRECATED",
  );
  const resolution = JSON.stringify({
    kind: "OPERATOR_GLOBAL_GUIDANCE",
    knowledgeKind: "SEMANTIC_RULE",
    title,
    body,
  });
  const next: DecisionPolicy = {
    ...latest,
    policyVersion: latest.policyVersion + 1,
    status: "ACTIVE",
    resolution,
    validationSummary: title,
    createdAt: new Date().toISOString(),
    activatedAt: new Date().toISOString(),
    deprecatedAt: null,
    createdBy: input.createdBy,
    knowledgeKind: "SEMANTIC_RULE",
    inventsMissingFacts: false,
  };
  input.store.insertPolicyVersion(next);
  return next;
}
