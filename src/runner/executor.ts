/**
 * M4 migration executor — idempotency, resume, exact verification.
 * Browser adapter is injected; this layer makes no menu-business inventions.
 */

import type { MigrationEntityState } from "../domain/states.js";
import type { RunStore } from "../runs/sqliteStore.js";
import type {
  MigrationWritePlan,
  PlannedProductPayload,
  ProductIdentityKey,
  WritePlanOperation,
} from "./writePlan.js";
import { assertWritePlanImmutable } from "./writePlan.js";

export type DestinationProduct = {
  databaseId: string;
  menuNumber: string;
  name: string;
  description: string;
  basePriceOre: number;
  categoryIds: string[];
  variants: Array<{ name: string; priceOre: number }>;
  ingredients: Array<{ name: string }>;
  additions: Array<{ name: string; priceOre: number }>;
  listStatus: string;
};

export type DestinationPort = {
  findByIdentity(identity: ProductIdentityKey): Promise<DestinationProduct | null>;
  readProduct(databaseId: string): Promise<DestinationProduct>;
  createHiddenProduct(payload: PlannedProductPayload): Promise<{
    outcome: "CREATED" | "AMBIGUOUS" | "FAILED";
    databaseId?: string;
    error?: string;
  }>;
};

export type ExecutorGate = {
  hostOk: boolean;
  contractMatch: boolean;
  host?: string;
  expectedHost?: string;
};

export type ExecuteResult = {
  runId: string;
  processed: number;
  verified: number;
  skipped: number;
  blocked: number;
  failed: number;
  duplicatesCreated: number;
};

const WRITE_STATES: MigrationEntityState[] = [
  "PENDING_WRITE",
  "WRITTEN",
  "READ_BACK",
  "VERIFIED",
  "BLOCKED",
  "WRITE_FAILED",
  "VERIFY_FAILED",
];

export function canTransitionOp(
  from: MigrationEntityState,
  to: MigrationEntityState,
): boolean {
  if (from === to) return true;
  const order: Record<string, number> = {
    PENDING_WRITE: 0,
    WRITTEN: 1,
    READ_BACK: 2,
    VERIFIED: 3,
  };
  if (to === "BLOCKED" || to === "WRITE_FAILED" || to === "VERIFY_FAILED") {
    return WRITE_STATES.includes(from);
  }
  if (!(from in order) || !(to in order)) return false;
  return order[to]! === order[from]! + 1;
}

