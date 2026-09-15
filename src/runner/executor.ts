/**
 * M4 migration executor — idempotency, resume, exact verification.
 * Browser adapter is injected; this layer makes no menu-business inventions.
 *
 * Identity: prefer destinationDatabaseId when known; otherwise sourceId mapping;
 * evidence (menuNumber/name/category) is secondary and must not guess on ambiguity.
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
  /** Optional link back to source when known. */
  sourceId?: string;
};

export type DestinationMatchResult =
  | { outcome: "FOUND"; product: DestinationProduct }
  | { outcome: "NONE" }
  | { outcome: "AMBIGUOUS"; candidates: DestinationProduct[] };

export type DestinationPort = {
  /**
   * Resolve destination for an operation identity.
   * Prefer destinationDatabaseId → sourceId mapping → evidence match.
   * Ambiguous evidence must return AMBIGUOUS (never guess).
   */
  findByIdentity(identity: ProductIdentityKey): Promise<DestinationMatchResult>;
  readProduct(databaseId: string): Promise<DestinationProduct>;
  createHiddenProduct(payload: PlannedProductPayload): Promise<{
    outcome: "CREATED" | "AMBIGUOUS" | "FAILED";
    databaseId?: string;
    error?: string;
  }>;
  /** Optional: create a destination category (M6.7+). */
  createCategory?(input: {
    name: string;
    sourceId?: string;
    allowCustomerCategory?: boolean;
  }): Promise<{
    outcome: "CREATED" | "EXISTS" | "FAILED";
    databaseId?: string;
    error?: string;
  }>;
  /** Optional: list categories for `__resolve__:Name` tokens after create. */
  listCategories?(): Promise<Array<{ databaseId: string; name: string }>>;
  /**
   * Optional certified Opdater path (full product card on edit form).
   * Never uses full updateProduct API.
   */
  updateProductViaOpdater?(input: {
    databaseId: string;
    payload: PlannedProductPayload;
  }): Promise<{
    outcome: "UPDATED" | "FAILED";
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

/**
 * Evidence-only destination matching (no sourceId / destinationId yet).
 * Ambiguous matches must not be resolved by guessing.
 */
export function matchDestinationByEvidence(
  catalog: readonly DestinationProduct[],
  evidence: {
    menuNumber?: string;
    name?: string;
    categoryHint?: string;
  },
): DestinationMatchResult {
  const menu = evidence.menuNumber?.trim();
  const name = evidence.name?.trim().toLowerCase();
  if (!menu && !name) return { outcome: "NONE" };

  const candidates = catalog.filter((p) => {
    const menuOk = menu ? p.menuNumber.trim() === menu : true;
    const nameOk = name ? p.name.trim().toLowerCase() === name : true;
    const catOk = evidence.categoryHint
      ? p.categoryIds.some((c) => c === evidence.categoryHint)
      : true;
    return menuOk && nameOk && catOk;
  });

  if (candidates.length === 0) return { outcome: "NONE" };
  if (candidates.length === 1) {
    return { outcome: "FOUND", product: candidates[0]! };
  }
  return { outcome: "AMBIGUOUS", candidates };
}

/**
 * Prefer destinationDatabaseId, then sourceId on catalog, then evidence.
 */
export function resolveDestinationIdentity(
  identity: ProductIdentityKey,
  catalog: readonly DestinationProduct[],
  sourceIdMap?: ReadonlyMap<string, string>,
): DestinationMatchResult {
  if (identity.destinationDatabaseId) {
    const byId = catalog.find(
      (p) => p.databaseId === identity.destinationDatabaseId,
    );
    if (byId) return { outcome: "FOUND", product: byId };
  }

  const mappedId = sourceIdMap?.get(identity.sourceId);
  if (mappedId) {
    const byMap = catalog.find((p) => p.databaseId === mappedId);
    if (byMap) return { outcome: "FOUND", product: byMap };
  }

  const bySource = catalog.filter((p) => p.sourceId === identity.sourceId);
  if (bySource.length === 1) {
    return { outcome: "FOUND", product: bySource[0]! };
  }
  if (bySource.length > 1) {
    return { outcome: "AMBIGUOUS", candidates: bySource };
  }

  return matchDestinationByEvidence(catalog, {
    ...(identity.menuNumber ? { menuNumber: identity.menuNumber } : {}),
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.categoryHint ? { categoryHint: identity.categoryHint } : {}),
  });
}

function now(): string {
  return new Date().toISOString();
}

function foundOrNull(
  match: DestinationMatchResult,
): DestinationProduct | null {
  return match.outcome === "FOUND" ? match.product : null;
}

/**
 * Decide next action for a CREATE op given persisted state + destination.
 * Pure — used by executor and tests.
 */
export function resolveCreateResume(input: {
  persistedState: MigrationEntityState | null;
  destination: DestinationProduct | null;
  createOutcome?: "CREATED" | "AMBIGUOUS" | "FAILED" | null;
  matchAmbiguous?: boolean;
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
  if (input.matchAmbiguous) {
    return {
      next: "REVIEW_AMBIGUOUS",
      reason: "MANUAL_REVIEW_REQUIRED: ambiguous destination match",
    };
  }
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

  if (plan.dryRun) {
    throw new Error("DRY_RUN WritePlan cannot be executed");
  }

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
        identitySourceId: op.identity.sourceId,
        identityMenuNumber: op.identity.menuNumber ?? "",
        identityName: op.identity.name ?? "",
        expectedPayloadJson: op.expectedPayload
          ? JSON.stringify(op.expectedPayload)
          : null,
        destinationId: op.identity.destinationDatabaseId ?? null,
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

    if (op.entityType === "category" && op.action === "CREATE") {
      await processCategoryCreateOp({
        plan,
        op,
        store,
        destination,
        onVerified: () => {
          verified += 1;
        },
        onFailed: () => {
          failed += 1;
        },
        onBlocked: () => {
          blocked += 1;
        },
      });
      continue;
    }

    if (op.action === "UPDATE" && op.expectedPayload) {
      await processUpdateOp({
        plan,
        op,
        store,
        destination,
        onVerified: () => {
          verified += 1;
        },
        onFailed: () => {
          failed += 1;
        },
        onBlocked: () => {
          blocked += 1;
        },
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

async function processUpdateOp(input: {
  plan: MigrationWritePlan;
  op: WritePlanOperation;
  store: RunStore;
  destination: DestinationPort;
  onVerified: () => void;
  onFailed: () => void;
  onBlocked: () => void;
}): Promise<void> {
  const { plan, op, store, destination } = input;
  let rec = store.getOperation(plan.runId, op.operationId)!;
  if (rec.state === "VERIFIED") {
    input.onVerified();
    return;
  }
  const expected = op.expectedPayload;
  if (!expected) {
    store.upsertOperation({
      ...rec,
      state: "BLOCKED",
      lastErrorMessage: "UPDATE missing expectedPayload",
      updatedAt: now(),
    });
    input.onBlocked();
    return;
  }
  if (!destination.updateProductViaOpdater) {
    store.upsertOperation({
      ...rec,
      state: "BLOCKED",
      lastErrorMessage: "destination port does not support updateProductViaOpdater",
      updatedAt: now(),
    });
    input.onBlocked();
    return;
  }
  const databaseId =
    op.identity.destinationDatabaseId ?? rec.destinationId ?? null;
  if (!databaseId) {
    store.upsertOperation({
      ...rec,
      state: "BLOCKED",
      lastErrorMessage: "UPDATE missing destinationDatabaseId",
      updatedAt: now(),
    });
    input.onBlocked();
    return;
  }

  const result = await destination.updateProductViaOpdater({
    databaseId,
    payload: expected,
  });
  rec = {
    ...rec,
    attemptCount: rec.attemptCount + 1,
    destinationId: databaseId,
    updatedAt: now(),
  };
  if (result.outcome === "FAILED") {
    store.upsertOperation({
      ...rec,
      state: "WRITE_FAILED",
      lastErrorCategory: "ADMIN_WRITE_ERROR",
      lastErrorMessage: result.error ?? "Opdater update failed",
      updatedAt: now(),
    });
    input.onFailed();
    return;
  }

  store.upsertOperation({
    ...rec,
    state: "WRITTEN",
    updatedAt: now(),
  });

  const actual = await destination.readProduct(databaseId);
  const diffs: string[] = [];
  if (actual.name.trim() !== expected.name.trim()) diffs.push("name");
  if (actual.description.trim() !== expected.description.trim()) {
    diffs.push("description");
  }
  if (actual.basePriceOre !== expected.basePriceOre) diffs.push("basePrice");
  const actualIngs = actual.ingredients.map((i) => i.name.trim().toLowerCase()).sort();
  const expectedIngs = expected.ingredients.map((i) => i.trim().toLowerCase()).sort();
  if (JSON.stringify(actualIngs) !== JSON.stringify(expectedIngs)) {
    diffs.push("ingredients");
  }
  const actualVars = actual.variants
    .map((v) => `${v.name.trim().toLowerCase()}:${v.priceOre}`)
    .sort()
    .join("|");
  const expectedVars = expected.variants
    .map((v) => `${v.name.trim().toLowerCase()}:${v.surchargeOre}`)
    .sort()
    .join("|");
  if (actualVars !== expectedVars) diffs.push("variants");
  const actualAdds = actual.additions
    .map((a) => `${a.name.trim().toLowerCase()}:${a.priceOre}`)
    .sort()
    .join("|");
  const expectedAdds = expected.additions
    .map((a) => `${a.name.trim().toLowerCase()}:${a.priceOre}`)
    .sort()
    .join("|");
  if (actualAdds !== expectedAdds) diffs.push("additions");
  if (diffs.length) {
    store.upsertOperation({
      ...rec,
      state: "VERIFY_FAILED",
      lastErrorMessage: `read-back mismatch: ${diffs.join(",")}`,
      updatedAt: now(),
    });
    input.onFailed();
    return;
  }
  store.upsertOperation({
    ...rec,
    state: "VERIFIED",
    updatedAt: now(),
  });
  input.onVerified();
}

async function processCategoryCreateOp(input: {
  plan: MigrationWritePlan;
  op: WritePlanOperation;
  store: RunStore;
  destination: DestinationPort;
  onVerified: () => void;
  onFailed: () => void;
  onBlocked: () => void;
}): Promise<void> {
  const { plan, op, store, destination } = input;
  const rec = store.getOperation(plan.runId, op.operationId)!;
  if (rec.state === "VERIFIED") {
    input.onVerified();
    return;
  }
  const name = op.identity.name?.trim();
  if (!name) {
    store.upsertOperation({
      ...rec,
      state: "BLOCKED",
      lastErrorMessage: "category CREATE missing name",
      updatedAt: now(),
    });
    input.onBlocked();
    return;
  }
  if (!destination.createCategory) {
    store.upsertOperation({
      ...rec,
      state: "BLOCKED",
      lastErrorMessage: "destination port does not support createCategory",
      updatedAt: now(),
    });
    input.onBlocked();
    return;
  }

  if (destination.listCategories) {
    const existing = await destination.listCategories();
    const hit = existing.find(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (hit) {
      store.upsertOperation({
        ...rec,
        destinationId: hit.databaseId,
        state: "VERIFIED",
        updatedAt: now(),
      });
      input.onVerified();
      return;
    }
  }

  const allowCustomer = !/^__TAH_CANARY_/i.test(name);
  const result = await destination.createCategory({
    name,
    sourceId: op.identity.sourceId,
    allowCustomerCategory: allowCustomer,
  });
  if (result.outcome === "FAILED" || !result.databaseId) {
    store.upsertOperation({
      ...rec,
      state: "WRITE_FAILED",
      lastErrorCategory: "ADMIN_WRITE_ERROR",
      lastErrorMessage: result.error ?? "createCategory failed",
      updatedAt: now(),
    });
    input.onFailed();
    return;
  }
  store.upsertOperation({
    ...rec,
    destinationId: result.databaseId,
    state: "VERIFIED",
    updatedAt: now(),
  });
  input.onVerified();
}

async function resolveCategoryIds(
  destination: DestinationPort,
  categoryIds: string[],
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const out: string[] = [];
  for (const id of categoryIds) {
    if (!id.startsWith("__resolve__:")) {
      out.push(id);
      continue;
    }
    const name = id.slice("__resolve__:".length).trim();
    if (!destination.listCategories) {
      return {
        ok: false,
        error: `cannot resolve pending category "${name}" — listCategories missing`,
      };
    }
    const cats = await destination.listCategories();
    const hit = cats.find(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (!hit) {
      return {
        ok: false,
        error: `pending category "${name}" not found after createCategory`,
      };
    }
    out.push(hit.databaseId);
  }
  return { ok: true, ids: out };
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
  const rawExpected = op.expectedPayload!;

  if (rec.state === "VERIFIED") {
    input.onVerified();
    return;
  }

  const resolved = await resolveCategoryIds(
    destination,
    rawExpected.categoryIds,
  );
  if (!resolved.ok) {
    store.upsertOperation({
      ...rec,
      state: "BLOCKED",
      lastErrorMessage: resolved.error,
      updatedAt: now(),
    });
    input.onBlocked();
    return;
  }
  const expected: PlannedProductPayload = {
    ...rawExpected,
    categoryIds: resolved.ids,
  };

  const identity: ProductIdentityKey = {
    ...op.identity,
    ...(rec.destinationId
      ? { destinationDatabaseId: rec.destinationId }
      : {}),
  };

  const match = await destination.findByIdentity(identity);
  if (match.outcome === "AMBIGUOUS") {
    store.upsertOperation({
      ...rec,
      state: "BLOCKED",
      lastErrorCategory: "UNKNOWN_ERROR",
      lastErrorMessage: "MANUAL_REVIEW_REQUIRED: ambiguous destination match",
      updatedAt: now(),
    });
    input.onBlocked();
    return;
  }

  const found = foundOrNull(match);
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
    const again = await destination.findByIdentity(identity);
    if (again.outcome === "AMBIGUOUS") {
      store.upsertOperation({
        ...rec,
        state: "BLOCKED",
        lastErrorCategory: "UNKNOWN_ERROR",
        lastErrorMessage: "MANUAL_REVIEW_REQUIRED: ambiguous destination match",
        updatedAt: now(),
      });
      input.onBlocked();
      return;
    }
    if (again.outcome === "FOUND") {
      databaseId = again.product.databaseId;
    } else {
      const createResult = await destination.createHiddenProduct(expected);
      rec = {
        ...rec,
        attemptCount: rec.attemptCount + 1,
        updatedAt: now(),
      };
      if (createResult.outcome === "FAILED") {
        const afterFail = await destination.findByIdentity(identity);
        if (afterFail.outcome === "FOUND") {
          databaseId = afterFail.product.databaseId;
        } else if (afterFail.outcome === "AMBIGUOUS") {
          store.upsertOperation({
            ...rec,
            state: "BLOCKED",
            lastErrorCategory: "UNKNOWN_ERROR",
            lastErrorMessage:
              "MANUAL_REVIEW_REQUIRED: ambiguous destination match after failed create",
            updatedAt: now(),
          });
          input.onBlocked();
          return;
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
          input.onFailed();
          return;
        }
      } else if (createResult.outcome === "AMBIGUOUS") {
        const afterAmb = await destination.findByIdentity(identity);
        if (afterAmb.outcome !== "FOUND") {
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
        databaseId = afterAmb.product.databaseId;
      } else {
        databaseId = createResult.databaseId ?? null;
        if (!databaseId) {
          const lookup = await destination.findByIdentity(identity);
          databaseId =
            lookup.outcome === "FOUND" ? lookup.product.databaseId : null;
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
      if (databaseId) {
        store.setSourceDestinationMapping(
          plan.runId,
          op.identity.sourceId,
          databaseId,
        );
      }
    }
  }

  if (decision.next === "READ_BACK_EXISTING" && found) {
    databaseId = found.databaseId;
    store.upsertOperation({
      ...rec,
      destinationId: databaseId,
      state: "WRITTEN",
      updatedAt: now(),
    });
    store.setSourceDestinationMapping(
      plan.runId,
      op.identity.sourceId,
      databaseId,
    );
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
