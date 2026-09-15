/**
 * Gate live QA Opdater updates. Requires explicit operator confirm matching
 * the menu-reconcile fingerprint.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.js";

export type ReconcileWriteConfirm = {
  confirmed: true;
  restaurantKey: string;
  fingerprint: string;
  confirmedAt: string;
  operatorId?: string;
};

export function reconcileWriteConfirmPath(root = repoRoot()): string {
  return join(root, "runs", "decisions", "reconcile-write-confirm.json");
}

export function isReconcileWriteConfirmed(input: {
  restaurantKey: string;
  fingerprint: string;
  env?: NodeJS.ProcessEnv;
  confirmFilePath?: string | null;
}): {
  ok: boolean;
  blockers: string[];
} {
  const env = input.env ?? process.env;
  const blockers: string[] = [];

  if (
    env.RECONCILE_WRITE_CONFIRMED === "1" ||
    env.RECONCILE_WRITE_CONFIRMED === "true"
  ) {
    const fp = env.RECONCILE_WRITE_FINGERPRINT?.trim();
    if (!fp) {
      blockers.push(
        "RECONCILE_WRITE_CONFIRMED=1 requires RECONCILE_WRITE_FINGERPRINT to match menu-reconcile report",
      );
      return { ok: false, blockers };
    }
    if (fp !== input.fingerprint) {
      blockers.push(
        `RECONCILE_WRITE_FINGERPRINT mismatch (env=${fp} need=${input.fingerprint})`,
      );
      return { ok: false, blockers };
    }
    return { ok: true, blockers: [] };
  }

  const confirmPath =
    input.confirmFilePath ?? reconcileWriteConfirmPath();
  if (existsSync(confirmPath)) {
    try {
      const raw = JSON.parse(
        readFileSync(confirmPath, "utf8"),
      ) as Partial<ReconcileWriteConfirm>;
      if (raw.confirmed !== true) {
        blockers.push("confirm file missing confirmed:true");
      } else if (raw.restaurantKey !== input.restaurantKey) {
        blockers.push(
          `confirm restaurantKey ${raw.restaurantKey} ≠ ${input.restaurantKey}`,
        );
      } else if (raw.fingerprint !== input.fingerprint) {
        blockers.push(
          `confirm fingerprint ${raw.fingerprint} ≠ ${input.fingerprint}`,
        );
      }
      return { ok: blockers.length === 0, blockers };
    } catch (err) {
      blockers.push(
        `confirm file unreadable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, blockers };
    }
  }

  blockers.push(
    "RECONCILE_WRITE_CONFIRMED not set; write confirm file or set RECONCILE_WRITE_CONFIRMED=1",
  );
  return { ok: false, blockers };
}

export function assertReconcileWriteConfirmed(input: {
  restaurantKey: string;
  fingerprint: string;
  env?: NodeJS.ProcessEnv;
  confirmFilePath?: string | null;
}): void {
  const g = isReconcileWriteConfirmed(input);
  if (!g.ok) {
    throw new Error(`RECONCILE_WRITE_BLOCKED: ${g.blockers.join("; ")}`);
  }
}
