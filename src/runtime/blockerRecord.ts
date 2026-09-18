export const BLOCKER_CLASSIFICATIONS = [
  "TRANSIENT_NETWORK",
  "DESTINATION_502_503_504",
  "DESTINATION_APPLICATION_500",
  "DESTINATION_VALIDATION_4XX",
  "AUTH_SESSION_EXPIRED",
  "AUTH_CREDENTIALS_REJECTED",
  "BROWSER_RUNTIME_UNAVAILABLE",
  "DESTINATION_CONTRACT_DRIFT",
  "DESTINATION_STATE_CHANGED",
  "CAPABILITY_UNCERTIFIED",
  "SEMANTIC_REVIEW_REQUIRED",
  "APPROVAL_REQUIRED",
  "PARTIAL_WRITE",
  "PERSISTENCE_FAILURE",
  "WORKER_LEASE_EXPIRED",
  "DESTINATION_WRITE_LOCKED",
  "SNAPSHOT_TRUNCATED",
  "STALE_EXECUTION_BUNDLE",
  "UNKNOWN_BLOCKER",
] as const;

export type BlockerClassification = (typeof BLOCKER_CLASSIFICATIONS)[number];

export type BlockerRecordV1 = {
  blockerId: string;
  runId: string;
  operationId: string | null;
  classification: BlockerClassification;
  scope: "operation" | "capability" | "destination" | "run" | "worker";
  severity: "info" | "warning" | "error" | "fatal";
  fingerprint: string;
  endpoint: string | null;
  httpStatus: number | null;
  adapterVersion: string;
  contractFingerprint: string;
  productionSha: string;
  destinationHost: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  safeAutomaticAction: "none" | "retry" | "reauth" | "circuit_break" | "resume";
  retryPolicy: RetryPolicyName;
  requiresHuman: boolean;
  evidenceArtifacts: string[];
};

export type RetryPolicyName =
  | "none"
  | "bounded_exponential"
  | "read_before_retry"
  | "reauth_once"
  | "circuit_break";

export function retryPolicyFor(
  classification: BlockerClassification,
): {
  policy: RetryPolicyName;
  maxAttempts: number;
  safeAutomaticAction: BlockerRecordV1["safeAutomaticAction"];
  requiresHuman: boolean;
} {
  switch (classification) {
    case "TRANSIENT_NETWORK":
      return {
        policy: "bounded_exponential",
        maxAttempts: 3,
        safeAutomaticAction: "retry",
        requiresHuman: false,
      };
    case "DESTINATION_502_503_504":
      return {
        policy: "read_before_retry",
        maxAttempts: 3,
        safeAutomaticAction: "retry",
        requiresHuman: false,
      };
    case "AUTH_SESSION_EXPIRED":
      return {
        policy: "reauth_once",
        maxAttempts: 1,
        safeAutomaticAction: "reauth",
        requiresHuman: false,
      };
    case "DESTINATION_APPLICATION_500":
      return {
        policy: "circuit_break",
        maxAttempts: 0,
        safeAutomaticAction: "circuit_break",
        requiresHuman: true,
      };
    case "DESTINATION_VALIDATION_4XX":
    case "DESTINATION_CONTRACT_DRIFT":
    case "CAPABILITY_UNCERTIFIED":
    case "SEMANTIC_REVIEW_REQUIRED":
    case "APPROVAL_REQUIRED":
    case "STALE_EXECUTION_BUNDLE":
    case "AUTH_CREDENTIALS_REJECTED":
    case "BROWSER_RUNTIME_UNAVAILABLE":
    case "SNAPSHOT_TRUNCATED":
    case "DESTINATION_WRITE_LOCKED":
    case "DESTINATION_STATE_CHANGED":
      return {
        policy: "none",
        maxAttempts: 0,
        safeAutomaticAction: "none",
        requiresHuman: true,
      };
    default:
      return {
        policy: "none",
        maxAttempts: 0,
        safeAutomaticAction: "none",
        requiresHuman: true,
      };
  }
}

export function classifyHttpStatus(status: number): BlockerClassification {
  if (status === 419 || status === 401) return "AUTH_SESSION_EXPIRED";
  if (status === 403) return "AUTH_CREDENTIALS_REJECTED";
  if (status === 502 || status === 503 || status === 504) {
    return "DESTINATION_502_503_504";
  }
  if (status >= 500) return "DESTINATION_APPLICATION_500";
  if (status === 400 || status === 409 || status === 422) {
    return "DESTINATION_VALIDATION_4XX";
  }
  if (status < 0 || status === 0) return "TRANSIENT_NETWORK";
  return "UNKNOWN_BLOCKER";
}
