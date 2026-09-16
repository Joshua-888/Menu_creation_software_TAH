export type WriteEntityType = "category" | "product";

export type WriteAction =
  | "CREATE_CATEGORY"
  | "CREATE_PRODUCT"
  | "UPDATE_PRODUCT"
  | "DELETE_PRODUCT"
  | "DELETE_CATEGORY";

export type WriteOpState =
  | "PRE_UPDATE"
  | "FORM_MODIFIED"
  | "UPDATE_SUBMITTED"
  | "SUBMIT_EVENT_CONFIRMED"
  | "SUBMIT_REQUEST_OBSERVED"
  | "SERVER_RESPONSE_RECEIVED"
  | "PENDING_WRITE"
  | "WRITTEN"
  | "READ_BACK"
  | "VERIFIED"
  | "WRITE_FAILED"
  | "VERIFY_FAILED"
  | "BLOCKED";

export type WritePlanOperation = {
  operationId: string;
  entityType: WriteEntityType;
  action: WriteAction;
  expectedBefore: Record<string, unknown>;
  expectedAfter: Record<string, unknown>;
  verification: string[];
  state: WriteOpState;
};

export type CanaryWritePlan = {
  planId: string;
  runId: string;
  targetHost: string;
  restaurantName: string;
  contractVersion: string;
  adapterVersion: string;
  dryRun: boolean;
  immutable: true;
  createdAt: string;
  operations: readonly WritePlanOperation[];
  notes: readonly string[];
};

export type WritePlan = CanaryWritePlan;

export type TargetLockResult =
  | { ok: true; host: string; restaurantName: string }
  | { ok: false; reason: string; host?: string };

export type ActiveDefaultGateResult =
  | { ok: true; activeDefaultChecked: false }
  | {
      ok: false;
      code: "CANARY_PUBLIC_VISIBILITY_RISK";
      activeDefaultChecked: true;
      message: string;
    };

export type BaselineResult =
  | { ok: true; productCount: 0; categoryCount: number }
  | {
      ok: false;
      code: "CANARY_BASELINE_CHANGED";
      productCount: number;
      productNames: string[];
    };

export const VERONI_CANARY_TARGET = {
  host: "veronipizza.dk",
  restaurantName: "Veroni Pizza",
  baseUrl: "https://veronipizza.dk",
  adminMenuPath: "/admin/menu",
  adminBasePath: "/admin/",
} as const;

export const CANARY_NAMES = {
  /** Not used in M3 resume — category create out of scope */
  category: "__TAH_CANARY_M3__",
  /** M6.7 createCategory certification (synthetic only) */
  categoryCreate: "__TAH_CANARY_CATEGORY_M67__",
  /** M80 deleteCategory certification (synthetic only) */
  categoryDelete: "__TAH_CANARY_CATEGORY_DELETE_M80__",
  product: "__TAH_CANARY_PRODUCT_M3__",
  productNonZero: "__TAH_CANARY_VARIANT_M3__",
  productMulti: "__TAH_CANARY_MULTIVARIANT_M3__",
  /** M3 create certification (hidden) */
  productCreate: "__TAH_CANARY_CREATE_M3__",
  productCreateMulti: "__TAH_CANARY_CREATE_MULTI_M3__",
  description: "Automated TakeAwayHero inactive canary test",
  descriptionCreate: "Automated hidden create certification",
  ingredientA: "Test ingredient A",
  ingredientB: "Test ingredient B",
  ingredient: "Test ingredient",
  reservedMenuNumber: "99001",
  reservedMenuNumberNonZero: "99002",
  reservedMenuNumberMulti: "99003",
  reservedMenuNumberCreate: "99011",
  reservedMenuNumberCreateMulti: "99012",
  productAdditions: "__TAH_CANARY_ADDITIONS_M3__",
  descriptionAdditions: "Automated hidden additions certification",
  reservedMenuNumberAdditions: "99013",
} as const;
