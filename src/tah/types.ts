import type { CanonicalMenu, CanonicalProduct } from "../domain/schema/canonical.js";

export type AdminAdapterLifecycle =
  | "DEVELOPMENT"
  | "TESTED"
  | "CERTIFIED"
  | "DEPRECATED";

export type ContractProbeResult =
  | { status: "CONTRACT_MATCH"; contractVersion: string; details: string[] }
  | {
      status: "ADMIN_CONTRACT_DRIFT";
      expectedVersion: string | null;
      detectedVersion: string | null;
      mismatches: string[];
    };

export interface AdminContract {
  version: string;
  requiredTestIds: readonly string[];
}

export type WritePlanAction =
  | { op: "CREATE_CATEGORY"; categorySourceId: string; name: string }
  | {
      op: "CREATE_PRODUCT";
      productSourceId: string;
      expected: CanonicalProduct;
    }
  | {
      op: "UPDATE_PRODUCT";
      productSourceId: string;
      destinationEntityId: string;
      expected: CanonicalProduct;
      reason: string;
    }
  | {
      op: "SKIP_PRODUCT";
      productSourceId: string;
      reason: string;
    }
  | {
      op: "MANUAL_REVIEW";
      productSourceId: string;
      reason: string;
    }
  | {
      op: "BLOCK";
      productSourceId?: string;
      reason: string;
    };

export interface WritePlan {
  planId: string;
  menu: CanonicalMenu;
  adminContractVersion: string;
  adminAdapterVersion: string;
  dryRun: boolean;
  actions: WritePlanAction[];
  createdAt: string;
  immutable: true;
}

export interface TahAdminAdapter {
  version: string;
  lifecycle: AdminAdapterLifecycle;
  detectVersion(): Promise<string | null>;
  probeContract(): Promise<ContractProbeResult>;
  listCategories(): Promise<unknown[]>;
  listProducts(): Promise<unknown[]>;
  findProduct(query: {
    menuNumber?: string;
    name?: string;
  }): Promise<unknown | null>;
  createCategory(input: { name: string }): Promise<{ destinationId: string }>;
  createProduct(input: CanonicalProduct): Promise<{ destinationId: string }>;
  updateProduct(
    destinationId: string,
    input: CanonicalProduct,
  ): Promise<{ destinationId: string }>;
  readProduct(destinationId: string): Promise<unknown>;
  verifyProduct(
    expected: CanonicalProduct,
    actual: unknown,
  ): Promise<{ ok: boolean; diff?: unknown }>;
}
