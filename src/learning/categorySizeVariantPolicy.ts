/**
 * Category structural-variant SEMANTIC_RULE.
 *
 * When an eligible food category shows structural choice variants on any product
 * (Alm./Fam., Deep, Glutenfri, Fuldkorn, Hj./hjemmelavet, …), fan those variants
 * onto sibling products in the same category.
 *
 * Eligible: pizza (+ all pizza-named cats), burger, durum, pita, sandwich, indbagt.
 * Excluded: drinks, dip / diverse.
 *
 * Money: NEVER invent surcharges. Each fan-out name uses the median surcharge of
 * siblings that already expose that variant.
 */

import type {
  CanonicalMenu,
  CanonicalProduct,
  CanonicalVariant,
} from "../domain/schema/canonical.js";

export type StructuralVariantKind =
  | "alm"
  | "familie"
  | "deep"
  | "glutenfri"
  | "fuldkorn"
  | "hjemmelavet";

export type StructuralVariantDef = {
  kind: StructuralVariantKind;
  canonicalName: string;
  /** Match variant label (trimmed). */
  match: (name: string) => boolean;
};

export const STRUCTURAL_VARIANT_DEFS: StructuralVariantDef[] = [
  {
    kind: "alm",
    canonicalName: "Alm.",
    match: (n) => /^alm\.?$/i.test(n.trim()),
  },
  {
    kind: "familie",
    canonicalName: "Familie",
    match: (n) => /^(fam\.?|familie)$/i.test(n.trim()),
  },
  {
    kind: "deep",
    canonicalName: "Deep",
    match: (n) => /^deep$/i.test(n.trim()),
  },
  {
    kind: "glutenfri",
    canonicalName: "Glutenfri",
    match: (n) => /^gluten[\s-]?fri$/i.test(n.trim()),
  },
  {
    kind: "fuldkorn",
    canonicalName: "Fuldkorn",
    match: (n) => /^fuldkorn$/i.test(n.trim()),
  },
  {
    kind: "hjemmelavet",
    canonicalName: "Hj.",
    match: (n) => /^(hj\.?|hjemmelavet)$/i.test(n.trim()),
  },
];

export const CANONICAL_ALM_NAME = "Alm.";
export const CANONICAL_FAM_NAME = "Familie";

export type CategoryVariantFanOutPolicy = {
  enabled: boolean;
  /**
   * SOURCE_CATEGORY: fan structural variants observed in the category onto all
   *   eligible products in that category.
   * PEER_OR_SOURCE: same, and when peer size coverage is strong, still require
   *   priced sibling evidence (never invent money).
   * OFF: disabled.
   */
  mode: "SOURCE_CATEGORY" | "PEER_OR_SOURCE" | "OFF";
  /** Peer fraction of products that already expose size/structural variants. */
  peerSizeCoverage: number;
  peerEnableMinCoverage: number;
  /** Structural kinds this SEMANTIC_RULE may fan out. */
  fanOutKinds: StructuralVariantKind[];
};

/** @deprecated Use CategoryVariantFanOutPolicy — kept as alias for callers. */
export type CategorySizeVariantPolicy = CategoryVariantFanOutPolicy;

export const DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY: CategoryVariantFanOutPolicy =
  {
    enabled: true,
    mode: "SOURCE_CATEGORY",
    peerSizeCoverage: 0,
    peerEnableMinCoverage: 0.35,
    fanOutKinds: STRUCTURAL_VARIANT_DEFS.map((d) => d.kind),
  };

/** @deprecated */
export const DEFAULT_CATEGORY_SIZE_VARIANT_POLICY =
  DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY;

const ELIGIBLE_CATEGORY_RE =
  /(pizza|calzone|ufo|indbagt|burger|durum|pita|sandwich)/i;

const EXCLUDED_CATEGORY_RE =
  /(drink|drikke|sodavand|øl|\bol\b|vin|juice|milkshake|shake|kaffe|\bthe\b|\bte\b|\bvand\b|dip|dips|diverse|tilbehør|sauce|saucer)/i;

export function categoryExcludedFromStructuralFanOut(
  categoryName: string,
): boolean {
  return EXCLUDED_CATEGORY_RE.test(categoryName.trim());
}

