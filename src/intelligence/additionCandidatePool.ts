/**
 * Addition candidate-pool resolver (Semantic Completeness Engine V1 — WP3).
 *
 * Defect this module fixes — "first non-empty source wins":
 *   - `decisions/precedence.ts` used `sets.find(scope === "RESTAURANT_CATEGORY")`
 *     and returned the FIRST matching set (the category-ingredient union), so peer
 *     category statistics never contributed additional candidates.
 *   - `planning/structureMapping.ts` `fanOutRestaurantAdditions` stopped as soon as
 *     ANY additions existed.
 *   - `intelligence/completeProductCard.ts` only ran domain-prior inference when
 *     `additions.length === 0` — never when the set was non-empty but sparse.
 *
 * This module COLLECTS candidates from every available evidence source, tiers them
 * with the shared {@link SemanticProvenanceTier} hierarchy, applies the EXISTING
 * semantic exclusion rules (never a second business engine), and resolves a final
 * natural set — supplementing a sparse higher-tier set with lower-tier evidence
 * instead of locking it out.
 *
 * It is deliberately pure: callers pass whatever evidence they have (facts, peer
 * statistics, domain priors, source addOns). No I/O, no menu/business invention.
 */

import type { ProductFamily, SemanticProvenanceTier } from "./types.js";
import { classifyPhrase, isInvalidAdditionEntity } from "./semanticClassifier.js";
import { isForbiddenTilbehorName } from "../domain/menuCardQuality.js";
import { normalizeAdditionName } from "../decisions/facts.js";
import {
  isDipAddition,
  isMeatAddition,
  isVegetarianContext,
  type ProductKind,
} from "../learning/categoryLikelihood.js";
import {
  lookupPeerAdditionPrice,
  type PeerAdditionPriceBenchmark,
} from "../learning/peerAdditionPriceBenchmark.js";

/** Where a resolved addition price came from (never an invented constant). */
export type AdditionPriceSource =
  | "SOURCE"
  | "FACT"
  | "PEER_NAME_MEDIAN"
  | "PEER_MEDIAN"
  | "DOMAIN_PRIOR"
  | "UNRESOLVED";

/** One candidate addition gathered from a single evidence source. */
export type AdditionCandidate = {
  name: string;
  /** normalizeAdditionName(name) — identity key for dedupe. */
  nameKey: string;
  /** Resolved price in øre, or null when no trustworthy price exists. */
  priceOre: number | null;
  tier: SemanticProvenanceTier;
  /** Provenance of `priceOre`. */
  priceSource: AdditionPriceSource;
  supportCount?: number;
};

export type AdditionCandidateInput = {
  name: string;
  priceOre?: number | null;
  supportCount?: number;
};

export type AdditionCandidatePoolContext = {
  productName: string;
  categoryName: string;
  description?: string;
  family: ProductFamily;
  kind?: ProductKind | null;
  isCombo?: boolean;
  /** True when dips are legitimate for this product (finger food / fries menu). */
  wantsDips?: boolean;
  /**
   * When true, dips are dropped unless `wantsDips`. Default false preserves the
   * existing pipeline behavior where a caller has already placed dips.
   */
  enforceDipContext?: boolean;
};

export type AdditionCandidatePoolInput = AdditionCandidatePoolContext & {
  sourceAdditions?: readonly AdditionCandidateInput[];
  exactProductAdditions?: readonly AdditionCandidateInput[];
  restaurantAdditions?: readonly AdditionCandidateInput[];
  categoryIngredientAdditions?: readonly AdditionCandidateInput[];
  peerCategoryAdditions?: readonly AdditionCandidateInput[];
  peerFamilyAdditions?: readonly AdditionCandidateInput[];
  domainPriorAdditions?: readonly AdditionCandidateInput[];
  peerPriceBenchmark?: PeerAdditionPriceBenchmark | null;
};

const TIER_RANK: Record<SemanticProvenanceTier, number> = {
  SOURCE: 8,
  EXACT_PRODUCT_FACT: 7,
  RESTAURANT_FACT: 6,
  CATEGORY_EVIDENCE: 5,
  PEER_SUBTYPE: 4,
  PEER_FAMILY: 3,
  GLOBAL_POLICY: 2,
  DOMAIN_PRIOR: 1,
  UNRESOLVED: 0,
};

/** Authoritative tiers — always kept, never dropped by supplementation. */
const AUTHORITATIVE_TIERS: readonly SemanticProvenanceTier[] = [
  "SOURCE",
  "EXACT_PRODUCT_FACT",
  "RESTAURANT_FACT",
];

