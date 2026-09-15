/**
 * @deprecated Reconcile writes no longer require a separate confirm gate.
 * Kept for API compatibility; always allows.
 */
import { join } from "node:path";

/** @deprecated unused */
export function reconcileWriteConfirmPath(rootDir: string): string {
  return join(rootDir, "runs", "decisions", "reconcile-write-confirm.json");
}

export function isReconcileWriteConfirmed(_input: {
  restaurantKey: string;
  fingerprint: string;
  env?: NodeJS.ProcessEnv;
  rootDir?: string;
}): { ok: true; blockers: string[] } {
  return { ok: true, blockers: [] };
}

export function assertReconcileWriteConfirmed(input: {
  restaurantKey: string;
  fingerprint: string;
  env?: NodeJS.ProcessEnv;
  rootDir?: string;
}): void {
  void input;
}
