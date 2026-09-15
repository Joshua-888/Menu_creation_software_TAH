/**
 * Label-quality decision cases: emit REVIEW, record human corrections,
 * apply restaurant-scoped precedents on later imports.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  assessLabelQuality,
  formatIngredientDisplay,
  formatProductName,
  labelQualityBlocksWrite,
  type LabelQualityAssessment,
} from "../domain/textNormalize.js";
import { registerOcrIngredientFix } from "../domain/learnedTextFixes.js";
import { buildDecisionFeatures } from "./features.js";
import { classifyRisk } from "./gate.js";
import type { DecisionPolicyRegistry } from "./engine.js";
import type { DecisionStore } from "./store.js";
import type {
  DecisionCase,
  DecisionOption,
  HumanReviewAnswer,
  ScopePreference,
} from "./types.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
} from "./versions.js";

export const LABEL_QUALITY_DECISION_TYPE = "SOURCE_AMBIGUITY" as const;

export const LABEL_QUALITY_OPTIONS: DecisionOption[] = [
  {
    id: "use_corrected_label",
    label: "Use corrected name + ingredients",
    effect: "apply_corrected_label",
  },
  {
    id: "move_list_to_description",
    label: "Move ingredient list to description; set short name",
    effect: "move_list_to_description",
  },
  {
    id: "block_write",
    label: "Block write until better source evidence",
    effect: "block",
  },
];

export type LabelCorrectionPayload = {
  name: string;
  description?: string;
  ingredients: string[];
  /** Optional OCR word→display pairs learned from this answer. */
  ocrFixes?: Array<{ from: string; to: string }>;
};

