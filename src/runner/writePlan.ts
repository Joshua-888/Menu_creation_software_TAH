/**
 * M4 immutable migration WritePlan — browser must not invent menu decisions.
 *
 * Primary identity is sourceId. menuNumber + name are matching evidence only.
 * Once created, destinationDatabaseId is preferred for known destination ops.
 */

export type WritePlanAction =
  | "CREATE"
  | "UPDATE"
  | "SKIP"
  | "REVIEW"
  | "BLOCK";

export type WritePlanEntityType = "category" | "product";

/**
 * Stable product identity for WritePlan operations.
 * sourceId is the permanent internal key — never menuNumber+name.
 */
export type ProductIdentityKey = {
  sourceId: string;
  /** Matching evidence only (not an immutable primary key). */
  menuNumber?: string;
  /** Matching evidence only. */
  name?: string;
  /** Optional category hint for destination matching. */
  categoryHint?: string;
  /** Preferred once a destination entity exists. */
  destinationDatabaseId?: string;
};

export type PlannedProductPayload = {
  sourceId: string;
  menuNumber: string;
  name: string;
  description: string;
  basePriceOre: number;
  categoryIds: string[];
  variants: Array<{ name: string; surchargeOre: number }>;
  ingredients: string[];
  additions: Array<{ name: string; priceOre: number }>;
  /** Create/update path: intended HIDDEN when true; storefront-visible when false. */
  intendedHidden: boolean;
};

export type WritePlanOperation = {
  operationId: string;
  entityType: WritePlanEntityType;
  action: WritePlanAction;
  identity: ProductIdentityKey;
  expectedPayload: PlannedProductPayload | null;
  reason?: string;
  /** Certified capability names required for live execution of this op. */
  requiredCapabilities?: string[];
  /** Capability names that are missing / uncertified. */
  missingCapabilities?: string[];
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
  dryRun: boolean;
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
    if (op.requiredCapabilities) Object.freeze(op.requiredCapabilities);
    if (op.missingCapabilities) Object.freeze(op.missingCapabilities);
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
  dryRun?: boolean;
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
    dryRun: input.dryRun ?? false,
    createdAt: new Date().toISOString(),
    operations: input.operations.map((o) => ({ ...o })),
  });
}

export function planCreateProduct(input: {
  operationId: string;
  payload: PlannedProductPayload;
  requiredCapabilities?: string[];
  missingCapabilities?: string[];
}): WritePlanOperation {
  return {
    operationId: input.operationId,
    entityType: "product",
    action: "CREATE",
    identity: {
      sourceId: input.payload.sourceId,
      menuNumber: input.payload.menuNumber,
      name: input.payload.name,
    },
    expectedPayload: input.payload,
    ...(input.requiredCapabilities
      ? { requiredCapabilities: input.requiredCapabilities }
      : {}),
    ...(input.missingCapabilities
      ? { missingCapabilities: input.missingCapabilities }
      : {}),
  };
}

export function planCreateCategory(input: {
  operationId: string;
  sourceId: string;
  name: string;
  requiredCapabilities?: string[];
  missingCapabilities?: string[];
  reason?: string;
}): WritePlanOperation {
  return {
    operationId: input.operationId,
    entityType: "category",
    action: "CREATE",
    identity: {
      sourceId: input.sourceId,
      name: input.name,
    },
    expectedPayload: null,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.requiredCapabilities
      ? { requiredCapabilities: input.requiredCapabilities }
      : {}),
    ...(input.missingCapabilities
      ? { missingCapabilities: input.missingCapabilities }
      : {}),
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
  missingCapabilities?: string[];
}): WritePlanOperation {
  return {
    operationId: input.operationId,
    entityType: "product",
    action: "BLOCK",
    identity: input.identity,
    expectedPayload: null,
    reason: input.reason,
    ...(input.missingCapabilities
      ? { missingCapabilities: input.missingCapabilities }
      : {}),
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

export function planUpdateProduct(input: {
  operationId: string;
  identity: ProductIdentityKey;
  payload: PlannedProductPayload;
  reason?: string;
  requiredCapabilities?: string[];
  missingCapabilities?: string[];
}): WritePlanOperation {
  return {
    operationId: input.operationId,
    entityType: "product",
    action: "UPDATE",
    identity: input.identity,
    expectedPayload: input.payload,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.requiredCapabilities
      ? { requiredCapabilities: input.requiredCapabilities }
      : {}),
    ...(input.missingCapabilities
      ? { missingCapabilities: input.missingCapabilities }
      : {}),
  };
}
