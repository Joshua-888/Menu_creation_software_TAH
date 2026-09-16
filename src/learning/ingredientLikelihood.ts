/**
 * Peer ingredient + beskrivelse likelihood.
 *
 * Distills P(ingredient | product_kind) and P(ingredient | burger_subtype)
 * from peer menucards so QA/Create can fill thin Grill/burger cards from
 * peer consensus — not one-off invention. Hardcoded burger baseline remains
 * the fallback prior when peers lack support.
 *
 * SEMANTIC_RULE knowledge: which tokens commonly appear on a kind.
 * Never copies peer prices. Never invents when neither peers nor prior exist.
 */

import { formatProductName } from "../domain/textNormalize.js";
import {
  ALL_KINDS,
  PROB_THRESHOLDS,
  classifyProductKind,
  isDipAddition,
  type ProductKind,
} from "./categoryLikelihood.js";
import { normalizePeerAdditionKey } from "./additionLikelihood.js";
import type { PeerMenuSnapshot } from "./peerMenuStructure.js";

export type BurgerSubtype =
  | "baconburger"
  | "cheeseburger"
  | "cafeteriaburger"
  | "burger"
  | "fries_plate"
  | "other";

export type IngredientNameStat = {
  key: string;
  displayName: string;
  nProducts: number;
  kWithIngredient: number;
  pHat: number;
  pSmooth: number;
  decision: "ALLOW" | "DENY" | "UNCERTAIN";
};

export type IngredientLikelihoodBucket = {
  id: string;
  /** kind or subtype label for reports */
  label: string;
  nProducts: number;
  ingredients: IngredientNameStat[];
  /** Peer beskrivelse samples that look like ingredient lists (for audit). */
  descriptionSamples: string[];
};

export type IngredientLikelihoodPolicy = {
  restaurantsAnalyzed: number;
  hosts: string[];
  thresholds: typeof PROB_THRESHOLDS;
  byKind: Partial<Record<ProductKind, IngredientLikelihoodBucket>>;
  bySubtype: Partial<Record<BurgerSubtype, IngredientLikelihoodBucket>>;
  fingerprint: string;
  rules: string[];
};

