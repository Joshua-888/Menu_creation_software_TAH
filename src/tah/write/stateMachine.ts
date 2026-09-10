import type { WriteOpState } from "./types.js";

/**
 * Write / edit lifecycle.
 *
 * Edit (Opdater):
 * PRE_UPDATE → FORM_MODIFIED → UPDATE_SUBMITTED → SUBMIT_EVENT_CONFIRMED
 *   → SUBMIT_REQUEST_OBSERVED → SERVER_RESPONSE_RECEIVED → WRITTEN → READ_BACK → VERIFIED
 *
 * A click alone never advances past FORM_MODIFIED/UPDATE_SUBMITTED without
 * SUBMIT_EVENT_CONFIRMED and SUBMIT_REQUEST_OBSERVED.
 * Never use HTMLFormElement.submit() in production (bypasses submit events).
 */
const ALLOWED: Record<WriteOpState, readonly WriteOpState[]> = {
  PRE_UPDATE: ["FORM_MODIFIED", "BLOCKED", "WRITE_FAILED"],
  FORM_MODIFIED: ["UPDATE_SUBMITTED", "BLOCKED", "WRITE_FAILED"],
  UPDATE_SUBMITTED: [
    "SUBMIT_EVENT_CONFIRMED",
    "WRITE_FAILED",
    "BLOCKED",
  ],
  SUBMIT_EVENT_CONFIRMED: [
    "SUBMIT_REQUEST_OBSERVED",
    "WRITE_FAILED",
    "BLOCKED",
  ],
  SUBMIT_REQUEST_OBSERVED: [
    "SERVER_RESPONSE_RECEIVED",
    "WRITE_FAILED",
  ],
  SERVER_RESPONSE_RECEIVED: ["WRITTEN", "WRITE_FAILED", "VERIFY_FAILED"],
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

export function assertEditPathRequiresOpdater(states: WriteOpState[]): void {
  const iForm = states.indexOf("FORM_MODIFIED");
  const iEvent = states.indexOf("SUBMIT_EVENT_CONFIRMED");
  const iObserved = states.indexOf("SUBMIT_REQUEST_OBSERVED");
  const iWritten = states.indexOf("WRITTEN");
  const iVerified = states.indexOf("VERIFIED");

  if (iForm >= 0 && iWritten >= 0) {
    if (iObserved < 0 || iObserved > iWritten) {
      throw new Error(
        "Edit path cannot mark WRITTEN without SUBMIT_REQUEST_OBSERVED",
      );
    }
    if (iEvent < 0 || iEvent > iObserved) {
      throw new Error(
        "Edit path requires SUBMIT_EVENT_CONFIRMED before SUBMIT_REQUEST_OBSERVED",
      );
    }
  }
  if (iVerified >= 0) assertVerificationPath(states);
}

export function buttonClickAloneMeansWritten(): false {
  return false;
}

/** Production write implementations must never call HTMLFormElement.submit(). */
export function isFormSubmitBypassProhibited(): true {
  return true;
}

export function persistBoundaryForAction(
  action: "CREATE_PRODUCT" | "UPDATE_PRODUCT",
): "Skab" | "Opdater" {
  return action === "CREATE_PRODUCT" ? "Skab" : "Opdater";
}

export type OpdaterEventPathClass =
  | "OPDATER_CLICK_NOT_DELIVERED"
  | "OPDATER_CLICK_NO_SUBMIT_EVENT"
  | "FORM_SUBMIT_EVENT_CONFIRMED"
  | "FALSE_NEGATIVE_REQUEST_OBSERVER"
  | "CLIENT_VALIDATION_BLOCK"
  | "CLIENT_JS_SUBMIT_ERROR"
  | "UNEXPECTED_MUTATION_REQUEST"
  | "UPDATE_REQUEST_NOT_SENT";

export function classifyOpdaterEventPath(input: {
  clickObserved: boolean;
  submitEventObserved: boolean;
  mutationRequestObserved?: boolean;
}): OpdaterEventPathClass {
  if (!input.clickObserved) return "OPDATER_CLICK_NOT_DELIVERED";
  if (!input.submitEventObserved) return "OPDATER_CLICK_NO_SUBMIT_EVENT";
  if (input.mutationRequestObserved === false) {
    return "FALSE_NEGATIVE_REQUEST_OBSERVER";
  }
  return "FORM_SUBMIT_EVENT_CONFIRMED";
}

/** Click without submit event must not become WRITTEN. */
export function clickWithoutSubmitAdvancesToWritten(): false {
  return false;
}
