/**
 * Per-addition likelihood P(nameKey | product_kind) from peer menus.
 * Used to propose RESTAURANT_CATEGORY BUSINESS_FACTs (not blind copy of one peer).
 */

import { normalizeAdditionName } from "../decisions/facts.js";
import type { DecisionStore } from "../decisions/store.js";
import type { AdditionSetFact } from "../decisions/facts.js";
import type { CanonicalMenu } from "../domain/schema/canonical.js";
import {
  ALL_KINDS,
  PROB_THRESHOLDS,
  classifyProductKind,
  isDipAddition,
  type ProductKind,
} from "./categoryLikelihood.js";
import type { PeerMenuSnapshot } from "./peerMenuStructure.js";

export type AdditionNameStat = {
  kind: ProductKind;
  nameKey: string;
  displayName: string;
  nProductsInKind: number;
  kWithAddition: number;
  pHat: number;
  pSmooth: number;
  medianPriceOre: number | null;
  decision: "ALLOW" | "DENY" | "UNCERTAIN";
  isDip: boolean;
};

export type KindAdditionProposal = {
  kind: ProductKind;
  additions: Array<{
    name: string;
    nameKey: string;
    priceOre: number;
    pHat: number;
    support: number;
    isDip: boolean;
  }>;
};

export type AdditionLikelihoodPolicy = {
  restaurantsAnalyzed: number;
  hosts: string[];
  thresholds: typeof PROB_THRESHOLDS;
  /** Per-kind ranked stats (ALLOW first, then by pHat). */
  byKind: Partial<Record<ProductKind, AdditionNameStat[]>>;
  /** Ready-to-apply sets (non-empty ALLOW only; dips separated by kind policy). */
  proposedSets: KindAdditionProposal[];
  fingerprint: string;
  rules: string[];
};

/** Strip size suffixes so Alm/Familie peer rows collapse to one key. */
export function normalizePeerAdditionKey(name: string): string {
  let n = normalizeAdditionName(name);
  n = n
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+fam\.?$/i, "")
    .replace(/\s+familie$/i, "")
    .replace(/\s+alm\.?$/i, "")
    .replace(/\s+deep$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return n;
}

export function isDipLikeAddition(name: string): boolean {
  if (isDipAddition(name)) return true;
  return /\b(bearnaise|dressing|bager chili|baeger|bæger|tomatsauce i|currydressing|hvidlogs|hvidløgsdressing|karrydressing)\b/i.test(
    name,
  );
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? Math.round((s[mid - 1]! + s[mid]!) / 2)
    : s[mid]!;
}

function decideRate(
  k: number,
  n: number,
): { pHat: number; pSmooth: number; decision: AdditionNameStat["decision"] } {
  const pHat = n > 0 ? k / n : 0;
  const pSmooth = (k + 1) / (n + 2);
  if (n < PROB_THRESHOLDS.minSupport) {
    return { pHat, pSmooth, decision: "UNCERTAIN" };
  }
  if (pSmooth >= PROB_THRESHOLDS.allowMin) {
    return { pHat, pSmooth, decision: "ALLOW" };
  }
  if (pSmooth <= PROB_THRESHOLDS.denyMax) {
    return { pHat, pSmooth, decision: "DENY" };
  }
  return { pHat, pSmooth, decision: "UNCERTAIN" };
}

const MAX_PROPOSED_PER_KIND = 40;

/**
 * Distill per-addition frequencies by product kind across peer snapshots.
 */
