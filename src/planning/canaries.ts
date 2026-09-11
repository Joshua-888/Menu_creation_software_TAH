/** Synthetic M3 canaries — never treat as real Veroni source-menu products. */

export const TAH_CANARY_NAME_PREFIX = "__TAH_CANARY_";

export function isTahCanaryProduct(name: string | undefined | null): boolean {
  return Boolean(name && name.startsWith(TAH_CANARY_NAME_PREFIX));
}

export function partitionDestinationProducts<T extends { name: string }>(
  products: readonly T[],
): { real: T[]; canaries: T[] } {
  const real: T[] = [];
  const canaries: T[] = [];
  for (const p of products) {
    if (isTahCanaryProduct(p.name)) canaries.push(p);
    else real.push(p);
  }
  return { real, canaries };
}