/** Supplemental tiers — applied in order only while the set is insufficient. */
const SUPPLEMENTAL_TIERS: readonly SemanticProvenanceTier[] = [
  "CATEGORY_EVIDENCE",
  "PEER_SUBTYPE",
  "PEER_FAMILY",
  "GLOBAL_POLICY",
  "DOMAIN_PRIOR",
];

/**
 * Minimum number of evidence-backed natural (non-dip) additions before a set is
 * considered sufficient for the family. Below this bar the resolver keeps pulling
 * lower-ranked tiers instead of stopping at the first non-empty set.
 */
const FAMILY_MIN_EVIDENCE_ADDITIONS: Partial<Record<ProductFamily, number>> = {
  BURGER: 3,
  BACON_BURGER: 3,
  CHEESE_BURGER: 3,
  SANDWICH: 2,
  DURUM: 2,
  PITA: 2,
  FRIES: 2,
  NACHOS: 2,
  PIZZA: 2,
  SALATPIZZA: 2,
  CALZONE: 2,
  PASTA: 2,
  INDIAN_MAIN: 2,
  OTHER_FOOD: 1,
};

/**
 * Resolve a price for a candidate name without inventing an arbitrary constant.
 *
 * Tier order (Semantic Completeness Engine V1, WP3):
 *   1. peer name median → peer dip/ekstra median (real peer evidence),
 *   2. explicitly supplied conservative DOMAIN_PRIOR price (caller-provided; the
 *      mission's authorized "tier 9 conservative domain prior"),
 *   3. UNRESOLVED (null) — never a fabricated constant and never 0.
 *
 * A DOMAIN_PRIOR result is tagged `source: "DOMAIN_PRIOR"` so WP5's QualityContract
 * can distinguish an evidence-backed price from a reviewable domain-prior default.
 */
export function resolveAdditionPrice(input: {
  name: string;
  benchmark?: PeerAdditionPriceBenchmark | null;
  /** Explicit conservative domain-prior price (øre) for this name, if any. */
  domainPriorPriceOre?: number | null;
}): { priceOre: number | null; source: AdditionPriceSource } {
  const look = lookupPeerAdditionPrice(input.benchmark ?? null, input.name);
  if (look.priceOre != null && look.source !== "UNRESOLVED") {
    return {
      priceOre: look.priceOre,
      source:
        look.source === "PEER_NAME_MEDIAN" ? "PEER_NAME_MEDIAN" : "PEER_MEDIAN",
    };
  }
  // Peer tier exhausted. Apply the conservative domain prior only when supplied.
  if (input.domainPriorPriceOre != null && input.domainPriorPriceOre > 0) {
    return { priceOre: input.domainPriorPriceOre, source: "DOMAIN_PRIOR" };
  }
  return { priceOre: null, source: "UNRESOLVED" };
}

/**
 * Collect (never pick-first) candidate additions from every evidence source.
 * The result preserves every source; `resolveAdditionCandidates` decides the set.
 */
export function buildAdditionCandidatePool(
  input: AdditionCandidatePoolInput,
): AdditionCandidate[] {
  const out: AdditionCandidate[] = [];
  const benchmark = input.peerPriceBenchmark ?? null;

  const collect = (
    additions: readonly AdditionCandidateInput[] | undefined,
    tier: SemanticProvenanceTier,
    explicitSource: AdditionPriceSource,
  ): void => {
    for (const a of additions ?? []) {
      const name = (a.name ?? "").trim();
      if (!name) continue;
      const nameKey = normalizeAdditionName(name);
      if (!nameKey) continue;
      let priceOre: number | null;
      let priceSource: AdditionPriceSource;
      if (a.priceOre != null && a.priceOre > 0) {
        priceOre = a.priceOre;
        priceSource = explicitSource;
      } else {
        const resolved = resolveAdditionPrice({ name, benchmark });
        priceOre = resolved.priceOre;
        priceSource = resolved.source;
      }
      const candidate: AdditionCandidate = {
        name,
        nameKey,
        priceOre,
        tier,
        priceSource,
      };
      if (a.supportCount != null) candidate.supportCount = a.supportCount;
      out.push(candidate);
    }
  };

  collect(input.sourceAdditions, "SOURCE", "SOURCE");
  collect(input.exactProductAdditions, "EXACT_PRODUCT_FACT", "FACT");
  collect(input.restaurantAdditions, "RESTAURANT_FACT", "FACT");
  collect(input.categoryIngredientAdditions, "CATEGORY_EVIDENCE", "FACT");
  collect(input.peerCategoryAdditions, "PEER_SUBTYPE", "PEER_MEDIAN");
  collect(input.peerFamilyAdditions, "PEER_FAMILY", "PEER_MEDIAN");
  collect(input.domainPriorAdditions, "DOMAIN_PRIOR", "DOMAIN_PRIOR");

  return out;
}