function decideRate(
  k: number,
  n: number,
): { pHat: number; pSmooth: number; decision: IngredientNameStat["decision"] } {
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

/** Collapse peer ingredient display names for counting. */
export function normalizePeerIngredientKey(name: string): string {
  return normalizePeerAdditionKey(name);
}

export function classifyBurgerSubtype(name: string): BurgerSubtype {
  const n = name.trim();
  if (/bacon/i.test(n) && /burger|smash/i.test(n)) return "baconburger";
  if (/(cheese|ost)/i.test(n) && /burger|smash/i.test(n)) return "cheeseburger";
  if (/cafeteria/i.test(n) || (/hjemmelavet/i.test(n) && /burger/i.test(n))) {
    return "cafeteriaburger";
  }
  // Smash / named grilled sandwiches share the generic burger peer bucket
  if (/burger|smash/i.test(n)) return "burger";
  if (/\b(pommes|frites|nuggets?)\b/i.test(n)) return "fries_plate";
  return "other";
}

function looksLikeIngredientDescription(desc: string): boolean {
  const d = desc.trim();
  if (d.length < 8) return false;
  if (!/,/.test(d) && !/\bog\b/i.test(d)) return false;
  // Reject pure marketing fluff
  if (/fødselsdag|møde eller lign/i.test(d)) return false;
  return true;
}

type Acc = {
  displayVotes: Map<string, number>;
  k: number;
};

function bumpAcc(map: Map<string, Acc>, key: string, display: string): void {
  let acc = map.get(key);
  if (!acc) {
    acc = { displayVotes: new Map(), k: 0 };
    map.set(key, acc);
  }
  acc.k += 1;
  acc.displayVotes.set(display, (acc.displayVotes.get(display) ?? 0) + 1);
}

function pickDisplay(acc: Acc, key: string): string {
  let best = key;
  let votes = -1;
  for (const [d, v] of acc.displayVotes) {
    if (v > votes) {
      votes = v;
      best = d;
    }
  }
  return formatProductName(best) || best;
}

function finalizeBucket(
  id: string,
  label: string,
  nProducts: number,
  nameAcc: Map<string, Acc>,
  descriptionSamples: string[],
): IngredientLikelihoodBucket {
  const ingredients: IngredientNameStat[] = [];
  for (const [key, acc] of nameAcc) {
    const rate = decideRate(acc.k, nProducts);
    ingredients.push({
      key,
      displayName: pickDisplay(acc, key),
      nProducts,
      kWithIngredient: acc.k,
      pHat: rate.pHat,
      pSmooth: rate.pSmooth,
      decision: rate.decision,
    });
  }
  ingredients.sort((a, b) => {
    if (a.decision !== b.decision) {
      const order = { ALLOW: 0, UNCERTAIN: 1, DENY: 2 } as const;
      return order[a.decision] - order[b.decision];
    }
    return b.pHat - a.pHat || a.displayName.localeCompare(b.displayName, "da");
  });
  return {
    id,
    label,
    nProducts,
    ingredients,
    descriptionSamples: descriptionSamples.slice(0, 8),
  };
}

/**
 * Distill peer ingredient frequencies by product kind and burger subtype.
 */
export function distillIngredientLikelihood(
  snaps: PeerMenuSnapshot[],
): IngredientLikelihoodPolicy {
  const hosts = snaps.map((s) => s.host);
  const kindCount = new Map<ProductKind, number>();
  const kindAcc = new Map<ProductKind, Map<string, Acc>>();
  const kindDescs = new Map<ProductKind, string[]>();
  const subtypeCount = new Map<BurgerSubtype, number>();
  const subtypeAcc = new Map<BurgerSubtype, Map<string, Acc>>();
  const subtypeDescs = new Map<BurgerSubtype, string[]>();

  for (const snap of snaps) {
    for (const p of snap.products) {
      const ings = (p.ingredients ?? [])
        .map((x) => x.trim())
        .filter(Boolean);
      // Need a real card list to learn from
      if (ings.length < 2) continue;

      const kind = classifyProductKind({
        name: p.name,
        ...(p.categoryNames ? { categoryNames: p.categoryNames } : {}),
        ...(p.description ? { description: p.description } : {}),
      });
      kindCount.set(kind, (kindCount.get(kind) ?? 0) + 1);
      if (!kindAcc.has(kind)) kindAcc.set(kind, new Map());
      const kMap = kindAcc.get(kind)!;
      for (const raw of ings) {
        if (isDipAddition(raw) && kind === "pizza") continue; // dips stay Tilbehør on pizza
        const key = normalizePeerIngredientKey(raw);
        if (!key || key.length < 2) continue;
        bumpAcc(kMap, key, raw);
      }
      const desc = (p.description ?? "").trim();
      if (looksLikeIngredientDescription(desc)) {
        const samples = kindDescs.get(kind) ?? [];
        if (samples.length < 12) {
          samples.push(desc);
          kindDescs.set(kind, samples);
        }
      }

      const subtype = classifyBurgerSubtype(p.name);
      if (subtype === "other" && kind !== "sandwich_grill" && kind !== "finger_food") {
        continue;
      }
      const st = subtype === "other" ? null : subtype;
      if (!st) continue;
      subtypeCount.set(st, (subtypeCount.get(st) ?? 0) + 1);
      if (!subtypeAcc.has(st)) subtypeAcc.set(st, new Map());
      const sMap = subtypeAcc.get(st)!;
      for (const raw of ings) {
        const key = normalizePeerIngredientKey(raw);
        if (!key || key.length < 2) continue;
        bumpAcc(sMap, key, raw);
      }
      if (looksLikeIngredientDescription(desc)) {
        const samples = subtypeDescs.get(st) ?? [];
        if (samples.length < 12) {
          samples.push(desc);
          subtypeDescs.set(st, samples);
        }
      }
    }
  }

  const byKind: IngredientLikelihoodPolicy["byKind"] = {};
  for (const kind of ALL_KINDS) {
    const n = kindCount.get(kind) ?? 0;
    if (n === 0) continue;
    byKind[kind] = finalizeBucket(
      `kind:${kind}`,
      kind,
      n,
      kindAcc.get(kind) ?? new Map(),
      kindDescs.get(kind) ?? [],
    );
  }

  const bySubtype: IngredientLikelihoodPolicy["bySubtype"] = {};
  for (const st of [
    "baconburger",
    "cheeseburger",
    "cafeteriaburger",
    "burger",
    "fries_plate",
  ] as BurgerSubtype[]) {
    const n = subtypeCount.get(st) ?? 0;
    if (n === 0) continue;
    bySubtype[st] = finalizeBucket(
      `subtype:${st}`,
      st,
      n,
      subtypeAcc.get(st) ?? new Map(),
      subtypeDescs.get(st) ?? [],
    );
  }

  const rules: string[] = [
    `Peer ingredient likelihood: ALLOW when pSmooth>=${PROB_THRESHOLDS.allowMin} (min n=${PROB_THRESHOLDS.minSupport})`,
    `Buckets: kinds=${Object.keys(byKind).length}, subtypes=${Object.keys(bySubtype).length}`,
    `Fallback prior: domain grillCardFill burger baseline when peer support missing`,
  ];
  for (const [st, bucket] of Object.entries(bySubtype)) {
    const allow = bucket!.ingredients.filter((i) => i.decision === "ALLOW");
    rules.push(
      `subtype ${st}: n=${bucket!.nProducts} ALLOW=${allow.length} top=${allow
        .slice(0, 5)
        .map((a) => a.displayName)
        .join(",")}`,
    );
  }

  const fingerprint = [
    "inglik",
    `th${PROB_THRESHOLDS.allowMin}-${PROB_THRESHOLDS.denyMax}`,
    Object.keys(byKind).sort().join("+"),
    Object.keys(bySubtype).sort().join("+"),
  ].join("|");

  return {
    restaurantsAnalyzed: snaps.length,
    hosts,
    thresholds: PROB_THRESHOLDS,
    byKind,
    bySubtype,
    fingerprint,
    rules,
  };
}

const MAX_CARD_INGREDIENTS = 12;

/**
 * Resolve card ingredients for a product: peer subtype → peer kind → null.
 * Caller applies domain fallback when null/empty.
 */
export function proposePeerIngredients(input: {
  name: string;
  categoryNames?: string[];
  description?: string;
  policy: IngredientLikelihoodPolicy | null | undefined;
}): {
  ingredients: string[];
  description: string | null;
  source: "PEER_SUBTYPE" | "PEER_KIND" | "NONE";
  bucketId: string | null;
} {
  if (!input.policy) {
    return {
      ingredients: [],
      description: null,
      source: "NONE",
      bucketId: null,
    };
  }
  const subtype = classifyBurgerSubtype(input.name);
  const kind = classifyProductKind({
    name: input.name,
    ...(input.categoryNames ? { categoryNames: input.categoryNames } : {}),
    ...(input.description ? { description: input.description } : {}),
  });

  const tryBucket = (
    bucket: IngredientLikelihoodBucket | undefined,
    source: "PEER_SUBTYPE" | "PEER_KIND",
  ) => {
    if (!bucket || bucket.nProducts < PROB_THRESHOLDS.minSupport) return null;
    const allow = bucket.ingredients
      .filter((i) => i.decision === "ALLOW")
      .slice(0, MAX_CARD_INGREDIENTS)
      .map((i) => i.displayName);
    if (allow.length < 2) return null;
    const descSample =
      bucket.descriptionSamples.find((d) =>
        looksLikeIngredientDescription(d),
      ) ?? null;
    return {
      ingredients: allow,
      description: descSample ?? allow.join(", "),
      source,
      bucketId: bucket.id,
    };
  };

  if (subtype !== "other") {
    const hit = tryBucket(input.policy.bySubtype[subtype], "PEER_SUBTYPE");
    if (hit) return hit;
  }
  // Burgers without subtype hit still try sandwich_grill kind
  if (
    subtype === "baconburger" ||
    subtype === "cheeseburger" ||
    subtype === "cafeteriaburger" ||
    subtype === "burger"
  ) {
    const hit = tryBucket(
      input.policy.byKind.sandwich_grill,
      "PEER_KIND",
    );
    if (hit) return hit;
  }
  if (subtype === "fries_plate") {
    const hit = tryBucket(input.policy.byKind.finger_food, "PEER_KIND");
    if (hit) return hit;
  }
  const kindHit = tryBucket(input.policy.byKind[kind], "PEER_KIND");
  if (kindHit) return kindHit;

  return {
    ingredients: [],
    description: null,
    source: "NONE",
    bucketId: null,
  };
}
