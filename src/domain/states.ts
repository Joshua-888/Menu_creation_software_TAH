export const MigrationEntityState = [
  "DISCOVERED",
  "EXTRACTED",
  "NORMALIZED",
  "VALIDATED",
  "APPROVED",
  "PENDING_WRITE",
  "WRITTEN",
  "READ_BACK",
  "VERIFIED",
  "MANUAL_REVIEW",
  "BLOCKED",
  "WRITE_FAILED",
  "VERIFY_FAILED",
] as const;

export type MigrationEntityState = (typeof MigrationEntityState)[number];
