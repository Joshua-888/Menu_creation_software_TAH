import type { TahCreateErrorSignature } from "../tah/write/createErrorClassify.js";
import {
  isDeterministicCreateRejection,
} from "../tah/write/createErrorClassify.js";
import type { WritePlanOperation } from "./writePlan.js";

export type CreateCircuitBreakerState = {
  signature: string | null;
  count: number;
  tripped: boolean;
  classifiedClass: string | null;
};

export const CIRCUIT_BREAKER_REASON =
  "CIRCUIT_BREAKER_DETERMINISTIC_CREATE_REJECTION";

export const NOT_ATTEMPTED_SYSTEMIC_BLOCK = "NOT_ATTEMPTED_SYSTEMIC_BLOCK";

export function emptyCreateCircuitBreaker(): CreateCircuitBreakerState {
  return {
    signature: null,
    count: 0,
    tripped: false,
    classifiedClass: null,
  };
}

/**
 * Deterministic TAH CREATE rejections must not fan out across the rest of the menu.
 * Trip after the first confirmed identical deterministic signature.
 */
export function recordCreateCircuitFailure(
  state: CreateCircuitBreakerState,
  classified: TahCreateErrorSignature,
): CreateCircuitBreakerState {
  if (!isDeterministicCreateRejection(classified)) return state;
  if (state.signature && state.signature !== classified.signature) {
    return {
      signature: classified.signature,
      count: 1,
      tripped: false,
      classifiedClass: classified.class,
    };
  }
  const count = (state.signature === classified.signature ? state.count : 0) + 1;
  return {
    signature: classified.signature,
    count,
    tripped: count >= 1,
    classifiedClass: classified.class,
  };
}

export function shouldBlockRemainingCreates(
  state: CreateCircuitBreakerState,
): boolean {
  return state.tripped;
}

export function circuitBreakerMessage(state: CreateCircuitBreakerState): string {
  return `${NOT_ATTEMPTED_SYSTEMIC_BLOCK} ${CIRCUIT_BREAKER_REASON} signature=${state.signature ?? "unknown"} class=${state.classifiedClass ?? "unknown"} repeats=${state.count}`;
}

export function isFurtherPublicCategoryCreate(op: WritePlanOperation): boolean {
  return op.entityType === "category" && op.action === "CREATE";
}

export function isProductCreate(op: WritePlanOperation): boolean {
  return op.entityType === "product" && op.action === "CREATE";
}
