import type { JobStatus } from "../../../../../src/portal/types.js";

/**
 * Pure presentation logic for the execution stepper, result tiles and failure
 * badges. Like `src/portal/menuView.ts`, this module owns only display
 * decisions: it never recomputes menu semantics or mutates the destination.
 * Keeping it free of React lets the node-only test suite cover the mapping.
 */

export type ExecutionBadgeTone = "ok" | "warn" | "danger" | "neutral";

export type ExecutionStageId =
  | "PREPARING"
  | "APPROVED"
  | "EXECUTING"
  | "VERIFYING"
  | "VERIFIED";

export type ExecutionStageState = "done" | "current" | "failed" | "pending";

export type ExecutionStageView = {
  id: ExecutionStageId;
  label: string;
  state: ExecutionStageState;
};

const STAGE_ORDER: readonly ExecutionStageId[] = [
  "PREPARING",
  "APPROVED",
  "EXECUTING",
  "VERIFYING",
  "VERIFIED",
];

const STAGE_LABELS: Record<ExecutionStageId, string> = {
  PREPARING: "Preparing",
  APPROVED: "Approved",
  EXECUTING: "Executing",
  VERIFYING: "Verifying",
  VERIFIED: "Verified",
};

/** Read-only projection of the persisted live-execute-result.json artifact. */
export type LiveExecuteResultView = {
  status?: string | null;
  processed?: number | null;
  verified?: number | null;
  failed?: number | null;
  blocked?: number | null;
  duplicatesCreated?: number | null;
  categoriesVerified?: number | null;
  categoriesFailed?: number | null;
  productsVerified?: number | null;
  productsFailed?: number | null;
  expectedProducts?: number | null;
  menuVerified?: boolean | null;
  recoveryRequired?: boolean | null;
  circuitBreakerTripped?: boolean | null;
  createErrorSignature?: string | null;
};

/** True when the result evidence shows the menu did not fully verify. */
export function isVerificationFailure(
  result: LiveExecuteResultView | null,
): boolean {
  if (!result) return false;
  if (result.recoveryRequired === true) return true;
  if (result.status === "PARTIAL_WRITE") return true;
  if (result.status === "LIVE_EXECUTION_FAILED") return true;
  if (result.status === "COMPLETED_WITH_ERRORS") return true;
  if (result.menuVerified === false) return true;
  if ((result.productsFailed ?? 0) > 0) return true;
  if ((result.categoriesFailed ?? 0) > 0) return true;
  return false;
}

/**
 * Map job status + live result onto the five execution stages. Display only:
 * a stage is `done`, `current`, `failed` or `pending`, never a business claim.
 */
export function deriveExecutionStages(
  status: JobStatus,
  result: LiveExecuteResultView | null,
): ExecutionStageView[] {
  const states: Record<ExecutionStageId, ExecutionStageState> = {
    PREPARING: "pending",
    APPROVED: "pending",
    EXECUTING: "pending",
    VERIFYING: "pending",
    VERIFIED: "pending",
  };
  const doneThrough = (id: ExecutionStageId): void => {
    for (const stage of STAGE_ORDER) {
      states[stage] = "done";
      if (stage === id) break;
    }
  };

  switch (status) {
    case "DRAFT":
    case "QUEUED":
    case "EXTRACTING":
    case "SOURCE_URL_PENDING":
    case "DOMAIN":
    case "DECISIONS":
    case "ARTIFACTS":
    case "AWAITING_REVIEW":
      states.PREPARING = "current";
      break;
    case "AWAITING_OPERATOR_APPROVAL":
    case "READY_DRY_RUN":
      doneThrough("PREPARING");
      states.APPROVED = "current";
      break;
    case "LIVE_EXECUTING":
    case "WRITING":
      doneThrough("APPROVED");
      states.EXECUTING = "current";
      break;
    case "COMPLETED":
      doneThrough("EXECUTING");
      if (isVerificationFailure(result)) {
        states.VERIFYING = "failed";
      } else {
        doneThrough("VERIFIED");
      }
      break;
    case "COMPLETED_WITH_ERRORS":
    case "PARTIAL_WRITE":
    case "RECOVERY_REQUIRED":
      doneThrough("EXECUTING");
      states.VERIFYING = "failed";
      break;
    case "LIVE_EXECUTION_FAILED":
      doneThrough("APPROVED");
      states.EXECUTING = "failed";
      break;
    case "FAILED":
      states.PREPARING = "failed";
      break;
    case "CANCELLED":
      break;
    default:
      states.PREPARING = "current";
      break;
  }

  // Result evidence can exist before the terminal status update lands.
  if (result && states.EXECUTING === "current") {
    if (
      result.recoveryRequired === true ||
      result.status === "LIVE_EXECUTION_FAILED"
    ) {
      states.EXECUTING = "done";
      states.VERIFYING = "failed";
    }
  }

  return STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    state: states[id],
  }));
}

