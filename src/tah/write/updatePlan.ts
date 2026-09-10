/**
 * Immutable single-field product update plans (Opdater persist boundary).
 */

export type AllowedProductChangeField =
  | "description"
  | "name"
  | "menuNumber"
  | "basePrice"
  | "categoryIds"
  | "variants"
  | "ingredients"
  | "additions"
  | "active"
  | "image";

export type ScalarProductUpdatePlan = {
  readonly immutable: true;
  readonly action: "UPDATE_PRODUCT";
  readonly databaseId: string;
  readonly allowedChanges: readonly AllowedProductChangeField[];
  readonly expectedBefore: Readonly<Record<string, unknown>>;
  readonly expectedAfter: Readonly<Record<string, unknown>>;
  readonly mustPreserve: readonly AllowedProductChangeField[];
};

export function createDescriptionUpdatePlan(input: {
  databaseId: string;
  expectedBeforeDescription: string;
  expectedAfterDescription: string;
  preserved: Readonly<Record<string, unknown>>;
}): ScalarProductUpdatePlan {
  const allowedChanges = ["description"] as const;
  const mustPreserve = [
    "menuNumber",
    "name",
    "basePrice",
    "categoryIds",
    "variants",
    "ingredients",
    "additions",
  ] as const;

  return Object.freeze({
    immutable: true as const,
    action: "UPDATE_PRODUCT" as const,
    databaseId: input.databaseId,
    allowedChanges,
    expectedBefore: Object.freeze({
      ...input.preserved,
      description: input.expectedBeforeDescription,
    }),
    expectedAfter: Object.freeze({
      ...input.preserved,
      description: input.expectedAfterDescription,
    }),
    mustPreserve,
  });
}

export function assertPlanAllowsOnly(
  plan: ScalarProductUpdatePlan,
  fields: readonly AllowedProductChangeField[],
): void {
  if (plan.allowedChanges.length !== fields.length) {
    throw new Error(
      `allowedChanges length ${plan.allowedChanges.length} != ${fields.length}`,
    );
  }
  for (const f of fields) {
    if (!plan.allowedChanges.includes(f)) {
      throw new Error(`allowedChanges missing ${f}`);
    }
  }
}

/** Semantic business keys used for BEFORE/AFTER compare. */
export type SemanticProductSnapshot = {
  menuNumber: string | null;
  name: string | null;
  description: string | null;
  basePriceOre: number | null;
  basePriceRaw: string | null;
  categoryIds: string[];
  variants: Array<{
    databaseId: string | null;
    name: string;
    priceOre: number | null;
    priceRaw: string;
  }>;
  ingredients: Array<{ databaseId: string | null; name: string }>;
  additions: Array<{
    databaseId: string | null;
    name: string;
    priceOre: number | null;
    priceRaw: string;
  }>;
};

export function semanticDiff(
  before: SemanticProductSnapshot,
  after: SemanticProductSnapshot,
): string[] {
  const diffs: string[] = [];
  const keys: (keyof SemanticProductSnapshot)[] = [
    "menuNumber",
    "name",
    "description",
    "basePriceOre",
    "basePriceRaw",
    "categoryIds",
    "variants",
    "ingredients",
    "additions",
  ];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      diffs.push(k);
    }
  }
  return diffs;
}

export function assertExactlyAllowedSemanticDiff(
  diffs: readonly string[],
  allowed: readonly string[],
): { ok: true } | { ok: false; unauthorized: string[] } {
  const unauthorized = diffs.filter((d) => !allowed.includes(d));
  const missing = allowed.filter((a) => !diffs.includes(a));
  if (unauthorized.length > 0) {
    return { ok: false, unauthorized };
  }
  if (missing.length > 0) {
    return { ok: false, unauthorized: missing.map((m) => `missing_expected:${m}`) };
  }
  if (diffs.length !== allowed.length) {
    return { ok: false, unauthorized: [`diff_count:${diffs.length}`] };
  }
  return { ok: true };
}

/** Blind retry after ambiguous Opdater is forbidden. */
export function mayRetryOpdaterAfterAmbiguousResult(): false {
  return false;
}
