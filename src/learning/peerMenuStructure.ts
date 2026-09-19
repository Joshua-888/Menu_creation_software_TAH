/**
 * Peer menu structure observation — learn HOW menus are built (SEMANTIC_RULE),
 * never copy peer prices/option lists as Veroni BUSINESS_FACT.
 */

import {
  DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY,
  distillCategoryVariantFanOutPolicy,
  type CategoryVariantFanOutPolicy,
  type StructuralVariantKind,
} from "./categorySizeVariantPolicy.js";

export type PeerProductSnapshot = {
  databaseId?: string;
  menuNumber: string;
  name: string;
  categoryIds?: string[];
  categoryNames?: string[];
  variants: Array<{ name: string; priceOre?: number | null }>;
  additions: Array<{ name: string; priceOre?: number | null }>;
  ingredients?: string[];
  /** Beskrivelse when observed — used for ingredient/description likelihood. */
  description?: string;
};

export type PeerMenuSnapshot = {
  host: string;
  restaurantKey: string;
  observedAt: string;
  products: PeerProductSnapshot[];
  source: "admin_read" | "fixture" | "file";
};

export type ChoicePlacement = "variants" | "additions";

export type StructurePatternSummary = {
  restaurantsAnalyzed: number;
  hosts: string[];
  /** Majority peer pattern for type/meat choice when no size variants. */
  meatChoiceWithoutSize: ChoicePlacement;
  /** When Alm/Familie (or similar size) already present. */
  meatChoiceWithSize: ChoicePlacement;
  /** Shared Tilbehør-like additions appear on this fraction of products (max across peers). */
  sharedAdditionCoverage: number;
  /** Recommended addition scope from peer coverage. */
  tilbehorScope: "RESTAURANT" | "RESTAURANT_CATEGORY" | "PRODUCT_LOCAL";
  /**
   * Category structural-variant fan-out (Alm/Fam, Deep, Glutenfri, Fuldkorn, Hj.).
   * Eligible cats: pizza, burger, durum, pita, sandwich, indbagt.
   * Excluded: drinks, dip/diverse.
   */
  categoryVariantFanOut: CategoryVariantFanOutPolicy;
  /** Fingerprint of distilled rule for confirm gates. */
  fingerprint: string;
  evidence: {
    typeVariantProducts: number;
    sizeVariantProducts: number;
    sharedAdditionSets: Array<{
      signature: string;
      productCount: number;
      coverage: number;
    }>;
  };
};

const SIZE_VARIANT_RE =
  /^(alm\.?|fam\.?|familie|lille|stor|deep|normal|gluten[\s-]?fri|fuldkorn|hj\.?|hjemmelavet|\d+\s*cm)$/i;
const MEAT_OR_TYPE_RE =
  /\b(kebab|kylling|skinke|falafel|okse|oksekød|rejer|mix|vegetar|grøntsager|champignon|broccoli|blomkål|indisk)\b/i;
export function isSizeVariantName(name: string): boolean {
  return SIZE_VARIANT_RE.test(name.trim());
}

export function looksLikeTypeOrMeatVariant(name: string): boolean {
  return MEAT_OR_TYPE_RE.test(name) && !isSizeVariantName(name);
}