export function categoryEligibleForStructuralFanOut(
  categoryName: string,
): boolean {
  const n = categoryName.trim();
  if (!n) return false;
  if (categoryExcludedFromStructuralFanOut(n)) return false;
  return ELIGIBLE_CATEGORY_RE.test(n);
}

/** @deprecated Prefer categoryEligibleForStructuralFanOut */
export function categoryLooksPizzaLike(categoryName: string): boolean {
  return categoryEligibleForStructuralFanOut(categoryName);
}

export function matchStructuralVariant(
  name: string,
): StructuralVariantDef | null {
  const t = name.trim();
  for (const def of STRUCTURAL_VARIANT_DEFS) {
    if (def.match(t)) return def;
  }
  return null;
}

export function isStructuralCategoryVariantName(name: string): boolean {
  return matchStructuralVariant(name) != null;
}

/**
 * Hard SEMANTIC_RULE: "Menu" is never a product variant.
 * Combo meals (burger + pommes + soda) belong as separate products under a
 * "Menuer" category, where each item has its own required sub-choices —
 * not as Alm./Menu size variants on Grill/burger cards.
 */
export function isForbiddenMenuVariantName(name: string): boolean {
  return /^(menu|menü)\.?$/i.test(name.trim());
}

export function stripForbiddenMenuVariants<T extends { name: string }>(
  variants: readonly T[],
): T[] {
  return variants.filter((v) => !isForbiddenMenuVariantName(v.name));
}

export function isAlmSizeName(name: string): boolean {
  return STRUCTURAL_VARIANT_DEFS.find((d) => d.kind === "alm")!.match(name);
}

export function isFamSizeName(name: string): boolean {
  return STRUCTURAL_VARIANT_DEFS.find((d) => d.kind === "familie")!.match(name);
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? Math.round((s[mid - 1]! + s[mid]!) / 2)
    : s[mid]!;
}

export function medianSurchargeForKindOre(
  products: CanonicalProduct[],
  kind: StructuralVariantKind,
): number | null {
  const def = STRUCTURAL_VARIANT_DEFS.find((d) => d.kind === kind);
  if (!def) return null;
  const vals: number[] = [];
  for (const p of products) {
    const hit = (p.variants ?? []).find((v) => def.match(v.name));
    if (hit && typeof hit.surcharge === "number") {
      vals.push(hit.surcharge);
    }
  }
  return median(vals);
}

/** Fam. surcharge helper (tests / callers). */
export function medianFamSurchargeOre(
  products: CanonicalProduct[],
): number | null {
  return medianSurchargeForKindOre(products, "familie");
}

export function productHasAlmFamPair(product: CanonicalProduct): boolean {
  const vars = product.variants ?? [];
  return (
    vars.some((v) => isAlmSizeName(v.name)) &&
    vars.some((v) => isFamSizeName(v.name))
  );
}

