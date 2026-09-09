import type { ContractStatus } from "../contracts/v1.js";
import { evaluateEmptyProductBaseline } from "./safetyGates.js";
import { assertVeroniTargetLock } from "./targetLock.js";
import {
  assertWritePlanExactlyOneCreateProduct,
  createInactiveProductWritePlan,
} from "./writePlan.js";
import type { WritePlan } from "./types.js";
import { CANARY_NAMES } from "./types.js";

export type DryRunPreflightInput = {
  hostname: string;
  restaurantName: string;
  url?: string;
  productCount: number;
  productNames?: string[];
  categoryCount: number;
  contractStatus: ContractStatus;
  /** Authorized M3 resume protocol: force-uncheck before submit. */
  inactiveUncheckProtocolAuthorized: boolean;
  activeDefaultChecked: boolean | null;
  activeCurrentlyUnchecked: boolean;
  selectedCategoryDatabaseId: string;
  selectedCategoryName: string;
  runId: string;
};

export type DryRunResult =
  | {
      status: "DRY_RUN_OK";
      writePlan: WritePlan;
      mutationsExecuted: 0;
      targetHost: string;
    }
  | {
      status: "BLOCKED";
      code:
        | "WRONG_HOST"
        | "WRONG_RESTAURANT"
        | "CONTRACT_DRIFT"
        | "CONTRACT_UNKNOWN"
        | "CANARY_BASELINE_CHANGED"
        | "CANARY_PUBLIC_VISIBILITY_RISK"
        | "ACTIVE_NOT_UNCHECKED"
        | "INVALID_WRITE_PLAN";
      message: string;
      mutationsExecuted: 0;
      writePlan: WritePlan | null;
    };

export function runInactiveProductDryRun(
  input: DryRunPreflightInput,
): DryRunResult {
  const lock = assertVeroniTargetLock({
    hostname: input.hostname,
    restaurantName: input.restaurantName,
    ...(input.url !== undefined ? { url: input.url } : {}),
  });

  const plan = createInactiveProductWritePlan({
    runId: input.runId,
    dryRun: true,
    menuNumber: CANARY_NAMES.reservedMenuNumber,
    productName: CANARY_NAMES.product,
    description: CANARY_NAMES.description,
    basePriceOre: 9900,
    categoryDatabaseId: input.selectedCategoryDatabaseId,
    categoryName: input.selectedCategoryName,
    variants: [{ name: "Alm.", priceOre: 0 }],
    ingredients: [CANARY_NAMES.ingredientA, CANARY_NAMES.ingredientB],
  });

  if (!lock.ok) {
    const code = lock.reason.startsWith("wrong_restaurant")
      ? "WRONG_RESTAURANT"
      : "WRONG_HOST";
    return {
      status: "BLOCKED",
      code,
      message: lock.reason,
      mutationsExecuted: 0,
      writePlan: plan,
    };
  }

  if (input.contractStatus === "UNKNOWN") {
    return {
      status: "BLOCKED",
      code: "CONTRACT_UNKNOWN",
      message: "Admin contract probe returned UNKNOWN",
      mutationsExecuted: 0,
      writePlan: plan,
    };
  }
  if (input.contractStatus === "CONTRACT_DRIFT") {
    return {
      status: "BLOCKED",
      code: "CONTRACT_DRIFT",
      message: "Admin contract probe returned CONTRACT_DRIFT",
      mutationsExecuted: 0,
      writePlan: plan,
    };
  }

  const baseline = evaluateEmptyProductBaseline({
    productCount: input.productCount,
    categoryCount: input.categoryCount,
    ...(input.productNames !== undefined
      ? { productNames: input.productNames }
      : {}),
  });
  if (!baseline.ok) {
    return {
      status: "BLOCKED",
      code: "CANARY_BASELINE_CHANGED",
      message: `Expected 0 products; found ${baseline.productCount}`,
      mutationsExecuted: 0,
      writePlan: plan,
    };
  }

  if (!input.inactiveUncheckProtocolAuthorized) {
    return {
      status: "BLOCKED",
      code: "CANARY_PUBLIC_VISIBILITY_RISK",
      message: "Inactive uncheck protocol not authorized",
      mutationsExecuted: 0,
      writePlan: plan,
    };
  }

  if (!input.activeCurrentlyUnchecked) {
    return {
      status: "BLOCKED",
      code: "ACTIVE_NOT_UNCHECKED",
      message: "#active must be unchecked before dry-run OK / submit",
      mutationsExecuted: 0,
      writePlan: plan,
    };
  }

  try {
    assertWritePlanExactlyOneCreateProduct(plan);
  } catch (e) {
    return {
      status: "BLOCKED",
      code: "INVALID_WRITE_PLAN",
      message: e instanceof Error ? e.message : String(e),
      mutationsExecuted: 0,
      writePlan: plan,
    };
  }

  return {
    status: "DRY_RUN_OK",
    writePlan: plan,
    mutationsExecuted: 0,
    targetHost: lock.host,
  };
}

/** @deprecated use runInactiveProductDryRun */
export function runCanaryDryRun(input: {
  hostname: string;
  restaurantName: string;
  url?: string;
  productCount: number;
  productNames?: string[];
  categoryCount: number;
  contractStatus: ContractStatus;
  activeDefaultChecked: boolean | null;
  runId: string;
}): DryRunResult {
  return runInactiveProductDryRun({
    ...input,
    inactiveUncheckProtocolAuthorized: input.activeDefaultChecked === false,
    activeCurrentlyUnchecked: input.activeDefaultChecked === false,
    selectedCategoryDatabaseId: "1",
    selectedCategoryName: "Pizza",
  });
}

export function executeCanaryWritePlan(_input: {
  plan: WritePlan;
  activeDefaultChecked: boolean | null;
}): never {
  throw new Error(
    "ADMIN_WRITE_BLOCKED: use scripts/m3-veroni-inactive-canary.ts for gated live execution",
  );
}
