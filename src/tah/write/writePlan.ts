import { ADMIN_CONTRACT_V1 } from "../contracts/v1.js";
import {
  CANARY_NAMES,
  VERONI_CANARY_TARGET,
  type WritePlan,
  type WritePlanOperation,
} from "./types.js";

function freezePlan(plan: WritePlan): WritePlan {
  return Object.freeze({
    ...plan,
    immutable: true as const,
    operations: Object.freeze(
      plan.operations.map((op) => Object.freeze({ ...op })),
    ),
    notes: Object.freeze([...plan.notes]),
  });
}

export function assertWritePlanExactlyOneCreateProduct(plan: WritePlan): void {
  if (plan.operations.length !== 1) {
    throw new Error(
      `WritePlan must contain exactly 1 operation, found ${plan.operations.length}`,
    );
  }
  const op = plan.operations[0];
  if (!op || op.action !== "CREATE_PRODUCT") {
    throw new Error(`WritePlan must be CREATE_PRODUCT only, found ${op?.action}`);
  }
  if (plan.operations.some((o) => o.action === "CREATE_CATEGORY")) {
    throw new Error("CREATE_CATEGORY is forbidden in M3 resume");
  }
}

/**
 * M3 resume: single inactive CREATE_PRODUCT against an existing category.
 */
export function createInactiveProductWritePlan(input: {
  runId: string;
  dryRun: boolean;
  menuNumber: string;
  productName: string;
  description: string;
  basePriceOre: number;
  categoryDatabaseId: string;
  categoryName: string;
  variants: Array<{ name: string; priceOre: number }>;
  ingredients: string[];
  operationIdSuffix?: string;
}): WritePlan {
  const suffix = input.operationIdSuffix ?? "prod:1";
  const ops: WritePlanOperation[] = [
    {
      operationId: `${input.runId}:${suffix}`,
      entityType: "product",
      action: "CREATE_PRODUCT",
      expectedBefore: {
        productNameAbsent: input.productName,
        menuNumberUnused: input.menuNumber,
        activeMustRemain: false,
        categoryExists: input.categoryDatabaseId,
      },
      expectedAfter: {
        name: input.productName,
        menuNumber: input.menuNumber,
        description: input.description,
        basePriceOre: input.basePriceOre,
        variants: input.variants,
        ingredients: input.ingredients.map((name) => ({ name })),
        active: false,
        categoryDatabaseId: input.categoryDatabaseId,
        categoryName: input.categoryName,
      },
      verification: [
        "readProduct by destination databaseId",
        "exact field compare including active===false",
        "public site must NOT show product name",
      ],
      state: "PENDING_WRITE",
    },
  ];

  const plan = freezePlan({
    planId: `wp-${input.runId}-${suffix}`,
    runId: input.runId,
    targetHost: VERONI_CANARY_TARGET.host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    contractVersion: ADMIN_CONTRACT_V1.version,
    adapterVersion: "1.0.0",
    dryRun: input.dryRun,
    immutable: true,
    createdAt: new Date().toISOString(),
    operations: ops,
    notes: [
      "M3 resume: existing category only — no createCategory",
      "active must be forced unchecked before submit",
      "no additions, images, updates, or deletes",
    ],
  });
  assertWritePlanExactlyOneCreateProduct(plan);
  return plan;
}

/** @deprecated Prefer createInactiveProductWritePlan for M3 resume */
export function createCanaryWritePlan(input: {
  runId: string;
  dryRun: boolean;
  reservedMenuNumber?: string;
}): WritePlan {
  return createInactiveProductWritePlan({
    runId: input.runId,
    dryRun: input.dryRun,
    menuNumber: input.reservedMenuNumber ?? CANARY_NAMES.reservedMenuNumber,
    productName: CANARY_NAMES.product,
    description: CANARY_NAMES.description,
    basePriceOre: 9900,
    categoryDatabaseId: "EXISTING_TBD",
    categoryName: "EXISTING_TBD",
    variants: [{ name: "Alm.", priceOre: 0 }],
    ingredients: [CANARY_NAMES.ingredientA, CANARY_NAMES.ingredientB],
  });
}

export function assertWritePlanImmutable(plan: WritePlan): void {
  if (plan.immutable !== true) {
    throw new Error("WritePlan must be immutable");
  }
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.operations)) {
    throw new Error("WritePlan objects must be frozen");
  }
}

export function rejectPlanMutation(
  plan: WritePlan,
  mutate: (p: WritePlan) => void,
): "REJECTED" {
  assertWritePlanImmutable(plan);
  try {
    mutate(plan);
  } catch {
    return "REJECTED";
  }
  return "REJECTED";
}

/** Deterministic category pick: lowest numeric databaseId. */
export function selectExistingCategoryDeterministic(
  categories: Array<{ databaseId: string; name: string }>,
): { databaseId: string; name: string } {
  if (categories.length === 0) {
    throw new Error("No existing categories available");
  }
  const sorted = [...categories].sort((a, b) => {
    const an = Number(a.databaseId);
    const bn = Number(b.databaseId);
    if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
    return a.databaseId.localeCompare(b.databaseId);
  });
  return sorted[0]!;
}
