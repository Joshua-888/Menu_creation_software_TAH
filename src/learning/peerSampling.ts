/**
 * Stratified peer product sampling — ensure pizza/finger_food/etc. appear
 * even when menus are category-clustered.
 */

import { classifyProductKind, type ProductKind } from "./categoryLikelihood.js";

export type SampleableProduct = {
  databaseId?: string | null;
  name: string;
  menuNumber?: string | null;
  categoryText?: string | null;
};

export type StratifiedSampleOptions = {
  maxSample: number;
  /** Minimum products to try to keep per kind (soft — capped by availability). */
  minPerKind?: Partial<Record<ProductKind, number>>;
};

const DEFAULT_MIN: Partial<Record<ProductKind, number>> = {
  pizza: 6,
  finger_food: 2,
  menu_with_fries: 2,
  sandwich_grill: 2,
  drinks: 1,
  pasta: 1,
  indian: 1,
  nachos: 1,
};

/**
 * Fill kind quotas first, then round-robin remaining slots from leftovers.
 * Deterministic given stable input order.
 */
export function stratifiedPeerSample<T extends SampleableProduct>(
  candidates: T[],
  options: StratifiedSampleOptions,
): T[] {
  const maxSample = Math.max(1, options.maxSample);
  const minPerKind = { ...DEFAULT_MIN, ...(options.minPerKind ?? {}) };

  const byKind = new Map<ProductKind, T[]>();
  for (const c of candidates) {
    const kind = classifyProductKind({
      name: c.name,
      ...(c.categoryText ? { categoryNames: [c.categoryText] } : {}),
    });
    const list = byKind.get(kind) ?? [];
    list.push(c);
    byKind.set(kind, list);
  }

  const picked = new Set<T>();
  const result: T[] = [];

  const takeFrom = (list: T[], n: number) => {
    let taken = 0;
    for (const item of list) {
      if (result.length >= maxSample) break;
      if (picked.has(item)) continue;
      picked.add(item);
      result.push(item);
      taken += 1;
      if (taken >= n) break;
    }
  };

  // Soft quotas
  for (const [kind, min] of Object.entries(minPerKind) as Array<
    [ProductKind, number]
  >) {
    const list = byKind.get(kind) ?? [];
    if (!list.length || !min) continue;
    takeFrom(list, Math.min(min, list.length));
  }

  // Fill remaining with stride across unused candidates (preserve coverage)
  if (result.length < maxSample) {
    const unused = candidates.filter((c) => !picked.has(c));
    const need = maxSample - result.length;
    if (unused.length <= need) {
      for (const c of unused) {
        if (result.length >= maxSample) break;
        picked.add(c);
        result.push(c);
      }
    } else {
      const step = Math.max(1, Math.floor(unused.length / need));
      for (let i = 0; i < unused.length && result.length < maxSample; i += step) {
        const c = unused[i]!;
        if (picked.has(c)) continue;
        picked.add(c);
        result.push(c);
      }
      // If stride skipped some slots, append head of unused
      for (const c of unused) {
        if (result.length >= maxSample) break;
        if (picked.has(c)) continue;
        picked.add(c);
        result.push(c);
      }
    }
  }

  return result.slice(0, maxSample);
}