export function stripEmbeddedStructuralTokensFromName(name: string): string {
  return name
    .replace(
      /\b(alm\.?|fam\.?|familie|deep|gluten[\s-]?fri|fuldkorn|hj\.?|hjemmelavet)(?!\w)/gi,
      " ",
    )
    .replace(/[.\u00B7•]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** @deprecated */
export const stripEmbeddedSizeTokensFromName =
  stripEmbeddedStructuralTokensFromName;

export type CategoryVariantFanOutTrace = {
  categoryName: string;
  eligible: boolean;
  applied: boolean;
  reason: string;
  kindsObserved: StructuralVariantKind[];
  kindsApplied: StructuralVariantKind[];
  productsUpdated: Array<{
    menuNumber: string | null;
    sourceId: string;
    beforeVariants: string[];
    afterVariants: string[];
    nameCleaned: boolean;
  }>;
};

/** @deprecated */
export type CategorySizeFanOutTrace = CategoryVariantFanOutTrace;

export function distillCategoryVariantFanOutPolicy(input: {
  sizeVariantProducts: number;
  productsObserved: number;
}): CategoryVariantFanOutPolicy {
  const coverage =
    input.productsObserved > 0
      ? input.sizeVariantProducts / input.productsObserved
      : 0;
  const peerStrong =
    coverage >= DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY.peerEnableMinCoverage;
  return {
    ...DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY,
    enabled: true,
    mode: peerStrong ? "PEER_OR_SOURCE" : "SOURCE_CATEGORY",
    peerSizeCoverage: coverage,
  };
}

/** @deprecated */
export const distillCategorySizeVariantPolicy =
  distillCategoryVariantFanOutPolicy;

function kindsObservedInCategory(
  products: CanonicalProduct[],
  allowed: Set<StructuralVariantKind>,
): StructuralVariantKind[] {
  const seen = new Set<StructuralVariantKind>();
  for (const p of products) {
    for (const v of p.variants ?? []) {
      const m = matchStructuralVariant(v.name);
      if (m && allowed.has(m.kind)) seen.add(m.kind);
    }
  }
  // Stable order from STRUCTURAL_VARIANT_DEFS
  return STRUCTURAL_VARIANT_DEFS.map((d) => d.kind).filter((k) => seen.has(k));
}

function ensureStructuralVariants(
  product: CanonicalProduct,
  kindsToEnsure: Array<{ kind: StructuralVariantKind; surchargeOre: number }>,
): { product: CanonicalProduct; changed: boolean; nameCleaned: boolean } {
  const before = [...(product.variants ?? [])];
  const byKind = new Map<StructuralVariantKind, CanonicalVariant>();
  const nonStructural: CanonicalVariant[] = [];

  for (const v of before) {
    const m = matchStructuralVariant(v.name);
    if (m) {
      // Prefer first match; keep existing pricing if present
      if (!byKind.has(m.kind)) byKind.set(m.kind, v);
    } else if (!isForbiddenMenuVariantName(v.name)) {
      nonStructural.push(v);
    }
  }

  for (const { kind, surchargeOre } of kindsToEnsure) {
    const def = STRUCTURAL_VARIANT_DEFS.find((d) => d.kind === kind)!;
    const existing = byKind.get(kind);
    if (existing) {
      byKind.set(kind, {
        ...existing,
        name: def.canonicalName,
        surcharge:
          typeof existing.surcharge === "number"
            ? existing.surcharge
            : surchargeOre,
      });
    } else {
      byKind.set(kind, {
        sourceId: `${product.sourceId}::var-${kind}-category-fanout`,
        name: def.canonicalName,
        nameOrigin: "DERIVED",
        surcharge: surchargeOre,
        surchargeOrigin: "DERIVED",
        isBase: kind === "alm",
      });
    }
  }

  // Ensure exactly one isBase among structural variants we emit
  const structuralOrdered = STRUCTURAL_VARIANT_DEFS.map((d) => d.kind)
    .map((k) => byKind.get(k))
    .filter((v): v is CanonicalVariant => v != null);

  if (structuralOrdered.length) {
    const hasAlm = structuralOrdered.some((v) => isAlmSizeName(v.name));
    const baseIdx = hasAlm
      ? structuralOrdered.findIndex((v) => isAlmSizeName(v.name))
      : structuralOrdered.findIndex((v) => v.surcharge === 0);
    const pick = baseIdx >= 0 ? baseIdx : 0;
    for (let i = 0; i < structuralOrdered.length; i++) {
      const v = structuralOrdered[i]!;
      structuralOrdered[i] = { ...v, isBase: i === pick };
    }
  }

  // Keep non-structural (meat/type, cm sizes). Never keep "Menu" — Menuer category.
  const nextVariants = [...structuralOrdered, ...nonStructural];

  const beforeNames = before.map((v) => v.name).join("|");
  const afterNames = nextVariants.map((v) => v.name).join("|");
  let name = product.name;
  let nameCleaned = false;
  const cleaned = stripEmbeddedStructuralTokensFromName(product.name);
  if (
    cleaned &&
    cleaned !== product.name &&
    /\b(alm\.?|fam\.?|familie|deep|gluten[\s-]?fri|fuldkorn|hj\.?|hjemmelavet)\b/i.test(
      product.name,
    )
  ) {
    name = cleaned;
    nameCleaned = true;
  }

  const changed = beforeNames !== afterNames || nameCleaned;
  if (!changed) {
    return { product, changed: false, nameCleaned: false };
  }
  return {
    product: { ...product, name, variants: nextVariants },
    changed: true,
    nameCleaned,
  };
}

/**
 * Apply category structural-variant fan-out according to SEMANTIC_RULE policy.
 */
export function applyCategoryVariantFanOut(input: {
  menu: CanonicalMenu;
  policy?: CategoryVariantFanOutPolicy | null;
}): {
  menu: CanonicalMenu;
  traces: CategoryVariantFanOutTrace[];
} {
  const policy = input.policy ?? DEFAULT_CATEGORY_VARIANT_FANOUT_POLICY;
  const traces: CategoryVariantFanOutTrace[] = [];
  const allowed = new Set(policy.fanOutKinds);

  if (!policy.enabled || policy.mode === "OFF") {
    return { menu: input.menu, traces };
  }

  const categories = input.menu.categories.map((cat) => {
    if (categoryExcludedFromStructuralFanOut(cat.name)) {
      traces.push({
        categoryName: cat.name,
        eligible: false,
        applied: false,
        reason: "excluded_category_drinks_or_dip_diverse",
        kindsObserved: [],
        kindsApplied: [],
        productsUpdated: [],
      });
      return cat;
    }

    if (!categoryEligibleForStructuralFanOut(cat.name)) {
      traces.push({
        categoryName: cat.name,
        eligible: false,
        applied: false,
        reason: "category_not_in_eligible_set",
        kindsObserved: [],
        kindsApplied: [],
        productsUpdated: [],
      });
      return cat;
    }

    const products = cat.products;
    const observed = kindsObservedInCategory(products, allowed);
    const peerBoost =
      policy.mode === "PEER_OR_SOURCE" &&
      policy.peerSizeCoverage >= policy.peerEnableMinCoverage;

    if (!observed.length && !peerBoost) {
      traces.push({
        categoryName: cat.name,
        eligible: true,
        applied: false,
        reason: "no_structural_variants_in_category",
        kindsObserved: [],
        kindsApplied: [],
        productsUpdated: [],
      });
      return cat;
    }

    // Kinds we can price from siblings (required — never invent)
    const priced: Array<{ kind: StructuralVariantKind; surchargeOre: number }> =
      [];
    for (const kind of observed) {
      const med = medianSurchargeForKindOre(products, kind);
      if (med == null) continue;
      priced.push({ kind, surchargeOre: med });
    }

    // Alm./Familie special: if category shows Fam without Alm pricing, still
    // ensure Alm at 0 when Fam is present (Alm is base).
    const hasFam = priced.some((p) => p.kind === "familie");
    const hasAlm = priced.some((p) => p.kind === "alm");
    if (hasFam && !hasAlm && allowed.has("alm")) {
      priced.unshift({ kind: "alm", surchargeOre: 0 });
    }

    if (!priced.length) {
      traces.push({
        categoryName: cat.name,
        eligible: true,
        applied: false,
        reason: "structural_variants_seen_but_no_priced_siblings",
        kindsObserved: observed,
        kindsApplied: [],
        productsUpdated: [],
      });
      return cat;
    }

    const productsUpdated: CategoryVariantFanOutTrace["productsUpdated"] = [];
    const nextProducts = products.map((p) => {
      const result = ensureStructuralVariants(p, priced);
      if (result.changed) {
        productsUpdated.push({
          menuNumber: p.sourceMenuNumber ?? p.assignedMenuNumber ?? null,
          sourceId: p.sourceId,
          beforeVariants: (p.variants ?? []).map((v) => v.name),
          afterVariants: result.product.variants.map((v) => v.name),
          nameCleaned: result.nameCleaned,
        });
      }
      return result.product;
    });

    traces.push({
      categoryName: cat.name,
      eligible: true,
      applied: productsUpdated.length > 0,
      reason: "source_category_structural_variant_fanout",
      kindsObserved: observed,
      kindsApplied: priced.map((p) => p.kind),
      productsUpdated,
    });

    return { ...cat, products: nextProducts };
  });

  return {
    menu: { ...input.menu, categories },
    traces,
  };
}

/** @deprecated Prefer applyCategoryVariantFanOut */
export const applyCategorySizeVariantFanOut = applyCategoryVariantFanOut;
