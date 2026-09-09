import { z } from "zod";

export const ValidationStatusSchema = z.enum([
  "READY",
  "WARNING",
  "MANUAL_REVIEW_REQUIRED",
  "BLOCKED",
]);

export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

const STATUS_RANK: Record<ValidationStatus, number> = {
  READY: 0,
  WARNING: 1,
  MANUAL_REVIEW_REQUIRED: 2,
  BLOCKED: 3,
};

/**
 * Central status aggregation.
 * Precedence: BLOCKED > MANUAL_REVIEW_REQUIRED > WARNING > READY
 */
export function aggregateStatus(
  statuses: readonly ValidationStatus[],
): ValidationStatus {
  if (statuses.length === 0) {
    return "READY";
  }
  let worst: ValidationStatus = "READY";
  for (const status of statuses) {
    if (STATUS_RANK[status] > STATUS_RANK[worst]) {
      worst = status;
    }
  }
  return worst;
}

export function severityForStatus(status: ValidationStatus): ValidationStatus {
  return status;
}
