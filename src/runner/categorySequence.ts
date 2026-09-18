import type { WritePlanOperation } from "./writePlan.js";

const PENDING_CATEGORY_PREFIX = "__resolve__:";

function isCategoryCreate(op: WritePlanOperation): boolean {
  return op.entityType === "category" && op.action === "CREATE";
}

function isProductCreate(op: WritePlanOperation): boolean {
  return op.entityType === "product" && op.action === "CREATE";
}

function pendingCategoryName(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed.startsWith(PENDING_CATEGORY_PREFIX)) return null;
  return trimmed.slice(PENDING_CATEGORY_PREFIX.length).trim() || null;
}

/**
 * Dependency-minimizing CREATE order: do not emit every public category first.
 * For each pending `__resolve__:Name` product, place that category CREATE
 * immediately before the first dependent product CREATE.
 * Category creates that are not pending-token dependencies keep original order.
 */
export function orderOperationsForMinimizedCategoryExposure(
  operations: readonly WritePlanOperation[],
): WritePlanOperation[] {
  const categoryCreates = operations.filter(isCategoryCreate);
  if (categoryCreates.length === 0) return [...operations];

  const used = new Set<string>();
  const out: WritePlanOperation[] = [];

  const emitDependentCategory = (op: WritePlanOperation) => {
    const refs = [
      ...(op.expectedPayload?.categoryIds ?? []),
      op.identity.categoryHint ?? "",
    ];
    for (const ref of refs) {
      const name = pendingCategoryName(ref);
      if (!name) continue;
      const cat = categoryCreates.find(
        (candidate) =>
          !used.has(candidate.operationId) &&
          (candidate.identity.name ?? "").trim() === name,
      );
      if (!cat) continue;
      out.push(cat);
      used.add(cat.operationId);
    }
  };

  for (const op of operations) {
    if (isCategoryCreate(op)) continue;
    if (isProductCreate(op)) emitDependentCategory(op);
    out.push(op);
  }

  const unused = categoryCreates.filter((op) => !used.has(op.operationId));
  if (unused.length === 0) return out;

  const originalIndex = new Map(
    operations.map((op, index) => [op.operationId, index]),
  );
  const merged = [...out, ...unused];
  merged.sort((a, b) => {
    const left = originalIndex.get(a.operationId) ?? 0;
    const right = originalIndex.get(b.operationId) ?? 0;
    return left - right;
  });
  return merged;
}
