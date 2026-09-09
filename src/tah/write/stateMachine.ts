import type { WriteOpState } from "./types.js";

/**
 * Write / edit lifecycle transitions.
 *
 * Create path (Skab persist boundary):
 *   PENDING_WRITE → WRITTEN → READ_BACK → VERIFIED
 *
 * Edit path (Opdater persist boundary) — HUMAN_CONFIRMED:
 *   PRE_UPDATE → FORM_MODIFIED → UPDATE_SUBMITTED → WRITTEN → READ_BACK → VERIFIED
 *
 * FORM_MODIFIED is never WRITTEN. Opdater submit is required before WRITTEN.
 */
const ALLOWED: Record<WriteOpState, readonly WriteOpState[]> = {
  PRE_UPDATE: ["FORM_MODIFIED", "BLOCKED", "WRITE_FAILED"],
  FORM_MODIFIED: ["UPDATE_SUBMITTED", "BLOCKED", "WRITE_FAILED"],
  UPDATE_SUBMITTED: ["WRITTEN", "WRITE_FAILED"],
  PENDING_WRITE: ["WRITTEN", "WRITE_FAILED", "BLOCKED"],
  WRITTEN: ["READ_BACK", "WRITE_FAILED", "VERIFY_FAILED"],
  READ_BACK: ["VERIFIED", "VERIFY_FAILED"],
  VERIFIED: [],
  WRITE_FAILED: [],
  VERIFY_FAILED: [],
  BLOCKED: [],
};

export function canTransition(
  from: WriteOpState,
  to: WriteOpState,
): boolean {
  return ALLOWED[from].includes(to);
}

export function transitionWriteState(
  from: WriteOpState,
  to: WriteOpState,
): WriteOpState {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid write state transition ${from} -> ${to}`);
  }
  return to;
}

/** Never skip WRITTEN → READ_BACK → VERIFIED */
export function assertVerificationPath(states: WriteOpState[]): void {
  const iWritten = states.indexOf("WRITTEN");
  const iRead = states.indexOf("READ_BACK");
  const iVerified = states.indexOf("VERIFIED");
  if (iVerified >= 0) {
    if (iWritten < 0 || iRead < 0 || !(iWritten < iRead && iRead < iVerified)) {
      throw new Error(
        "Verification path must be WRITTEN -> READ_BACK -> VERIFIED without skips",
      );
    }
  }
}

/**
 * Edit lifecycle: form modification without Opdater cannot reach WRITTEN/VERIFIED.
 */
export function assertEditPathRequiresOpdater(states: WriteOpState[]): void {
  const iForm = states.indexOf("FORM_MODIFIED");
  const iSubmit = states.indexOf("UPDATE_SUBMITTED");
  const iWritten = states.indexOf("WRITTEN");
  const iVerified = states.indexOf("VERIFIED");

  if (iForm >= 0 && iWritten >= 0 && (iSubmit < 0 || iSubmit > iWritten)) {
    throw new Error(
      "Edit path cannot mark WRITTEN without UPDATE_SUBMITTED (Opdater) after FORM_MODIFIED",
    );
  }
  if (iVerified >= 0) {
    if (iSubmit < 0 && iForm >= 0) {
      throw new Error(
        "Visibility/edit VERIFIED requires Opdater (UPDATE_SUBMITTED) after FORM_MODIFIED",
      );
    }
    assertVerificationPath(states);
  }
}

/** Create uses Skab; edit uses Opdater — do not mix persist boundaries. */
export function persistBoundaryForAction(
  action: "CREATE_PRODUCT" | "UPDATE_PRODUCT",
): "Skab" | "Opdater" {
  return action === "CREATE_PRODUCT" ? "Skab" : "Opdater";
}