export type FailureKind =
  | "NO_MUTATION"
  | "PARTIAL_MUTATION"
  | "VERIFICATION_MISMATCH"
  | "DESTINATION_LOCKED"
  | "UNSUPPORTED_CAPABILITY"
  | "RECOVERY_REQUIRED";

export type FailureBadge = {
  kind: FailureKind;
  label: string;
  tone: ExecutionBadgeTone;
  detail: string;
};

/**
 * Classify the distinct failure states an operator must be able to tell apart.
 * Classification is deterministic and evidence-based (result fields, job
 * status, error text and recorded missing capabilities) — never a guess.
 */
export function classifyExecutionFailures(input: {
  status: JobStatus;
  result: LiveExecuteResultView | null;
  errorMessage?: string | null;
  missingCapabilities?: readonly string[];
}): FailureBadge[] {
  const { status, result } = input;
  const badges: FailureBadge[] = [];
  const processed = result?.processed ?? 0;
  const failed = result?.failed ?? 0;
  const productsFailed = result?.productsFailed ?? 0;
  const categoriesFailed = result?.categoriesFailed ?? 0;
  const message = input.errorMessage ?? "";

  if (result?.status === "LIVE_EXECUTION_FAILED" && processed === 0) {
    badges.push({
      kind: "NO_MUTATION",
      label: "No mutation",
      tone: "warn",
      detail:
        "Live execution failed before any destination operation was processed. Nothing was written.",
    });
  }
  if (result?.status === "PARTIAL_WRITE") {
    badges.push({
      kind: "PARTIAL_MUTATION",
      label: "Partial mutation",
      tone: "danger",
      detail: `${processed} operation(s) processed, ${failed} failed. The destination was partially mutated.`,
    });
  }
  if (
    result &&
    (result.menuVerified === false || productsFailed > 0 || categoriesFailed > 0)
  ) {
    badges.push({
      kind: "VERIFICATION_MISMATCH",
      label: "Verification mismatch",
      tone: "danger",
      detail: `Read-back did not confirm the intended menu (products failed: ${productsFailed}, categories failed: ${categoriesFailed}).`,
    });
  }
  if (message.includes("DESTINATION_WRITE_LOCKED")) {
    badges.push({
      kind: "DESTINATION_LOCKED",
      label: "Destination locked",
      tone: "warn",
      detail: message,
    });
  }
  const missing = input.missingCapabilities ?? [];
  if (missing.length > 0) {
    badges.push({
      kind: "UNSUPPORTED_CAPABILITY",
      label: "Unsupported capability",
      tone: "warn",
      detail: missing.join(", "),
    });
  }
  if (result?.recoveryRequired === true) {
    badges.push({
      kind: "RECOVERY_REQUIRED",
      label: "Recovery required",
      tone: "danger",
      detail:
        "Destination may be partially mutated. Run recovery; verified objects are reused and nothing is auto-deleted.",
    });
  }
  if (!result && status === "RECOVERY_REQUIRED") {
    badges.push({
      kind: "RECOVERY_REQUIRED",
      label: "Recovery required",
      tone: "danger",
      detail: "Job is in RECOVERY_REQUIRED with no live-execute-result.json.",
    });
  }
  return badges;
}

export type ExecutionMetricTile = { value: string; label: string };

function metric(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "—";
}

/** Stat tiles for the execution result panel. Missing evidence shows "—". */
export function buildExecutionResultTiles(
  result: LiveExecuteResultView | null,
): ExecutionMetricTile[] {
  if (!result) return [];
  return [
    { value: metric(result.verified), label: "Operations verified" },
    { value: metric(result.failed), label: "Operations failed" },
    { value: metric(result.blocked), label: "Not attempted" },
    { value: metric(result.categoriesVerified), label: "Categories verified" },
    { value: metric(result.categoriesFailed), label: "Categories failed" },
    { value: metric(result.productsVerified), label: "Products verified" },
    { value: metric(result.productsFailed), label: "Products failed" },
    { value: metric(result.duplicatesCreated), label: "Duplicates created" },
    {
      value:
        result.menuVerified === true
          ? "YES"
          : result.menuVerified === false
            ? "NO"
            : "—",
      label: "Menu verified",
    },
    {
      value: result.recoveryRequired === true ? "REQUIRED" : "NOT REQUIRED",
      label: "Recovery",
    },
  ];
}