function additionSignature(
  additions: Array<{ name: string }>,
): string {
  return additions
    .map((a) => a.name.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

export function analyzePeerMenu(
  snap: PeerMenuSnapshot,
): {
  typeVariantProducts: number;
  sizeVariantProducts: number;
  mixedSizeAndTypeVariants: number;
  typeAsZeroAdditions: number;
  sharedAdditionSets: Array<{
    signature: string;
    productCount: number;
    coverage: number;
    names: string[];
  }>;
} {
  let typeVariantProducts = 0;
  let sizeVariantProducts = 0;
  let mixedSizeAndTypeVariants = 0;
  let typeAsZeroAdditions = 0;

  const sigCounts = new Map<string, { count: number; names: string[] }>();

  for (const p of snap.products) {
    const vars = p.variants ?? [];
    const adds = p.additions ?? [];
    const sizeVars = vars.filter((v) => isSizeVariantName(v.name));
    const typeVars = vars.filter((v) => looksLikeTypeOrMeatVariant(v.name));
    if (sizeVars.length >= 1 && vars.length >= 2) sizeVariantProducts += 1;
    if (typeVars.length >= 2) typeVariantProducts += 1;
    if (sizeVars.length >= 1 && typeVars.length >= 1) {
      mixedSizeAndTypeVariants += 1;
    }
    const zeroTypeAdds = adds.filter(
      (a) =>
        looksLikeTypeOrMeatVariant(a.name) &&
        (a.priceOre == null || a.priceOre === 0),
    );
    if (zeroTypeAdds.length >= 2) typeAsZeroAdditions += 1;

    if (adds.length >= 2) {
      const sig = additionSignature(adds);
      if (sig) {
        const cur = sigCounts.get(sig) ?? {
          count: 0,
          names: adds.map((a) => a.name),
        };
        cur.count += 1;
        sigCounts.set(sig, cur);
      }
    }
  }

  const n = Math.max(snap.products.length, 1);
  const sharedAdditionSets = [...sigCounts.entries()]
    .map(([signature, v]) => ({
      signature,
      productCount: v.count,
      coverage: v.count / n,
      names: v.names,
    }))
    .filter((s) => s.productCount >= 3 || s.coverage >= 0.25)
    .sort((a, b) => b.coverage - a.coverage);

  return {
    typeVariantProducts,
    sizeVariantProducts,
    mixedSizeAndTypeVariants,
    typeAsZeroAdditions,
    sharedAdditionSets,
  };
}

export function distillStructurePatterns(
  snaps: PeerMenuSnapshot[],
): StructurePatternSummary {
  if (!snaps.length) {
    return {
      restaurantsAnalyzed: 0,
      hosts: [],
      meatChoiceWithoutSize: "variants",
      meatChoiceWithSize: "additions",
      sharedAdditionCoverage: 0,
      tilbehorScope: "PRODUCT_LOCAL",
      categoryVariantFanOut: { ...DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY },
      fingerprint: "empty",
      evidence: {
        typeVariantProducts: 0,
        sizeVariantProducts: 0,
        sharedAdditionSets: [],
      },
    };
  }

  let typeVariantProducts = 0;
  let sizeVariantProducts = 0;
  let typeAsZeroAdditions = 0;
  let mixed = 0;
  let maxSharedCoverage = 0;
  let productsObserved = 0;
  const sharedAll: StructurePatternSummary["evidence"]["sharedAdditionSets"] =
    [];

  for (const snap of snaps) {
    const a = analyzePeerMenu(snap);
    typeVariantProducts += a.typeVariantProducts;
    sizeVariantProducts += a.sizeVariantProducts;
    typeAsZeroAdditions += a.typeAsZeroAdditions;
    mixed += a.mixedSizeAndTypeVariants;
    productsObserved += snap.products.length;
    for (const s of a.sharedAdditionSets) {
      maxSharedCoverage = Math.max(maxSharedCoverage, s.coverage);
      sharedAll.push({
        signature: s.signature,
        productCount: s.productCount,
        coverage: s.coverage,
      });
    }
  }

  // Majority: type choices as variants when peers use multi type-variants;
  // if peers put type options on zero-price additions (esp. with size), prefer additions.
  const meatChoiceWithoutSize: ChoicePlacement =
    typeVariantProducts >= typeAsZeroAdditions ? "variants" : "additions";
  const meatChoiceWithSize: ChoicePlacement =
    mixed > 0 && typeVariantProducts > typeAsZeroAdditions
      ? "variants"
      : "additions";

  let tilbehorScope: StructurePatternSummary["tilbehorScope"] = "PRODUCT_LOCAL";
  if (maxSharedCoverage >= 0.5) tilbehorScope = "RESTAURANT";
  else if (maxSharedCoverage >= 0.25) tilbehorScope = "RESTAURANT_CATEGORY";

  const categoryVariantFanOut = distillCategoryVariantFanOutPolicy({
    sizeVariantProducts,
    productsObserved,
  });

  const fingerprint = [
    meatChoiceWithoutSize,
    meatChoiceWithSize,
    tilbehorScope,
    maxSharedCoverage.toFixed(2),
    `cvf:${categoryVariantFanOut.mode}`,
    snaps.map((s) => s.restaurantKey).sort().join(","),
  ].join("|");

  return {
    restaurantsAnalyzed: snaps.length,
    hosts: snaps.map((s) => s.host),
    meatChoiceWithoutSize,
    meatChoiceWithSize,
    sharedAdditionCoverage: maxSharedCoverage,
    tilbehorScope,
    categoryVariantFanOut,
    fingerprint,
    evidence: {
      typeVariantProducts,
      sizeVariantProducts,
      sharedAdditionSets: sharedAll
        .sort((a, b) => b.coverage - a.coverage)
        .slice(0, 20),
    },
  };
}

function parseCategoryVariantFanOut(
  raw: unknown,
): CategoryVariantFanOutPolicy {
  const base = { ...DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const mode =
    o.mode === "SOURCE_CATEGORY" ||
    o.mode === "PEER_OR_SOURCE" ||
    o.mode === "OFF"
      ? o.mode
      : base.mode;
  const fanOutKinds = Array.isArray(o.fanOutKinds)
    ? o.fanOutKinds.filter((k): k is StructuralVariantKind =>
        [
          "alm",
          "familie",
          "deep",
          "glutenfri",
          "fuldkorn",
          "hjemmelavet",
        ].includes(String(k)),
      )
    : base.fanOutKinds;
  return {
    enabled: o.enabled !== false,
    mode,
    peerSizeCoverage:
      typeof o.peerSizeCoverage === "number" ? o.peerSizeCoverage : 0,
    peerEnableMinCoverage:
      typeof o.peerEnableMinCoverage === "number"
        ? o.peerEnableMinCoverage
        : base.peerEnableMinCoverage,
    fanOutKinds: fanOutKinds.length ? fanOutKinds : base.fanOutKinds,
  };
}

/** SEMANTIC_RULE resolution payload (no money / option lists). */
export function encodeStructureSemanticRule(
  summary: StructurePatternSummary,
): string {
  return JSON.stringify({
    kind: "MENU_STRUCTURE_SEMANTIC",
    knowledgeKind: "SEMANTIC_RULE",
    meatChoiceWithoutSize: summary.meatChoiceWithoutSize,
    meatChoiceWithSize: summary.meatChoiceWithSize,
    tilbehorScope: summary.tilbehorScope,
    categoryVariantFanOut: summary.categoryVariantFanOut,
    fingerprint: summary.fingerprint,
    hosts: summary.hosts,
  });
}

export function parseStructureSemanticRule(
  resolution: string,
): StructurePatternSummary | null {
  try {
    const p = JSON.parse(resolution) as Record<string, unknown>;
    if (p.kind !== "MENU_STRUCTURE_SEMANTIC") return null;
    if (
      p.meatChoiceWithoutSize !== "variants" &&
      p.meatChoiceWithoutSize !== "additions"
    ) {
      return null;
    }
    if (
      p.meatChoiceWithSize !== "variants" &&
      p.meatChoiceWithSize !== "additions"
    ) {
      return null;
    }
    return {
      restaurantsAnalyzed: Array.isArray(p.hosts) ? p.hosts.length : 0,
      hosts: Array.isArray(p.hosts)
        ? p.hosts.filter((h): h is string => typeof h === "string")
        : [],
      meatChoiceWithoutSize: p.meatChoiceWithoutSize,
      meatChoiceWithSize: p.meatChoiceWithSize,
      sharedAdditionCoverage: 0,
      tilbehorScope:
        p.tilbehorScope === "RESTAURANT" ||
        p.tilbehorScope === "RESTAURANT_CATEGORY" ||
        p.tilbehorScope === "PRODUCT_LOCAL"
          ? p.tilbehorScope
          : "PRODUCT_LOCAL",
      categoryVariantFanOut: parseCategoryVariantFanOut(
        p.categoryVariantFanOut ?? p.categorySizeVariantPolicy,
      ),
      fingerprint: typeof p.fingerprint === "string" ? p.fingerprint : "unknown",
      evidence: {
        typeVariantProducts: 0,
        sizeVariantProducts: 0,
        sharedAdditionSets: [],
      },
    };
  } catch {
    return null;
  }
}
