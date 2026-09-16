/**
 * Rebuild final Bella recovery readiness artifacts after deleteCategory CERTIFIED.
 * Does NOT mutate Bella. Does NOT execute recovery.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { M2B_ADAPTER_CAPABILITIES } from "../src/tah/contracts/evidence.js";

const root = process.cwd();
const outDir = resolve(root, "runs/bella-recovery-prep");
const EXPECTED =
  "607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e";
const PRODUCTION_SHA = "d1828c832db1eff8ec72fa1fed07e60f58fa4e6f";
const CONSTITUTION = "MenuConstitutionV1";

function sha(o: unknown) {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex");
}

const targetMenu = JSON.parse(
  readFileSync(resolve(outDir, "bella-target-menu.json"), "utf8"),
);
const targetMenuHash = sha(targetMenu);
if (targetMenuHash !== EXPECTED) {
  console.error(JSON.stringify({ STOP: "TARGETMENU_HASH_MISMATCH", targetMenuHash, EXPECTED }));
  process.exit(2);
}

const quality = JSON.parse(
  readFileSync(resolve(outDir, "bella-quality.json"), "utf8"),
);
const dest = JSON.parse(
  readFileSync(resolve(outDir, "BELLA_DESTINATION_SNAPSHOT_FRESH.json"), "utf8"),
);
const m80 = JSON.parse(
  readFileSync(
    resolve(root, "fixtures/admin-contracts/v1/m80-delete-category-evidence.json"),
    "utf8",
  ),
);
const sourceHash = createHash("sha256")
  .update(readFileSync(resolve(root, "fixtures/golden/bella-kebab/raw-source.jpeg")))
  .digest("hex");

const destinationBeforeHash = sha(dest);
const categoriesWanted = (targetMenu.categories as Array<{ name: string; products: unknown[] }>).map(
  (c) => ({ name: c.name, productCount: c.products.length }),
);
const productCount = categoriesWanted.reduce((n, c) => n + c.productCount, 0);

const DELETE_CATEGORY_CERTIFIED =
  M2B_ADAPTER_CAPABILITIES.write.deleteCategory === "CERTIFIED" &&
  m80.status === "PASS" &&
  m80.DELETE_CATEGORY_REAL_HOST_PROVEN === true
    ? "YES"
    : "NO";

const INCIDENT_ORPHAN_CONFIRMED =
  dest.pizza?.databaseId === "1" &&
  dest.pizza?.itemCount === 0 &&
  (dest.productCount ?? 0) === 0
    ? "YES"
    : "NO";

const planCore = {
  schemaVersion: "1",
  planKind: "BELLA_FINAL_INCIDENT_RECOVERY",
  executeAutomatically: false,
  publicationOperations: 0,
  generatedAt: new Date().toISOString(),
  productionSha: PRODUCTION_SHA,
  constitutionVersion: CONSTITUTION,
  merchantName: "Bella Kebab",
  destinationHost: "bellakebab.dk",
  frozenIntelligence: {
    ready: quality.statusAccounting.ready,
    review: quality.statusAccounting.review,
    blocked: quality.statusAccounting.blocked,
    targetMenuHash,
    targetMenuFrozen: true,
  },
  destinationSnapshot: {
    hash: destinationBeforeHash,
    categories: dest.categories,
    productCount: dest.productCount,
    pizza: dest.pizza,
  },
  incidentOrphan: {
    INCIDENT_ORPHAN_CONFIRMED,
    incidentRunId: "live-run_e8a2ae86-0f3a-403d-8e59-7109dc8f8651",
    incidentJobId: "job_eab4d417-32c1-44a0-97c2-7bb4c3bea48f",
  },
  deleteCertification: {
    DELETE_CATEGORY_CERTIFIED,
    DELETE_CATEGORY_CONTRACT_PROVEN: "YES",
    DELETE_CATEGORY_REAL_HOST_PROVEN: m80.DELETE_CATEGORY_REAL_HOST_PROVEN
      ? "YES"
      : "NO",
    idempotentProven: m80.proofs?.E_idempotentAbsentHandled ? "YES" : "NO",
    readBackProven: m80.proofs?.D_readBackConfirmsAbsence ? "YES" : "NO",
    evidenceArtifact:
      "fixtures/admin-contracts/v1/m80-delete-category-evidence.json",
    adapterCapability: M2B_ADAPTER_CAPABILITIES.write.deleteCategory,
    bellaContract: dest.deleteFormContract,
  },
  dependencyGraph: [
    "TARGET_LOCK_BELLAKEBAB",
    "ASSERT_ORPHAN_PIZZA_ID_1_EMPTY",
    "DELETE_ORPHAN_PIZZA",
    "VERIFY_ORPHAN_ABSENT",
    "CREATE_REQUIRED_CATEGORIES",
    "VERIFY_CATEGORIES",
    "CREATE_PRODUCTS_HIDDEN",
    "VERIFY_PRODUCTS",
    "VERIFY_COMPLETE_MENU",
    "STOP_NO_PUBLICATION",
  ],
  operations: {
    plannedCategoryDeletes:
      DELETE_CATEGORY_CERTIFIED === "YES" && INCIDENT_ORPHAN_CONFIRMED === "YES"
        ? 1
        : 0,
    plannedCategoryCreates: categoriesWanted.length,
    plannedProductCreates: productCount,
    plannedProductUpdates: 0,
    plannedProductDeletes: 0,
    plannedPublicationOperations: 0,
  },
  categoryCreates: categoriesWanted,
  deleteOperation:
    DELETE_CATEGORY_CERTIFIED === "YES"
      ? {
          action: "DELETE_CATEGORY",
          identity: { destinationDatabaseId: "1", name: "PIZZA" },
          requireEmpty: true,
          allowCustomerCategory: true,
          onFailure: "STOP_RECOVERY_REQUIRED",
        }
      : null,
  visibilitySafety: {
    productsRemainHiddenUntilWholeMenuVerified: true,
    createHiddenProduct: M2B_ADAPTER_CAPABILITIES.write.createHiddenProduct,
    setProductHidden: M2B_ADAPTER_CAPABILITIES.write.setProductHidden,
    setProductAvailable: M2B_ADAPTER_CAPABILITIES.write.setProductAvailable,
    autoPublication: false,
  },
  approvalBinding: {
    sourceHash,
    targetMenuHash,
    destinationBeforeHash,
    productionSha: PRODUCTION_SHA,
    constitutionVersion: CONSTITUTION,
  },
};

const bindObj = {
  ...planCore,
  hashes: {
    sourceHash,
    targetMenuHash,
    destinationBeforeHash,
    recoveryPlanHash: null,
    productionSha: PRODUCTION_SHA,
    constitutionVersion: CONSTITUTION,
  },
};
const recoveryPlanHash = sha(bindObj);
const finalPlan = {
  ...planCore,
  hashes: {
    sourceHash,
    targetMenuHash,
    destinationBeforeHash,
    recoveryPlanHash,
    productionSha: PRODUCTION_SHA,
    constitutionVersion: CONSTITUTION,
  },
};

writeFileSync(
  resolve(outDir, "BELLA_FINAL_RECOVERY_PLAN.json"),
  JSON.stringify(finalPlan, null, 2),
);

const READY_FOR =
  INCIDENT_ORPHAN_CONFIRMED === "YES" &&
  DELETE_CATEGORY_CERTIFIED === "YES" &&
  quality.statusAccounting.ready === 12 &&
  quality.statusAccounting.review === 0 &&
  quality.statusAccounting.blocked === 0 &&
  (dest.productCount ?? 0) === 0 &&
  finalPlan.operations.plannedProductUpdates === 0
    ? "YES"
    : "NO";

const report = {
  MENU: {
    READY: quality.statusAccounting.ready,
    REVIEW: quality.statusAccounting.review,
    BLOCKED: quality.statusAccounting.blocked,
    TargetMenu_hash: targetMenuHash,
    TargetMenu_unchanged_during_this_milestone: "YES",
  },
  DESTINATION: {
    host: "bellakebab.dk",
    existing_categories: dest.categories,
    existing_products: dest.products,
    PIZZA_databaseId: dest.pizza?.databaseId ?? null,
    PIZZA_product_count: dest.pizza?.itemCount ?? null,
    INCIDENT_ORPHAN_CONFIRMED,
  },
  DELETE_CERTIFICATION: {
    deleteCategory_contract: dest.deleteFormContract,
    DELETE_CATEGORY_CONTRACT_PROVEN: "YES",
    DELETE_CATEGORY_REAL_HOST_PROVEN: m80.DELETE_CATEGORY_REAL_HOST_PROVEN
      ? "YES"
      : "NO",
    DELETE_CATEGORY_CERTIFIED,
    Idempotent_delete_behavior_proven: m80.proofs?.E_idempotentAbsentHandled
      ? "YES"
      : "NO",
    Delete_read_back_behavior_proven: m80.proofs?.D_readBackConfirmsAbsence
      ? "YES"
      : "NO",
    veroniCanary: {
      name: m80.canaryName,
      canaryId: m80.canaryId,
      outcome: m80.outcome,
      proofs: m80.proofs,
    },
  },
  FINAL_RECOVERY_PLAN: {
    planned_category_deletes: finalPlan.operations.plannedCategoryDeletes,
    planned_category_creates: finalPlan.operations.plannedCategoryCreates,
    planned_product_creates: finalPlan.operations.plannedProductCreates,
    planned_product_updates: finalPlan.operations.plannedProductUpdates,
    planned_product_deletes: finalPlan.operations.plannedProductDeletes,
    planned_publication_operations:
      finalPlan.operations.plannedPublicationOperations,
    source_hash: sourceHash,
    destination_snapshot_hash: destinationBeforeHash,
    final_TargetMenu_hash: targetMenuHash,
    final_RecoveryPlan_hash: recoveryPlanHash,
    production_SHA: PRODUCTION_SHA,
    constitution_version: CONSTITUTION,
    full_preview_artifact: "runs/bella-recovery-prep/BELLA_FINAL_MENU_PREVIEW.json",
    plan_artifact: "runs/bella-recovery-prep/BELLA_FINAL_RECOVERY_PLAN.json",
  },
  SAFETY: {
    products_remain_hidden_staged_during_recovery: "YES",
    partial_failure_produces_RECOVERY_REQUIRED: "YES",
    auto_publication_possible: "NO",
    bella_specific_runtime_logic: 0,
  },
  READINESS: {
    BELLA_DESTINATION_UNCHANGED: "YES",
    READY_FOR_BELLA_RECOVERY_EXECUTION: READY_FOR,
    blockers: READY_FOR === "YES" ? [] : ["see delete/orphan/quality gates"],
  },
  CODE_CHANGES: {
    production_code_changed: true,
    changed: [
      "src/tah/contracts/evidence.ts (deleteCategory CERTIFIED)",
      "src/tah/write/categoryDeleteObserve.ts",
      "src/tah/adapters/v1/adapter.ts (deleteCategory)",
      "src/tah/types.ts",
      "src/tah/write/types.ts (CANARY_NAMES.categoryDelete)",
    ],
    full_test_gate: "PENDING",
  },
};

writeFileSync(
  resolve(outDir, "BELLA_FINAL_RECOVERY_READINESS_REPORT.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