export function distillAdditionLikelihood(
  snaps: PeerMenuSnapshot[],
): AdditionLikelihoodPolicy {
  const hosts = snaps.map((s) => s.host);
  type Acc = {
    displayVotes: Map<string, number>;
    prices: number[];
    k: number;
  };
  const kindProductCount = new Map<ProductKind, number>();
  const kindNameAcc = new Map<ProductKind, Map<string, Acc>>();

  for (const kind of ALL_KINDS) {
    kindProductCount.set(kind, 0);
    kindNameAcc.set(kind, new Map());
  }

  for (const snap of snaps) {
    for (const p of snap.products) {
      const kind = classifyProductKind({
        name: p.name,
        ...(p.categoryNames ? { categoryNames: p.categoryNames } : {}),
      });
      kindProductCount.set(kind, (kindProductCount.get(kind) ?? 0) + 1);
      const seen = new Set<string>();
      for (const a of p.additions ?? []) {
        const key = normalizePeerAdditionKey(a.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const byName = kindNameAcc.get(kind)!;
        let acc = byName.get(key);
        if (!acc) {
          acc = { displayVotes: new Map(), prices: [], k: 0 };
          byName.set(key, acc);
        }
        acc.k += 1;
        const disp = a.name.replace(/\s*\([^)]*\)\s*/g, " ").trim() || a.name;
        acc.displayVotes.set(disp, (acc.displayVotes.get(disp) ?? 0) + 1);
        if (typeof a.priceOre === "number" && a.priceOre > 0) {
          acc.prices.push(a.priceOre);
        }
      }
    }
  }

  const byKind: Partial<Record<ProductKind, AdditionNameStat[]>> = {};
  const proposedSets: KindAdditionProposal[] = [];
  const rules: string[] = [
    `Per-addition P(name|kind) with thresholds allow≥${PROB_THRESHOLDS.allowMin} deny≤${PROB_THRESHOLDS.denyMax} minSupport=${PROB_THRESHOLDS.minSupport}`,
    "Pizza/pasta: propose non-dip ALLOW additions as category BUSINESS_FACT",
    "Dips remain kind-gated (finger_food / menu_with_fries only)",
  ];

  for (const kind of ALL_KINDS) {
    const n = kindProductCount.get(kind) ?? 0;
    const stats: AdditionNameStat[] = [];
    for (const [nameKey, acc] of kindNameAcc.get(kind) ?? []) {
      const { pHat, pSmooth, decision } = decideRate(acc.k, n);
      let displayName = nameKey;
      let bestVote = 0;
      for (const [d, v] of acc.displayVotes) {
        if (v > bestVote) {
          bestVote = v;
          displayName = d;
        }
      }
      // Title-case-ish: keep peer display if available
      stats.push({
        kind,
        nameKey,
        displayName,
        nProductsInKind: n,
        kWithAddition: acc.k,
        pHat,
        pSmooth,
        medianPriceOre: median(acc.prices),
        decision,
        isDip: isDipLikeAddition(displayName) || isDipLikeAddition(nameKey),
      });
    }
    stats.sort((a, b) => {
      if (a.decision === "ALLOW" && b.decision !== "ALLOW") return -1;
      if (b.decision === "ALLOW" && a.decision !== "ALLOW") return 1;
      return b.pHat - a.pHat || b.kWithAddition - a.kWithAddition;
    });
    byKind[kind] = stats;

    const allowNonDip = stats
      .filter((s) => s.decision === "ALLOW" && !s.isDip)
      .slice(0, MAX_PROPOSED_PER_KIND);
    const allowDip = stats
      .filter((s) => s.decision === "ALLOW" && s.isDip)
      .slice(0, 12);

    if (kind === "finger_food" || kind === "menu_with_fries") {
      const dips = allowDip.map((s) => ({
        name: s.displayName,
        nameKey: s.nameKey,
        priceOre: s.medianPriceOre ?? 1000,
        pHat: s.pHat,
        support: s.kWithAddition,
        isDip: true,
      }));
      if (dips.length) {
        proposedSets.push({ kind, additions: dips });
        rules.push(
          `${kind}: propose ${dips.length} dip Tilbehør (top ${dips[0]?.name})`,
        );
      }
    } else if (
      kind === "pizza" ||
      kind === "pasta" ||
      kind === "indian" ||
      kind === "nachos" ||
      kind === "sandwich_grill"
    ) {
      const extras = allowNonDip.map((s) => ({
        name: s.displayName,
        nameKey: s.nameKey,
        priceOre: s.medianPriceOre ?? 1500,
        pHat: s.pHat,
        support: s.kWithAddition,
        isDip: false,
      }));
      if (extras.length) {
        proposedSets.push({ kind, additions: extras });
        rules.push(
          `${kind}: propose ${extras.length} ekstra additions (excl. dips)`,
        );
      }
    }
  }

  const fingerprint = [
    "addlik",
    `th${PROB_THRESHOLDS.allowMin}-${PROB_THRESHOLDS.denyMax}`,
    proposedSets
      .map((p) => `${p.kind}:${p.additions.length}`)
      .sort()
      .join(","),
  ].join("|");

  return {
    restaurantsAnalyzed: snaps.length,
    hosts,
    thresholds: PROB_THRESHOLDS,
    byKind,
    proposedSets,
    fingerprint,
    rules,
  };
}

