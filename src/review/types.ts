import type { ErrorCategory } from "../domain/errors.js";
import type { SourceEvidence } from "../domain/evidence.js";

/**
 * Recorded when a human corrects uncertain/incorrect data.
 * Must not auto-promote to global production rules.
 */
export type CorrectionEvent = {
  runId: string;
  entityId: string;
  field: string;
  originalValue: unknown;
  correctedValue: unknown;
  reason: string;
  errorCategory: ErrorCategory;
  evidence?: SourceEvidence;
  extractorOrRuleOrAdapter?: string;
  timestamp: string;
};
