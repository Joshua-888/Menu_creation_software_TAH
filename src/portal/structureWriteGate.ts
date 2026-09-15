/**
 * Gate live writes that apply peer-learned structure (choices→variants/additions,
 * restaurant Tilbehør fan-out). Requires explicit operator confirm.
 */

import { existsSync, readFileSync } from "node:fs";

export type StructureWriteConfirm = {
  confirmed: true;
  restaurantKey: string;
  fingerprint: string;
  confirmedAt: string;
  operatorId?: string;
};

export function isStructureWriteConfirmed(input: {
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
    env.STRUCTURE_WRITE_CONFIRMED === "1" ||
    env.STRUCTURE_WRITE_CONFIRMED === "true"
  ) {
    const fp = env.STRUCTURE_WRITE_FINGERPRINT?.trim();
    if (!fp) {
      blockers.push(
        "STRUCTURE_WRITE_CONFIRMED=1 requires STRUCTURE_WRITE_FINGERPRINT to match peer summary",
      );
      return { ok: false, blockers };
    }
    if (fp !== input.fingerprint) {
      blockers.push(
        `STRUCTURE_WRITE_FINGERPRINT mismatch (env=${fp} need=${input.fingerprint})`,
      );
      return { ok: false, blockers };
    }
    return { ok: true, blockers: [] };
  }

  if (input.confirmFilePath && existsSync(input.confirmFilePath)) {
    try {
      const raw = JSON.parse(
        readFileSync(input.confirmFilePath, "utf8"),
      ) as Partial<StructureWriteConfirm>;
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
    "STRUCTURE_WRITE_CONFIRMED not set; write confirm file or set STRUCTURE_WRITE_CONFIRMED=1",
  );
  return { ok: false, blockers };
}

export function assertStructureWriteConfirmed(input: {
  restaurantKey: string;
  fingerprint: string;
  env?: NodeJS.ProcessEnv;
  confirmFilePath?: string | null;
}): void {
  const g = isStructureWriteConfirmed(input);
  if (!g.ok) {
    throw new Error(
      `STRUCTURE_WRITE_BLOCKED: ${g.blockers.join("; ")}`,
    );
  }
}
