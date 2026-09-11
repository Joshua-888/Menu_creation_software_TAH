/**
 * M6.3 — Price / addition / variant business facts vs semantic rules.
 * Numeric values stay restaurant-scoped. Semantics may generalize.
 */

import { z } from "zod";
import type { PolicyScope } from "./types.js";

export const KNOWN_DECISION_TYPES_M63 = [
  "PRICE_SEMANTICS",
  "PRICE_CORRECTION",
  "PRICE_OPTION_SEMANTICS",
  "VARIANT_SEMANTICS",
  "VARIANT_PRICING",
  "ADDITION_SET",
  "ADDITION_SCOPE",
  "ADDITION_PRICING",
  "ADDITION_CHOICE_RULE",
  "ADDITION_CORRECTION",
  "PRODUCT_CHOICE_OPTIONS",
  "PRODUCT_CHOICE_SCOPE",
] as const;

export type KnowledgeKind = "SEMANTIC_RULE" | "BUSINESS_FACT";

export const PriceFactTypeSchema = z.enum([
  "BASE_PRICE",
  "VARIANT_SURCHARGE",
  "VARIANT_TOTAL_PRICE",
  "ADDITION_PRICE",
  "PRICE_OPTION_TOTAL",
  "PRICE_CORRECTION",
]);
export type PriceFactType = z.infer<typeof PriceFactTypeSchema>;

export const FactOriginSchema = z.enum([
  "SOURCE",
  "DERIVED",
  "HUMAN_CORRECTION",
  "HUMAN_PROVIDED_BUSINESS_FACT",
  "LEARNED_POLICY",
]);
export type FactOrigin = z.infer<typeof FactOriginSchema>;

export const FactScopeSchema = z.enum([
  "EXACT_PRODUCT",
  "EXACT_CASE",
  "PRODUCT_FAMILY",
  "RESTAURANT_CATEGORY",
  "RESTAURANT",
  "GLOBAL",
]);
export type FactScope = z.infer<typeof FactScopeSchema>;

export type PriceFact = {
  factId: string;
  factVersion: number;
  restaurantKey: string;
  sourceId: string | null;
  menuNumber: string | null;
  sourceCategory: string | null;
  destinationCategoryId: string | null;
  factType: PriceFactType;
  /** Integer minor units (øre for DKK). */
  amountMinor: number;
  currency: "DKK";
  appliesTo: string;
  label: string | null;
  evidenceJson: string | null;
  humanDecisionId: string | null;
  scope: FactScope;
  origin: FactOrigin;
  knowledgeKind: "BUSINESS_FACT";
  supersedesFactId: string | null;
  status: "ACTIVE" | "SUPERSEDED" | "SHADOW" | "REJECTED";
  createdAt: string;
  originalOperatorText: string | null;
};

export type AdditionDefinition = {
  additionId: string;
  name: string;
  /** Normalized match key (lowercase, trimmed). */
  nameKey: string;
  priceMinor: number | null;
  currency: "DKK";
  required: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  origin: FactOrigin;
};

export type AdditionSetFact = {
  factId: string;
  factVersion: number;
  restaurantKey: string;
  sourceCategory: string | null;
  destinationCategoryId: string | null;
  scope: FactScope;
  additions: AdditionDefinition[];
  excludedSourceIds: string[];
  excludedMenuNumbers: string[];
  humanDecisionId: string | null;
  knowledgeKind: "BUSINESS_FACT";
  supersedesFactId: string | null;
  status: "ACTIVE" | "SUPERSEDED" | "SHADOW" | "REJECTED";
  createdAt: string;
  originalOperatorText: string | null;
  evidenceJson: string | null;
};

