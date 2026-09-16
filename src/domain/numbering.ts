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

/**
 * Next category block when a menucard (or category) has no printed numbers:
 * burgers 1–4 → pizzas start at 10; pizzas 10–13 → drinks start at 20.
 */
export function nextDecadeBlockStart(afterHighest: number | null): number {
  if (afterHighest === null || afterHighest < 1) {
    return 1;
  }
  return Math.ceil((afterHighest + 1) / 10) * 10;
}

function hasSourceMenuNumber(product: SourceProduct): boolean {
  const raw = product.sourceMenuNumber?.trim();
  return raw !== undefined && raw.length > 0;
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

function bumpHighest(
  current: number | null,
  assigned: string,
): number | null {
  const n = parsePureIntegerMenuNumber(assigned);
  if (n === null) return current;
  if (current === null || n > current) return n;
  return current;
}

/**
 * Assign menu numbers without mutating SourceMenu.
 * Preserves exact source strings from the card.
 *
 * When the whole menu has no printed numbers: assign in category reading order
 * (category sourceOrder, then product sourceOrder), starting at 1 and jumping
 * to the next decade at each new category (1–4 → 10–13 → 20–23).
 *
 * When only some categories lack numbers: unnumbered categories get the same
 * decade jump after the highest number seen so far (printed or generated).
 *
 * Mixed categories (some items numbered on card): fill gaps sequentially after
 * the global highest numeric source number (legacy single-category behavior).
 */
export function assignMenuNumbers(menu: SourceMenu): NumberingResult {
  const categories = [...menu.categories].sort(
    (a, b) => a.sourceOrder - b.sourceOrder,
  );

  let highestExistingNumeric: number | null = null;
  const sourceNumberCounts = new Map<string, number>();

  for (const category of categories) {
    for (const product of category.products) {
      const raw = product.sourceMenuNumber?.trim();
      if (raw !== undefined && raw.length > 0) {
        sourceNumberCounts.set(raw, (sourceNumberCounts.get(raw) ?? 0) + 1);
        highestExistingNumeric = bumpHighest(highestExistingNumeric, raw);
      }
    }
  }

  const menuHasPrintedNumbers = [...sourceNumberCounts.keys()].length > 0;

  const sourceDuplicateNumbers = [...sourceNumberCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([num]) => num)
    .sort();

  const usedAssigned = new Set<string>();
  for (const category of categories) {
    for (const product of category.products) {
      const raw = product.sourceMenuNumber?.trim();
      if (raw !== undefined && raw.length > 0) {
        usedAssigned.add(raw);
      }
    }
  }

  let runningHighest = highestExistingNumeric;
  let nextSequential =
    highestExistingNumeric === null ? 1 : highestExistingNumeric + 1;

  const takeNextUnused = (preferred: number): number => {
    let n = preferred;
    while (usedAssigned.has(String(n))) {
      n += 1;
    }
    usedAssigned.add(String(n));
    return n;
  };

  const products: NumberedProduct[] = [];

  for (const category of categories) {
    const catProducts = [...category.products].sort(
      (a, b) => a.sourceOrder - b.sourceOrder,
    );
    const categoryHasPrintedNumbers = catProducts.some(hasSourceMenuNumber);
    const unnumberedInCategory = catProducts.filter(
      (p) => !hasSourceMenuNumber(p),
    );

    let blockCursor: number | null = null;

    if (
      unnumberedInCategory.length > 0 &&
      (!menuHasPrintedNumbers || !categoryHasPrintedNumbers)
    ) {
      blockCursor = nextDecadeBlockStart(runningHighest);
    }

    for (const product of catProducts) {
      const raw = product.sourceMenuNumber?.trim();
      if (raw !== undefined && raw.length > 0) {
        products.push({
          sourceId: product.sourceId,
          categorySourceId: category.sourceId,
          sourceMenuNumber: product.sourceMenuNumber,
          assignedMenuNumber: raw,
          wasGenerated: false,
          sourceOrder: product.sourceOrder,
        });
        runningHighest = bumpHighest(runningHighest, raw);
        continue;
      }

      let assigned: number;
      if (
        !menuHasPrintedNumbers ||
        (!categoryHasPrintedNumbers && blockCursor !== null)
      ) {
        assigned = takeNextUnused(blockCursor!);
        blockCursor = assigned + 1;
      } else {
        assigned = takeNextUnused(nextSequential);
        nextSequential = assigned + 1;
      }

      const generated = String(assigned);
      runningHighest = bumpHighest(runningHighest, generated);

      products.push({
        sourceId: product.sourceId,
        categorySourceId: category.sourceId,
        sourceMenuNumber: product.sourceMenuNumber,
        assignedMenuNumber: generated,
        wasGenerated: true,
        sourceOrder: product.sourceOrder,
      });
    }
  }

  return {
    products,
    highestExistingNumeric,
    sourceDuplicateNumbers,
  };
}
