/**
 * Peer addition / Tilbehør price benchmark.
 *
 * When the source has no addition prices, use peer URL addition prices:
 * 1) median by addition name across peers
 * 2) else overall ekstra (non-dip) or dip median
 * 3) else DEFAULT_EKSTRA_PRICE_ORE (10 kr)
 */

import type { CanonicalMenu } from "../domain/schema/canonical.js";
import { normalizeAdditionName } from "../decisions/facts.js";
import {
  isDipLikeAddition,
  normalizePeerAdditionKey,
} from "./additionLikelihood.js";
import type { PeerMenuSnapshot } from "./peerMenuStructure.js";
import { DEFAULT_EKSTRA_PRICE_ORE } from "./categoryIngredientAdditions.js";
import { defaultTilbehorPriceOre } from "../domain/menuCardQuality.js";

export type PeerAdditionPriceEntry = {
  nameKey: string;
  displayName: string;
  medianOre: number;
  samples: number;
  isDip: boolean;
};

export type PeerAdditionPriceBenchmark = {
  restaurantsAnalyzed: number;
  hosts: string[];
  byNameKey: Record<string, PeerAdditionPriceEntry>;
  /** Median of all non-dip peer addition prices. */
  ekstraMedianOre: number;
  /** Median of all dip peer addition prices. */
  dipMedianOre: number;
  fingerprint: string;
};

export type PeerPriceSource =
  | "PEER_NAME_MEDIAN"
  | "PEER_EKSTRA_MEDIAN"
  | "PEER_DIP_MEDIAN"
  | "DEFAULT_10KR";

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? Math.round((s[mid - 1]! + s[mid]!) / 2)
    : s[mid]!;
}

export function distillPeerAdditionPriceBenchmark(
  snaps: PeerMenuSnapshot[],
): PeerAdditionPriceBenchmark {
  type Acc = {
    displayVotes: Map<string, number>;
    prices: number[];
  };
  const byKey = new Map<string, Acc>();
  const ekstraPrices: number[] = [];
  const dipPrices: number[] = [];
  const hosts = snaps.map((s) => s.host);

  for (const snap of snaps) {
    for (const p of snap.products) {
      for (const a of p.additions ?? []) {
        const key = normalizePeerAdditionKey(a.name);
        if (!key) continue;
        if (typeof a.priceOre !== "number" || a.priceOre <= 0) continue;

        let acc = byKey.get(key);
        if (!acc) {
          acc = { displayVotes: new Map(), prices: [] };
          byKey.set(key, acc);
        }
        const disp =
          a.name.replace(/\s*\([^)]*\)\s*/g, " ").trim() || a.name;
        acc.displayVotes.set(disp, (acc.displayVotes.get(disp) ?? 0) + 1);
        acc.prices.push(a.priceOre);

        if (isDipLikeAddition(key) || isDipLikeAddition(disp)) {
          dipPrices.push(a.priceOre);
        } else {
          ekstraPrices.push(a.priceOre);
        }
      }
    }
  }

  const byNameKey: Record<string, PeerAdditionPriceEntry> = {};
  for (const [nameKey, acc] of byKey) {
    const med = median(acc.prices);
    if (med == null) continue;
    let displayName = nameKey;
    let best = 0;
    for (const [d, v] of acc.displayVotes) {
      if (v > best) {
        best = v;
        displayName = d;
      }
    }
    byNameKey[nameKey] = {
      nameKey,
      displayName,
      medianOre: med,
      samples: acc.prices.length,
      isDip: isDipLikeAddition(nameKey) || isDipLikeAddition(displayName),
    };
  }

  const ekstraMedianOre =
    median(ekstraPrices) ?? DEFAULT_EKSTRA_PRICE_ORE;
  const dipMedianOre = median(dipPrices) ?? DEFAULT_EKSTRA_PRICE_ORE;

  const fingerprint = [
    "peer-add-price",
    `n${Object.keys(byNameKey).length}`,
    `e${ekstraMedianOre}`,
    `d${dipMedianOre}`,
    hosts.slice().sort().join(","),
  ].join("|");

  return {
    restaurantsAnalyzed: snaps.length,
    hosts,
    byNameKey,
    ekstraMedianOre,
    dipMedianOre,
    fingerprint,
  };
}

export function lookupPeerAdditionPrice(
  benchmark: PeerAdditionPriceBenchmark | null | undefined,
  name: string,
): { priceOre: number; source: PeerPriceSource; samples: number } {
  const key = normalizePeerAdditionKey(name) || normalizeAdditionName(name);
  const isDip = isDipLikeAddition(name) || isDipLikeAddition(key);

  if (benchmark) {
    const hit = benchmark.byNameKey[key];
    if (hit) {
      return {
        priceOre: hit.medianOre,
        source: "PEER_NAME_MEDIAN",
        samples: hit.samples,
      };
    }
    if (isDip) {
      return {
        priceOre: benchmark.dipMedianOre,
        source: "PEER_DIP_MEDIAN",
        samples: 0,
      };
    }
    return {
      priceOre: benchmark.ekstraMedianOre,
      source: "PEER_EKSTRA_MEDIAN",
      samples: 0,
    };
  }

  return {
    priceOre: defaultTilbehorPriceOre(name) || DEFAULT_EKSTRA_PRICE_ORE,
    source: "DEFAULT_10KR",
    samples: 0,
  };
}

/**
 * Fill missing / zero addition prices on the canonical menu from peer benchmark.
 * Does not invent names — only prices. Leaves positive source prices untouched.
 */
export function applyPeerAdditionPricesToMenu(input: {
  menu: CanonicalMenu;
  benchmark: PeerAdditionPriceBenchmark | null | undefined;
}): {
  menu: CanonicalMenu;
  priced: Array<{
    menuNumber: string | null;
    sourceId: string;
    name: string;
    priceOre: number;
    source: PeerPriceSource;
  }>;
} {
  const priced: Array<{
    menuNumber: string | null;
    sourceId: string;
    name: string;
    priceOre: number;
    source: PeerPriceSource;
  }> = [];

  if (!input.benchmark) {
    return { menu: input.menu, priced };
  }

  const categories = input.menu.categories.map((cat) => ({
    ...cat,
    products: cat.products.map((p) => {
      const addOns = p.addOns ?? [];
      if (!addOns.length) return p;
      let changed = false;
      const next = addOns.map((a) => {
        if (typeof a.price === "number" && a.price > 0) return a;
        const look = lookupPeerAdditionPrice(input.benchmark, a.name);
        changed = true;
        priced.push({
          menuNumber: p.sourceMenuNumber ?? p.assignedMenuNumber ?? null,
          sourceId: p.sourceId,
          name: a.name,
          priceOre: look.priceOre,
          source: look.source,
        });
        return {
          ...a,
          price: look.priceOre,
          origin: "DERIVED" as const,
        };
      });
      return changed ? { ...p, addOns: next } : p;
    }),
  }));

  return {
    menu: { ...input.menu, categories },
    priced,
  };
}