export type ChoiceOptionsFact = {
  factId: string;
  factVersion: number;
  restaurantKey: string;
  sourceCategory: string | null;
  scope: FactScope;
  prompt: string;
  options: string[];
  required: boolean;
  minSelections: number;
  maxSelections: number;
  productTypeHints: string[];
  excludedMenuNumbers: string[];
  humanDecisionId: string | null;
  knowledgeKind: "BUSINESS_FACT";
  status: "ACTIVE" | "SUPERSEDED" | "SHADOW" | "REJECTED";
  createdAt: string;
  originalOperatorText: string | null;
};

export const CONFLICT_REASON_CODES = [
  "SOURCE_PRICE_CONFLICT",
  "LEARNED_PRICE_CONFLICT",
  "ADDITION_PRICE_CONFLICT",
  "ADDITION_SCOPE_CONFLICT",
  "VARIANT_PRICE_CONFLICT",
  "POLICY_FACT_SCOPE_CONFLICT",
  "STALE_APPROVED_FACT",
  "LEARNED_FACT_CONFLICT_WITH_SOURCE",
  "GLOBAL_FIXED_BUSINESS_FACT_NOT_ALLOWED",
  "ARITHMETIC_MISMATCH",
] as const;

export type ConflictReasonCode = (typeof CONFLICT_REASON_CODES)[number];

export type FactConflict = {
  code: ConflictReasonCode;
  message: string;
  sourceValue: unknown;
  learnedValue: unknown;
  restaurantKey: string;
  factId: string | null;
};

/**
 * Deterministic fact precedence (highest first):
 * 1 CURRENT EXPLICIT SOURCE EVIDENCE
 * 2 EXACT HUMAN CORRECTION FOR CURRENT CASE
 * 3 EXACT PRODUCT APPROVED FACT
 * 4 RESTAURANT_CATEGORY APPROVED FACT
 * 5 RESTAURANT APPROVED FACT
 * 6 semantic precedent/policy
 * 7 AI / human review
 */
export const FACT_PRECEDENCE = [
  "CURRENT_EXPLICIT_SOURCE",
  "EXACT_HUMAN_CORRECTION",
  "EXACT_PRODUCT_FACT",
  "RESTAURANT_CATEGORY_FACT",
  "RESTAURANT_FACT",
  "SEMANTIC_POLICY",
  "AI_OR_HUMAN_REVIEW",
] as const;

export function normalizeAdditionName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function kronerToMinor(kr: number): number {
  return Math.round(kr * 100);
}

export function assertValidMinor(amount: number): void {
  if (!Number.isInteger(amount)) {
    throw new Error(`Money must be integer minor units, got ${amount}`);
  }
}

/** Block GLOBAL policies that embed fixed money amounts (business facts). */
export function assertGlobalPolicyHasNoFixedMoney(input: {
  scope: PolicyScope | FactScope;
  knowledgeKind: KnowledgeKind;
  resolution: string;
  amountMinor?: number | null;
}): void {
  if (input.scope !== "GLOBAL") return;
  if (input.knowledgeKind === "BUSINESS_FACT") {
    throw new Error("GLOBAL_FIXED_BUSINESS_FACT_NOT_ALLOWED");
  }
  if (
    input.amountMinor != null ||
    /\b\d{2,}\s*(kr|øre|dkk)?\b/i.test(input.resolution) ||
    /"amountMinor"\s*:\s*\d+/.test(input.resolution)
  ) {
    throw new Error("GLOBAL_FIXED_BUSINESS_FACT_NOT_ALLOWED");
  }
}

export function reconcileVariantTotals(input: {
  baseMinor: number;
  surchargeMinor: number;
  sourceTotalMinor: number;
}): { ok: boolean; code?: ConflictReasonCode } {
  if (input.baseMinor < 0 || input.surchargeMinor < 0) {
    return { ok: false, code: "ARITHMETIC_MISMATCH" };
  }
  if (input.baseMinor + input.surchargeMinor !== input.sourceTotalMinor) {
    return { ok: false, code: "ARITHMETIC_MISMATCH" };
  }
  return { ok: true };
}
