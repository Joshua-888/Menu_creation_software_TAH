/**
 * M4 immutable migration WritePlan — browser must not invent menu decisions.
 */

export type WritePlanAction =
  | "CREATE"
  | "UPDATE"
  | "SKIP"
  | "REVIEW"
  | "BLOCK";

export type WritePlanEntityType = "category" | "product";

/** Stable identity used for destination lookup / idempotency. */
export type ProductIdentityKey = {
  menuNumber: string;
  name: string;
};

export type PlannedProductPayload = {
  menuNumber: string;
  name: string;
  description: string;
  basePriceOre: number;
  categoryIds: string[];
  variants: Array<{ name: string; surchargeOre: number }>;
  ingredients: string[];
  additions: Array<{ name: string; priceOre: number }>;
  /** Create path: intended HIDDEN (unchecked Aktiv?). */
  intendedHidden: boolean;
};

export type WritePlanOperation = {
  operationId: string;
  entityType: WritePlanEntityType;
  action: WritePlanAction;
  identity: ProductIdentityKey;
  expectedPayload: PlannedProductPayload | null;
  reason?: string;
};

export type MigrationWritePlan = {
  planId: string;
  runId: string;
  restaurant: string;
  host: string;
  source: string;
  schemaVersion: string;
  domainRuleVersion: string;
  adapterVersion: string;
  contractFingerprint: string;
  immutable: true;
  createdAt: string;
  operations: readonly WritePlanOperation[];
};

export function freezeWritePlan(plan: MigrationWritePlan): MigrationWritePlan {
  for (const op of plan.operations) {
    Object.freeze(op);
    if (op.expectedPayload) {
      Object.freeze(op.expectedPayload);
      Object.freeze(op.expectedPayload.variants);
      Object.freeze(op.expectedPayload.ingredients);
      Object.freeze(op.expectedPayload.additions);
      Object.freeze(op.expectedPayload.categoryIds);
    }
    Object.freeze(op.identity);
  }
  Object.freeze(plan.operations);
  return Object.freeze(plan);
}

export function assertWritePlanImmutable(plan: MigrationWritePlan): void {
  if (!Object.isFrozen(plan) || !plan.immutable) {
    throw new Error("WritePlan must be immutable");
  }
  if (!Object.isFrozen(plan.operations)) {
    throw new Error("WritePlan operations must be frozen");
  }
}

export function createMigrationWritePlan(input: {
  runId: string;
  restaurant: string;
  host: string;
  source: string;
  schemaVersion: string;
  domainRuleVersion: string;
  adapterVersion: string;
  contractFingerprint: string;
  operations: WritePlanOperation[];
}): MigrationWritePlan {
  return freezeWritePlan({
    planId: `wp-${input.runId}`,
    runId: input.runId,
    restaurant: input.restaurant,
    host: input.host,
    source: input.source,
    schemaVersion: input.schemaVersion,
    domainRuleVersion: input.domainRuleVersion,
    adapterVersion: input.adapterVersion,
    contractFingerprint: input.contractFingerprint,
    immutable: true,
    createdAt: new Date().toISOString(),
    operations: input.operations.map((o) => ({ ...o })),
  });
}

export function planCreateProduct(input: {
  operationId: string;
  payload: PlannedProductPayload;
}): WritePlanOperation {
  return {
    operationId: input.operationId,
    entityType: "product",
    action: "CREATE",
    identity: {
      menuNumber: input.payload.menuNumber,
      name: input.payload.name,
    },
    expectedPayload: input.payload,
  };
}

export function planSkipProduct(input: {
  operationId: string;
  identity: ProductIdentityKey;
  reason: string;
}): WritePlanOperation {
  return {
    operationId: input.operationId,
    entityType: "product",
    action: "SKIP",
    identity: input.identity,
    expectedPayload: null,
    reason: input.reason,
  };
}

export function planBlockProduct(input: {
  operationId: string;
  identity: ProductIdentityKey;
  reason: string;
}): WritePlanOperation {
  return {
    operationId: input.operationId,
    entityType: "product",
    action: "BLOCK",
    identity: input.identity,
    expectedPayload: null,
    reason: input.reason,
  };
}

export function planReviewProduct(input: {
  operationId: string;
  identity: ProductIdentityKey;
  reason: string;
}): WritePlanOperation {
  return {
    operationId: input.operationId,
    entityType: "product",
    action: "REVIEW",
    identity: input.identity,
    expectedPayload: null,
    reason: input.reason,
  };
}
