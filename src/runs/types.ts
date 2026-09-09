import type { ErrorCategory } from "../domain/errors.js";
import type { MigrationEntityState } from "../domain/states.js";

export type RunRecord = {
  runId: string;
  restaurant: string;
  source: string;
  destination: string;
  startTime: string;
  endTime?: string;
  schemaVersion: string;
  extractorVersion?: string;
  domainRulesVersion: string;
  adminAdapterVersion?: string;
  adminContractVersion?: string;
};

export type EntityRunRecord = {
  runId: string;
  entityId: string;
  sourceEntityId: string;
  destinationEntityId?: string;
  expectedPayload?: unknown;
  migrationState: MigrationEntityState;
  attemptCount: number;
  lastError?: { category: ErrorCategory; message: string };
  validationReasons?: string[];
  verificationDiff?: unknown;
  verifiedAt?: string;
};