export function proposalForKind(
  policy: AdditionLikelihoodPolicy,
  kind: ProductKind,
): KindAdditionProposal | null {
  return policy.proposedSets.find((p) => p.kind === kind) ?? null;
}

function categoryKindHint(categoryName: string): ProductKind | null {
  const k = classifyProductKind({
    name: categoryName,
    categoryNames: [categoryName],
  });
  if (k === "other") return null;
  return k;
}

function dominantProductKind(
  products: CanonicalMenu["categories"][0]["products"],
  categoryName: string,
): ProductKind {
  const counts = new Map<ProductKind, number>();
  for (const p of products) {
    const kind = classifyProductKind({
      name: p.name,
      categoryNames: [categoryName],
      ...(p.description ? { description: p.description } : {}),
    });
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best: ProductKind = categoryKindHint(categoryName) ?? "other";
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/**
 * Upsert RESTAURANT_CATEGORY BUSINESS_FACTs from peer addition likelihood
 * onto categories of this restaurant's canonical menu.
 */
export function upsertPeerAdditionFactsForMenu(input: {
  store: DecisionStore;
  restaurantKey: string;
  menu: CanonicalMenu;
  likelihood: AdditionLikelihoodPolicy;
  /** Skip categories that already have a non-empty category-ingredient union. */
  skipCategories?: string[] | Set<string>;
}): {
  facts: AdditionSetFact[];
  categories: Array<{ category: string; kind: ProductKind; count: number }>;
} {
  const facts: AdditionSetFact[] = [];
  const categories: Array<{
    category: string;
    kind: ProductKind;
    count: number;
  }> = [];
  const skip = new Set(input.skipCategories ?? []);

  for (const cat of input.menu.categories) {
    if (skip.has(cat.name)) continue;
    const kind = dominantProductKind(cat.products, cat.name);
    const proposal = proposalForKind(input.likelihood, kind);
    if (!proposal?.additions.length) continue;

    // Pizza/pasta: never inject dips via category fact
    const additions = proposal.additions.filter((a) => {
      if (kind === "pizza" || kind === "pasta" || kind === "indian") {
        return !a.isDip;
      }
      return true;
    });
    if (!additions.length) continue;

    const factId = `addset_peer_${kind}_${input.restaurantKey}_${normalizeAdditionName(cat.name).replace(/\s+/g, "-")}`;
    const existing = input.store.facts
      .listActiveAdditionSets(input.restaurantKey)
      .find((f) => f.factId === factId);

    const payload = additions.map((a) => ({
      additionId: `add_${a.nameKey.replace(/\s+/g, "-")}`,
      name: a.name,
      nameKey: a.nameKey,
      priceMinor: a.priceOre,
      currency: "DKK" as const,
      required: false,
      minSelections: null,
      maxSelections: null,
      origin: "LEARNED_POLICY" as const,
    }));

    const sig = payload.map((p) => `${p.nameKey}:${p.priceMinor}`).join("|");
    const existingSig = existing
      ? existing.additions.map((a) => `${a.nameKey}:${a.priceMinor}`).join("|")
      : "";
    if (existing && existingSig === sig) {
      facts.push(existing);
      categories.push({ category: cat.name, kind, count: payload.length });
      continue;
    }

    const nextVersion = existing ? existing.factVersion + 1 : 1;
    if (existing) {
      input.store.facts.insertAdditionSet({
        ...existing,
        factVersion: nextVersion,
        status: "SUPERSEDED",
        createdAt: new Date().toISOString(),
      });
    }

    const fact: AdditionSetFact = {
      factId,
      factVersion: existing ? nextVersion + 1 : 1,
      restaurantKey: input.restaurantKey,
      sourceCategory: cat.name,
      destinationCategoryId: null,
      scope: "RESTAURANT_CATEGORY",
      additions: payload,
      excludedSourceIds: [],
      excludedMenuNumbers: [],
      humanDecisionId: null,
      knowledgeKind: "BUSINESS_FACT",
      supersedesFactId: existing?.factId ?? null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      originalOperatorText: `Peer addition likelihood (${kind}) from ${input.likelihood.hosts.join(",")}`,
      evidenceJson: JSON.stringify({
        kind,
        fingerprint: input.likelihood.fingerprint,
        support: additions.map((a) => ({
          name: a.name,
          pHat: a.pHat,
          support: a.support,
        })),
      }),
    };
    input.store.facts.insertAdditionSet(fact);
    facts.push(fact);
    categories.push({ category: cat.name, kind, count: payload.length });
  }

  return { facts, categories };
}