export function compareProductExact(
  expected: PlannedProductPayload,
  actual: DestinationProduct,
): string[] {
  const diffs: string[] = [];
  if (actual.menuNumber !== expected.menuNumber) diffs.push("menuNumber");
  if (actual.name !== expected.name) diffs.push("name");
  if (actual.description !== expected.description) diffs.push("description");
  if (actual.basePriceOre !== expected.basePriceOre) diffs.push("basePrice");
  const expCats = [...expected.categoryIds].sort().join(",");
  const actCats = [...actual.categoryIds].sort().join(",");
  if (expCats !== actCats) diffs.push("categories");
  if (actual.variants.length !== expected.variants.length) {
    diffs.push("variantCount");
  } else {
    for (let i = 0; i < expected.variants.length; i++) {
      if (actual.variants[i]?.name !== expected.variants[i]!.name) {
        diffs.push(`variantName${i}`);
      }
      if (actual.variants[i]?.priceOre !== expected.variants[i]!.surchargeOre) {
        diffs.push(`variantPrice${i}`);
      }
    }
  }
  if (actual.ingredients.length !== expected.ingredients.length) {
    diffs.push("ingredientCount");
  } else {
    for (let i = 0; i < expected.ingredients.length; i++) {
      if (actual.ingredients[i]?.name !== expected.ingredients[i]) {
        diffs.push(`ingredient${i}`);
      }
    }
  }
  if (actual.additions.length !== expected.additions.length) {
    diffs.push("additionCount");
  } else {
    for (let i = 0; i < expected.additions.length; i++) {
      if (actual.additions[i]?.name !== expected.additions[i]!.name) {
        diffs.push(`additionName${i}`);
      }
      if (actual.additions[i]?.priceOre !== expected.additions[i]!.priceOre) {
        diffs.push(`additionPrice${i}`);
      }
    }
  }
  if (expected.intendedHidden && actual.listStatus !== "Skjult") {
    diffs.push("visibility");
  }
  return diffs;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Decide next action for a CREATE op given persisted state + destination.
 * Pure — used by executor and tests.
 */
export function resolveCreateResume(input: {
  persistedState: MigrationEntityState | null;
  destination: DestinationProduct | null;
  createOutcome?: "CREATED" | "AMBIGUOUS" | "FAILED" | null;
}): {
  next:
    | "EXECUTE_CREATE"
    | "SKIP_VERIFIED"
    | "READ_BACK_EXISTING"
    | "REVIEW_AMBIGUOUS"
    | "RETRY_CREATE_ABSENT"
    | "FAIL";
  reason: string;
} {
  if (input.persistedState === "VERIFIED") {
    return { next: "SKIP_VERIFIED", reason: "already VERIFIED" };
  }
  if (input.createOutcome === "AMBIGUOUS") {
    if (input.destination) {
      return {
        next: "READ_BACK_EXISTING",
        reason: "ambiguous create but destination exists",
      };
    }
    return {
      next: "REVIEW_AMBIGUOUS",
      reason: "ambiguous create and destination absent/uncertain",
    };
  }
  if (input.destination) {
    return {
      next: "READ_BACK_EXISTING",
      reason: "destination already has identity",
    };
  }
  if (input.persistedState === "WRITTEN" && !input.destination) {
    return {
      next: "REVIEW_AMBIGUOUS",
      reason: "WRITTEN but destination missing",
    };
  }
  if (input.createOutcome === "FAILED" && !input.destination) {
    return {
      next: "RETRY_CREATE_ABSENT",
      reason: "failed create proven absent",
    };
  }
  return { next: "EXECUTE_CREATE", reason: "pending create" };
}

export async function executeMigrationPlan(input: {
  plan: MigrationWritePlan;
  store: RunStore;
  destination: DestinationPort;
  gate: ExecutorGate;
  /** Max CREATE attempts for a single op when proven absent. */
  maxCreateAttempts?: number;
}): Promise<ExecuteResult> {
  assertWritePlanImmutable(input.plan);
  const { plan, store, destination, gate } = input;
  const maxAttempts = input.maxCreateAttempts ?? 2;

  if (!gate.hostOk) {
    throw new Error(
      `WRONG_HOST: expected ${gate.expectedHost} got ${gate.host}`,
    );
  }
  if (!gate.contractMatch) {
    throw new Error("CONTRACT_DRIFT: execution blocked");
  }

  const existing = store.getRun(plan.runId);
  store.upsertRun({
    runId: plan.runId,
    restaurant: plan.restaurant,
    host: plan.host,
    source: plan.source,
    schemaVersion: plan.schemaVersion,
    domainRuleVersion: plan.domainRuleVersion,
    adapterVersion: plan.adapterVersion,
    contractFingerprint: plan.contractFingerprint,
    startedAt: existing?.startedAt ?? now(),
    status: "RUNNING",
  });

  // Seed operations if first start
  for (const op of plan.operations) {
    const prev = store.getOperation(plan.runId, op.operationId);
    if (!prev) {
      store.upsertOperation({
        runId: plan.runId,
        operationId: op.operationId,
        entityType: op.entityType,
        action: op.action,
        identityMenuNumber: op.identity.menuNumber,
        identityName: op.identity.name,
        expectedPayloadJson: op.expectedPayload
          ? JSON.stringify(op.expectedPayload)
          : null,
        destinationId: null,
        state:
          op.action === "SKIP"
            ? "VERIFIED"
            : op.action === "BLOCK" || op.action === "REVIEW"
              ? "BLOCKED"
              : "PENDING_WRITE",
        attemptCount: 0,
        lastErrorCategory: null,
        lastErrorMessage: null,
        verificationDiffJson: null,
        updatedAt: now(),
      });
    }
  }

  let processed = 0;
  let verified = 0;
  let skipped = 0;
  let blocked = 0;
  let failed = 0;
  let duplicatesCreated = 0;

  for (const op of plan.operations) {
    processed += 1;
    const rec = store.getOperation(plan.runId, op.operationId)!;

    if (op.action === "SKIP" || rec.state === "VERIFIED") {
      skipped += 1;
      verified += rec.state === "VERIFIED" ? 1 : 0;
      if (op.action === "SKIP" && rec.state !== "VERIFIED") {
        store.upsertOperation({
          ...rec,
          state: "VERIFIED",
          updatedAt: now(),
        });
        verified += 1;
      }
      continue;
    }

    if (op.action === "BLOCK" || op.action === "REVIEW") {
      blocked += 1;
      store.upsertOperation({
        ...rec,
        state: "BLOCKED",
        lastErrorMessage: op.reason ?? op.action,
        updatedAt: now(),
      });
      continue;
    }

    if (op.action !== "CREATE" || !op.expectedPayload) {
      blocked += 1;
      continue;
    }

    await processCreateOp({
      plan,
      op,
      store,
      destination,
      maxAttempts,
      onVerified: () => {
        verified += 1;
      },
      onFailed: () => {
        failed += 1;
      },
      onBlocked: () => {
        blocked += 1;
      },
      onDuplicateRisk: () => {
        duplicatesCreated += 1;
      },
    });
  }

  store.upsertRun({
    ...(store.getRun(plan.runId) as NonNullable<ReturnType<RunStore["getRun"]>>),
    endedAt: now(),
    status: failed + blocked > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
  });

  return {
    runId: plan.runId,
    processed,
    verified,
    skipped,
    blocked,
    failed,
    duplicatesCreated,
  };
}

async function processCreateOp(input: {
  plan: MigrationWritePlan;
  op: WritePlanOperation;
  store: RunStore;
  destination: DestinationPort;
  maxAttempts: number;
  onVerified: () => void;
  onFailed: () => void;
  onBlocked: () => void;
  onDuplicateRisk: () => void;
}): Promise<void> {
  const { plan, op, store, destination, maxAttempts } = input;
  let rec = store.getOperation(plan.runId, op.operationId)!;
  const expected = op.expectedPayload!;

  if (rec.state === "VERIFIED") {
    input.onVerified();
    return;
  }

  const found = await destination.findByIdentity(op.identity);
  const decision = resolveCreateResume({
    persistedState: rec.state,
    destination: found,
    createOutcome: null,
  });

  if (decision.next === "SKIP_VERIFIED") {
    input.onVerified();
    return;
  }

  let databaseId = rec.destinationId ?? found?.databaseId ?? null;

  if (decision.next === "EXECUTE_CREATE" || decision.next === "RETRY_CREATE_ABSENT") {
    if (rec.attemptCount >= maxAttempts) {
      store.upsertOperation({
        ...rec,
        state: "WRITE_FAILED",
        lastErrorCategory: "ADMIN_WRITE_ERROR",
        lastErrorMessage: "max create attempts exceeded",
        updatedAt: now(),
      });
      input.onFailed();
      return;
    }

    // Pre-create identity check (idempotency)
    const again = await destination.findByIdentity(op.identity);
    if (again) {
      databaseId = again.databaseId;
    } else {
      const createResult = await destination.createHiddenProduct(expected);
      rec = {
        ...rec,
        attemptCount: rec.attemptCount + 1,
        updatedAt: now(),
      };
      if (createResult.outcome === "FAILED") {
        const afterFail = await destination.findByIdentity(op.identity);
        if (afterFail) {
          databaseId = afterFail.databaseId;
        } else if (rec.attemptCount >= maxAttempts) {
          store.upsertOperation({
            ...rec,
            state: "WRITE_FAILED",
            lastErrorCategory: "ADMIN_WRITE_ERROR",
            lastErrorMessage: createResult.error ?? "create failed",
            updatedAt: now(),
          });
          input.onFailed();
          return;
        } else {
          store.upsertOperation({
            ...rec,
            state: "PENDING_WRITE",
            lastErrorMessage: createResult.error ?? "create failed",
            updatedAt: now(),
          });
          // bounded: one more loop not automatic here — mark pending
          input.onFailed();
          return;
        }
      } else if (createResult.outcome === "AMBIGUOUS") {
        const afterAmb = await destination.findByIdentity(op.identity);
        if (!afterAmb) {
          store.upsertOperation({
            ...rec,
            state: "BLOCKED",
            lastErrorCategory: "UNKNOWN_ERROR",
            lastErrorMessage: "ambiguous create; destination not found",
            updatedAt: now(),
          });
          input.onBlocked();
          return;
        }
        databaseId = afterAmb.databaseId;
      } else {
        databaseId = createResult.databaseId ?? null;
        if (!databaseId) {
          const lookup = await destination.findByIdentity(op.identity);
          databaseId = lookup?.databaseId ?? null;
        }
      }

      store.upsertOperation({
        ...rec,
        destinationId: databaseId,
        state: databaseId ? "WRITTEN" : "WRITE_FAILED",
        updatedAt: now(),
      });
      if (!databaseId) {
        input.onFailed();
        return;
      }
    }
  }

  if (decision.next === "READ_BACK_EXISTING" && found) {
    databaseId = found.databaseId;
    // If we already had a destinationId and create would have run — duplicate risk counter stays 0 because we skipped create
    store.upsertOperation({
      ...rec,
      destinationId: databaseId,
      state: "WRITTEN",
      updatedAt: now(),
    });
  }

  if (decision.next === "REVIEW_AMBIGUOUS") {
    store.upsertOperation({
      ...rec,
      state: "BLOCKED",
      lastErrorCategory: "UNKNOWN_ERROR",
      lastErrorMessage: decision.reason,
      updatedAt: now(),
    });
    input.onBlocked();
    return;
  }

  if (!databaseId) {
    store.upsertOperation({
      ...rec,
      state: "WRITE_FAILED",
      lastErrorMessage: "missing destination id after create path",
      updatedAt: now(),
    });
    input.onFailed();
    return;
  }

  const read = await destination.readProduct(databaseId);
  store.upsertOperation({
    ...store.getOperation(plan.runId, op.operationId)!,
    destinationId: databaseId,
    state: "READ_BACK",
    updatedAt: now(),
  });

  const diffs = compareProductExact(expected, read);
  if (diffs.length) {
    store.upsertOperation({
      ...store.getOperation(plan.runId, op.operationId)!,
      state: "VERIFY_FAILED",
      verificationDiffJson: JSON.stringify(diffs),
      lastErrorCategory: "READBACK_MISMATCH",
      lastErrorMessage: diffs.join(","),
      updatedAt: now(),
    });
    input.onFailed();
    return;
  }

  store.upsertOperation({
    ...store.getOperation(plan.runId, op.operationId)!,
    state: "VERIFIED",
    verificationDiffJson: "[]",
    lastErrorCategory: null,
    lastErrorMessage: null,
    updatedAt: now(),
  });
  input.onVerified();
  void input.onDuplicateRisk;
}