export type AdditionRejection = { candidate: AdditionCandidate; reason: string };

/** Apply the EXISTING semantic exclusion rules to one candidate. */
function exclusionReason(
  candidate: AdditionCandidate,
  context: AdditionCandidatePoolContext,
  vegetarian: boolean,
): string | null {
  if (isForbiddenTilbehorName(candidate.name)) return "forbidden_tilbehor_name";
  const cls = classifyPhrase(candidate.name);
  if (isInvalidAdditionEntity(cls.entityType)) return "invalid_addition_entity";
  if (context.family === "DRINK") {
    if (
      /\b(mayo|mayonnaise|ketchup|remoulade|bacon|ost|salat|tomat|løg|oksekød)\b/i.test(
        candidate.name,
      )
    ) {
      return "drink_food_addition";
    }
  }
  if (vegetarian && isMeatAddition(candidate.name)) return "vegetarian_meat_addition";
  if (
    context.enforceDipContext &&
    isDipAddition(candidate.name) &&
    !context.wantsDips
  ) {
    return "dip_not_in_context";
  }
  return null;
}

/**
 * True when `selected` is a good-enough natural set for the family. A non-empty
 * set is NOT automatically sufficient: burger-like families need at least 2-3
 * evidence-backed natural extras, not one arbitrary item.
 */
export function isAdditionSetSufficient(
  family: ProductFamily,
  selected: readonly AdditionCandidate[],
): boolean {
  if (family === "DRINK") return selected.length === 0;
  if (family === "COMBO_MENU") return true;
  const min = FAMILY_MIN_EVIDENCE_ADDITIONS[family];
  if (min == null) return true;
  // Dips count as real additions here (a 3-dip grill set is a complete set);
  // only DOMAIN_PRIOR/GLOBAL_POLICY filler does not count as evidence-backed.
  const evidenceBacked = selected.filter(
    (c) => TIER_RANK[c.tier] >= TIER_RANK.PEER_FAMILY,
  );
  return evidenceBacked.length >= min;
}

/**
 * Resolve the final natural set from the collected pool.
 *
 * - Applies existing exclusion rules (drinks/vegetarian/dips/forbidden names).
 * - Keeps ALL authoritative candidates (SOURCE/EXACT/RESTAURANT) — source correct
 *   is never overwritten.
 * - Dedupes by normalized name, preferring the highest-ranked tier + a price.
 * - Only when the authoritative set is insufficient does it pull supplemental
 *   tiers — in ranked order — so a sparse higher-tier set is topped up by peer /
 *   category / domain evidence rather than locking it out.
 */
export function resolveAdditionCandidates(
  pool: readonly AdditionCandidate[],
  context: AdditionCandidatePoolContext,
): { selected: AdditionCandidate[]; rejected: AdditionRejection[] } {
  const rejected: AdditionRejection[] = [];
  const accepted: AdditionCandidate[] = [];

  const vegetarian = isVegetarianContext({
    name: context.productName,
    categoryNames: [context.categoryName],
  });

  for (const c of pool) {
    const reason = exclusionReason(c, context, vegetarian);
    if (reason) rejected.push({ candidate: c, reason });
    else accepted.push(c);
  }

  const byKey = new Map<string, AdditionCandidate>();
  for (const c of [...accepted].sort(
    (a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier],
  )) {
    const existing = byKey.get(c.nameKey);
    if (!existing) {
      byKey.set(c.nameKey, c);
      continue;
    }
    if (existing.priceOre == null && c.priceOre != null) {
      byKey.set(c.nameKey, {
        ...existing,
        priceOre: c.priceOre,
        priceSource: c.priceSource,
      });
    }
  }
  const deduped = [...byKey.values()];

  const selected = deduped
    .filter((c) => AUTHORITATIVE_TIERS.includes(c.tier))
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
  const selectedKeys = new Set(selected.map((c) => c.nameKey));

  for (const tier of SUPPLEMENTAL_TIERS) {
    if (isAdditionSetSufficient(context.family, selected)) break;
    for (const c of deduped) {
      if (c.tier !== tier) continue;
      if (selectedKeys.has(c.nameKey)) continue;
      selected.push(c);
      selectedKeys.add(c.nameKey);
    }
  }

  for (const c of deduped) {
    if (selectedKeys.has(c.nameKey)) continue;
    rejected.push({ candidate: c, reason: "not_needed_after_sufficiency" });
  }

  return { selected, rejected };
}

/** Rank helper for callers that need the shared tier ordering. */
export function additionTierRank(tier: SemanticProvenanceTier): number {
  return TIER_RANK[tier];
}
