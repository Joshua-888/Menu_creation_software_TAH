import type { SourceMenu, SourceProduct } from "./schema/source.js";

export type NumberedProduct = {
  sourceId: string;
  categorySourceId: string;
  sourceMenuNumber: string | undefined;
  assignedMenuNumber: string;
  wasGenerated: boolean;
  sourceOrder: number;
};

export type NumberingResult = {
  products: NumberedProduct[];
  highestExistingNumeric: number | null;
  sourceDuplicateNumbers: string[];
};

/**
 * Pure integer after trim — alphanumeric like "220A" do NOT participate.
 */
export function parsePureIntegerMenuNumber(
  value: string | undefined,
): number | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  return Number.parseInt(trimmed, 10);
}

function flattenProducts(menu: SourceMenu): Array<{
  product: SourceProduct;
  categorySourceId: string;
}> {
  const rows: Array<{ product: SourceProduct; categorySourceId: string }> = [];
  const categories = [...menu.categories].sort(
    (a, b) => a.sourceOrder - b.sourceOrder,
  );
  for (const category of categories) {
    const products = [...category.products].sort(
      (a, b) => a.sourceOrder - b.sourceOrder,
    );
    for (const product of products) {
      rows.push({ product, categorySourceId: category.sourceId });
    }
  }
  return rows;
}

/**
 * Assign menu numbers without mutating SourceMenu.
 * Preserves exact source strings; generates unused sequential integers after
 * the highest pure-integer source number, in source order.
 */
export function assignMenuNumbers(menu: SourceMenu): NumberingResult {
  const rows = flattenProducts(menu);

  let highestExistingNumeric: number | null = null;
  const sourceNumberCounts = new Map<string, number>();

  for (const { product } of rows) {
    const raw = product.sourceMenuNumber?.trim();
    if (raw !== undefined && raw.length > 0) {
      sourceNumberCounts.set(raw, (sourceNumberCounts.get(raw) ?? 0) + 1);
      const numeric = parsePureIntegerMenuNumber(raw);
      if (numeric !== null) {
        if (
          highestExistingNumeric === null ||
          numeric > highestExistingNumeric
        ) {
          highestExistingNumeric = numeric;
        }
      }
    }
  }

  const sourceDuplicateNumbers = [...sourceNumberCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([num]) => num)
    .sort();

  const usedAssigned = new Set<string>();
  for (const { product } of rows) {
    const raw = product.sourceMenuNumber?.trim();
    if (raw !== undefined && raw.length > 0) {
      usedAssigned.add(raw);
    }
  }

  let next =
    highestExistingNumeric === null ? 1 : highestExistingNumeric + 1;

  const products: NumberedProduct[] = [];
  for (const { product, categorySourceId } of rows) {
    const raw = product.sourceMenuNumber?.trim();
    if (raw !== undefined && raw.length > 0) {
      products.push({
        sourceId: product.sourceId,
        categorySourceId,
        sourceMenuNumber: product.sourceMenuNumber,
        assignedMenuNumber: raw,
        wasGenerated: false,
        sourceOrder: product.sourceOrder,
      });
      continue;
    }

    while (usedAssigned.has(String(next))) {
      next += 1;
    }
    const generated = String(next);
    usedAssigned.add(generated);
    products.push({
      sourceId: product.sourceId,
      categorySourceId,
      sourceMenuNumber: product.sourceMenuNumber,
      assignedMenuNumber: generated,
      wasGenerated: true,
      sourceOrder: product.sourceOrder,
    });
    next += 1;
  }

  return {
    products,
    highestExistingNumeric,
    sourceDuplicateNumbers,
  };
}