export function fingerprintLabelSource(input: {
  menuNumber?: string | null;
  name: string;
  ingredients?: readonly string[];
}): string {
  const raw = [
    (input.menuNumber ?? "").trim(),
    input.name.trim().toLowerCase(),
    ...(input.ingredients ?? []).map((i) => i.trim().toLowerCase()),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function encodeLabelCorrection(payload: LabelCorrectionPayload): string {
  return JSON.stringify({
    kind: "LABEL_CORRECTION",
    name: formatProductName(payload.name),
    description: payload.description?.trim() ?? "",
    ingredients: payload.ingredients
      .map((i) => formatIngredientDisplay(i))
      .filter(Boolean),
    ...(payload.ocrFixes?.length ? { ocrFixes: payload.ocrFixes } : {}),
  });
}

export function parseLabelCorrection(
  resolution: string,
): LabelCorrectionPayload | null {
  try {
    const parsed = JSON.parse(resolution) as Record<string, unknown>;
    if (parsed.kind !== "LABEL_CORRECTION") return null;
    if (typeof parsed.name !== "string" || !parsed.name.trim()) return null;
    const ingredients = Array.isArray(parsed.ingredients)
      ? parsed.ingredients.filter((x): x is string => typeof x === "string")
      : [];
    const ocrFixes = Array.isArray(parsed.ocrFixes)
      ? parsed.ocrFixes
          .map((f) => {
            if (!f || typeof f !== "object") return null;
            const o = f as { from?: unknown; to?: unknown };
            if (typeof o.from !== "string" || typeof o.to !== "string") {
              return null;
            }
            return { from: o.from, to: o.to };
          })
          .filter((x): x is { from: string; to: string } => x !== null)
      : undefined;
    return {
      name: parsed.name,
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      ingredients,
      ...(ocrFixes?.length ? { ocrFixes } : {}),
    };
  } catch {
    return null;
  }
}

export function buildLabelQualityDecisionCase(input: {
  runId: string;
  restaurantKey: string;
  host?: string;
  menuNumber?: string | null;
  productName: string;
  sourceCategory?: string | null;
  sourceText?: string;
  ingredients?: readonly string[];
  description?: string;
  assessment?: LabelQualityAssessment;
}): DecisionCase {
  const assessment =
    input.assessment ??
    assessLabelQuality({
      name: input.productName,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.ingredients !== undefined
        ? { ingredients: input.ingredients }
        : {}),
    });
  const sourceText =
    input.sourceText ??
    [
      `name=${input.productName}`,
      `ingredients=${(input.ingredients ?? []).join(", ")}`,
      `reasons=${assessment.reasons.join(",")}`,
      `fp=${fingerprintLabelSource({
        name: input.productName,
        ...(input.menuNumber !== undefined
          ? { menuNumber: input.menuNumber }
          : {}),
        ...(input.ingredients !== undefined
          ? { ingredients: input.ingredients }
          : {}),
      })}`,
    ].join("\n");
  const features = buildDecisionFeatures({
    decisionType: LABEL_QUALITY_DECISION_TYPE,
    sourceText,
    productName: input.productName,
    sourceCategory: input.sourceCategory ?? null,
    restaurantKey: input.restaurantKey,
    menuNumber: input.menuNumber ?? null,
  });
  const now = new Date().toISOString();
  const fp = fingerprintLabelSource({
    name: input.productName,
    ...(input.menuNumber !== undefined
      ? { menuNumber: input.menuNumber }
      : {}),
    ...(input.ingredients !== undefined
      ? { ingredients: input.ingredients }
      : {}),
  });
  return {
    decisionCaseId: `dc_label_${randomUUID()}`,
    runId: input.runId,
    sourceId: `label:${input.menuNumber ?? "x"}:${fp}`,
    restaurantId: input.restaurantKey,
    restaurantKey: input.restaurantKey,
    host: input.host ?? input.restaurantKey,
    menuNumber: input.menuNumber ?? null,
    productName: input.productName,
    sourceCategory: input.sourceCategory ?? null,
    destinationCategoryCandidate: null,
    decisionType: LABEL_QUALITY_DECISION_TYPE,
    sourceText,
    normalizedSourceText: sourceText.toLowerCase(),
    contextFeatures: features,
    sourceEvidenceJson: JSON.stringify({
      assessment,
      fingerprint: fp,
    }),
    currentCanonicalInterpretation: JSON.stringify(assessment.repaired),
    availableOptions: LABEL_QUALITY_OPTIONS,
    recommendedOptionId: "use_corrected_label",
    recommendedRationale:
      "System recommendation only — apply operator-corrected name/ingredients; never invent dish titles",
    isSystemRecommendationOnly: true,
    status: "HUMAN_REVIEW_REQUIRED",
    riskClass: classifyRisk({
      decisionType: LABEL_QUALITY_DECISION_TYPE,
      features,
    }),
    resolutionId: null,
    resolutionMethod: null,
    explanationJson: JSON.stringify({ reasons: assessment.reasons }),
    createdAt: now,
    updatedAt: now,
    decisionEngineVersion: DECISION_ENGINE_VERSION,
    schemaVersion: DECISION_SCHEMA_VERSION,
  };
}

/**
 * Look up a learned label correction for this restaurant + menu / fingerprint.
 * Prefer ACTIVE policies, then HUMAN_RESOLVED decisions.
 */
export function lookupLearnedLabelCorrection(
  store: DecisionStore,
  input: {
    restaurantKey: string;
    menuNumber?: string | null;
    name: string;
    ingredients?: readonly string[];
  },
): LabelCorrectionPayload | null {
  const fp = fingerprintLabelSource(input);
  const menu = (input.menuNumber ?? "").trim();

  const active = store.listPolicies("ACTIVE");
  for (const p of active) {
    if (p.decisionType !== LABEL_QUALITY_DECISION_TYPE) continue;
    if (p.scopeRestaurant && p.scopeRestaurant !== input.restaurantKey) {
      continue;
    }
    const corr = parseLabelCorrection(p.resolution);
    if (!corr) continue;
    // Match by menu number encoded in supporting case features when possible
    const supportId = p.createdFromDecisionIds[0];
    if (supportId) {
      const human = store
        .listHumanDecisions()
        .find((h) => h.humanDecisionId === supportId);
      if (human) {
        const c = store.getCase(human.decisionCaseId);
        if (c?.restaurantKey === input.restaurantKey) {
          if (menu && c.menuNumber === menu) return corr;
          try {
            const ev = c.sourceEvidenceJson
              ? (JSON.parse(c.sourceEvidenceJson) as { fingerprint?: string })
              : null;
            if (ev?.fingerprint === fp) return corr;
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  const humans = store
    .listHumanDecisions({ decisionType: LABEL_QUALITY_DECISION_TYPE })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const h of humans) {
    const c = store.getCase(h.decisionCaseId);
    if (!c || c.restaurantKey !== input.restaurantKey) continue;
    if (c.status !== "HUMAN_RESOLVED") continue;
    if (menu && c.menuNumber === menu) {
      const corr = parseLabelCorrection(h.selectedResolution);
      if (corr) return corr;
    }
    try {
      const ev = c.sourceEvidenceJson
        ? (JSON.parse(c.sourceEvidenceJson) as { fingerprint?: string })
        : null;
      if (ev?.fingerprint === fp) {
        const corr = parseLabelCorrection(h.selectedResolution);
        if (corr) return corr;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function recordLabelQualityCorrection(input: {
  store: DecisionStore;
  registry: DecisionPolicyRegistry;
  decisionCase: DecisionCase;
  correction: LabelCorrectionPayload;
  scopePreference?: ScopePreference;
  operatorId?: string;
  selectedOptionId?: string;
}): ReturnType<DecisionPolicyRegistry["recordHumanDecision"]> {
  const scope =
    input.scopePreference ?? ("APPLY_TO_THIS_RESTAURANT" as const);
  if (scope !== "APPLY_THIS_CASE_ONLY" && input.correction.ocrFixes) {
    for (const fix of input.correction.ocrFixes) {
      registerOcrIngredientFix(fix.from, fix.to);
    }
  }
  const answer: HumanReviewAnswer = {
    decisionCaseId: input.decisionCase.decisionCaseId,
    resolution: encodeLabelCorrection(input.correction),
    selectedOptionId: input.selectedOptionId ?? "use_corrected_label",
    scopePreference: scope,
    operatorId: input.operatorId ?? "label-quality",
    comment: "label quality correction",
  };
  input.registry.registerCase(input.decisionCase);
  return input.registry.recordHumanDecision(input.decisionCase, answer);
}

/**
 * Gate a write payload: apply learned correction or auto-repair;
 * return failure reason when REVIEW/BLOCK remains.
 */
export function gateWriteLabels(input: {
  store?: DecisionStore | null;
  restaurantKey?: string;
  menuNumber?: string | null;
  name: string;
  description?: string;
  ingredients?: readonly string[];
}): {
  ok: boolean;
  assessment: LabelQualityAssessment;
  name: string;
  description: string;
  ingredients: string[];
  failure?: string;
  fromPrecedent?: boolean;
} {
  if (input.store && input.restaurantKey) {
    const learned = lookupLearnedLabelCorrection(input.store, {
      restaurantKey: input.restaurantKey,
      name: input.name,
      ...(input.menuNumber !== undefined
        ? { menuNumber: input.menuNumber }
        : {}),
      ...(input.ingredients !== undefined
        ? { ingredients: input.ingredients }
        : {}),
    });
    if (learned) {
      const assessment = assessLabelQuality({
        name: learned.name,
        ...(learned.description !== undefined
          ? { description: learned.description }
          : {}),
        ingredients: learned.ingredients,
      });
      // Learned correction is trusted for write even if heuristics still REVIEW
      // (operator already resolved the dish title).
      return {
        ok: true,
        assessment: { ...assessment, severity: "PASS", reasons: [] },
        name: learned.name,
        description:
          learned.description ||
          assessment.repaired.description ||
          learned.ingredients.join(", "),
        ingredients: learned.ingredients,
        fromPrecedent: true,
      };
    }
  }

  const assessment = assessLabelQuality({
    name: input.name,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.ingredients !== undefined
      ? { ingredients: input.ingredients }
      : {}),
  });
  if (labelQualityBlocksWrite(assessment)) {
    return {
      ok: false,
      assessment,
      name: assessment.repaired.name,
      description: assessment.repaired.description,
      ingredients: assessment.repaired.ingredients,
      failure: `LABEL_QUALITY_${assessment.severity}: ${assessment.reasons.join(",")}`,
    };
  }
  return {
    ok: true,
    assessment,
    name: assessment.repaired.name,
    description: assessment.repaired.description || (input.description ?? ""),
    ingredients: assessment.repaired.ingredients,
  };
}
