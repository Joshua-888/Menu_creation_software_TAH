/**
 * Category-ingredient Tilbehør — when source has no additions, compose an
 * ekstra list from the union of ingredients (+ Beskrivelse topping lists)
 * across the category.
 *
 * Never applies to drinks / dip / diverse. Dips never enter the composed list.
 * Price: peer median for name when known, else 1000 øre (10 kr).
 */

import type { CanonicalMenu, CanonicalProduct } from "../domain/schema/canonical.js";
import { formatIngredientDisplay } from "../domain/textNormalize.js";
import type { AdditionDefinition, AdditionSetFact } from "../decisions/facts.js";
import { normalizeAdditionName } from "../decisions/facts.js";
import type { DecisionStore } from "../decisions/store.js";
import type { AdditionLikelihoodPolicy } from "./additionLikelihood.js";
import { isDipAddition } from "./categoryLikelihood.js";
import { isForbiddenTilbehorName } from "../domain/menuCardQuality.js";
import {
  categoryExcludedFromStructuralFanOut,
} from "./categorySizeVariantPolicy.js";
import { parseToppingListFromDescription } from "./pizzaToppings.js";

export const CATEGORY_INGREDIENT_FACT_PREFIX = "addset_cat_ingredients_";
export const DEFAULT_EKSTRA_PRICE_ORE = 1000;

const JUNK_TOKEN_RE =
  /^(inkl\.?|med|menu|alm\.?|fam\.?|familie|deep|valgfri|valgbar|efter smag|og)$/i;
const SIZE_TOKEN_RE =
  /^(alm\.?|fam\.?|familie|menu|lille|stor|deep|normal|gluten[\s-]?fri|fuldkorn|hj\.?|hjemmelavet|\d+\s*cm)$/i;

export type ComposedCategoryAddition = {
  name: string;
  nameKey: string;
  priceOre: number;
  priceSource: "PEER_MEDIAN" | "DEFAULT_10KR";
};

export type CategoryIngredientComposition = {
  categoryName: string;
  eligible: boolean;
  reason: string;
  additions: ComposedCategoryAddition[];
};

export function isCategoryIngredientFactId(factId: string): boolean {
  return factId.startsWith(CATEGORY_INGREDIENT_FACT_PREFIX);
}

export function categoryEligibleForIngredientTilbehor(
  categoryName: string,
): boolean {
  const n = categoryName.trim();
  if (!n) return false;
  return !categoryExcludedFromStructuralFanOut(n);
}

function peerPriceLookup(
  likelihood: AdditionLikelihoodPolicy | null | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!likelihood) return map;
  for (const stats of Object.values(likelihood.byKind)) {
    if (!stats) continue;
    for (const s of stats) {
      if (s.medianPriceOre == null) continue;
      const prev = map.get(s.nameKey);
      if (prev == null) map.set(s.nameKey, s.medianPriceOre);
      else map.set(s.nameKey, Math.round((prev + s.medianPriceOre) / 2));
    }
  }
  return map;
}

function acceptIngredientToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 2) return null;
  if (isDipAddition(trimmed)) return null;
  if (isForbiddenTilbehorName(trimmed)) return null;
  if (JUNK_TOKEN_RE.test(trimmed)) return null;
  if (SIZE_TOKEN_RE.test(trimmed)) return null;
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return null;
  const formatted = formatIngredientDisplay(trimmed);
  if (!formatted || formatted.length < 2) return null;
  if (isDipAddition(formatted)) return null;
  if (isForbiddenTilbehorName(formatted)) return null;
  return formatted;
}

/** Collect unique ingredient display names for one product. */
export function collectProductIngredientTokens(
  product: CanonicalProduct,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const ok = acceptIngredientToken(raw);
    if (!ok) return;
    const key = normalizeAdditionName(ok);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ok);
  };

  for (const ing of product.ingredients ?? []) {
    if (ing.display) push(ing.display);
  }

  const desc = (product.description ?? "").trim();
  if (desc) {
    const { toppings } = parseToppingListFromDescription(desc);
    for (const t of toppings) push(t);
  }

  return out;
}

/**
 * Compose Tilbehør candidates from the category ingredient union.
 */
export function composeCategoryIngredientAdditions(input: {
  menu: CanonicalMenu;
  likelihood?: AdditionLikelihoodPolicy | null;
}): CategoryIngredientComposition[] {
  const priceByKey = peerPriceLookup(input.likelihood ?? null);
  const results: CategoryIngredientComposition[] = [];

  for (const cat of input.menu.categories) {
    if (!categoryEligibleForIngredientTilbehor(cat.name)) {
      results.push({
        categoryName: cat.name,
        eligible: false,
        reason: "excluded_drinks_or_dip_diverse",
        additions: [],
      });
      continue;
    }

    const byKey = new Map<string, string>();
    for (const p of cat.products) {
      for (const token of collectProductIngredientTokens(p)) {
        const key = normalizeAdditionName(token);
        if (!byKey.has(key)) byKey.set(key, token);
      }
    }

    if (byKey.size === 0) {
      results.push({
        categoryName: cat.name,
        eligible: true,
        reason: "no_ingredients_in_category",
        additions: [],
      });
      continue;
    }

    const additions: ComposedCategoryAddition[] = [...byKey.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "da"))
      .map(([nameKey, name]) => {
        const peer = priceByKey.get(nameKey);
        return {
          name,
          nameKey,
          priceOre: peer ?? DEFAULT_EKSTRA_PRICE_ORE,
          priceSource: peer != null ? ("PEER_MEDIAN" as const) : ("DEFAULT_10KR" as const),
        };
      });

    results.push({
      categoryName: cat.name,
      eligible: true,
      reason: "composed_from_category_ingredient_union",
      additions,
    });
  }

  return results;
}

function categoryFactId(restaurantKey: string, categoryName: string): string {
  const slug = normalizeAdditionName(categoryName).replace(/\s+/g, "-");
  return `${CATEGORY_INGREDIENT_FACT_PREFIX}${restaurantKey}_${slug}`;
}

function toAdditionDefs(
  additions: ComposedCategoryAddition[],
): AdditionDefinition[] {
  return additions.map((a) => ({
    additionId: `add_${a.nameKey.replace(/\s+/g, "-")}`,
    name: a.name,
    nameKey: a.nameKey,
    priceMinor: a.priceOre,
    currency: "DKK" as const,
    required: false,
    minSelections: null,
    maxSelections: null,
    origin: "DERIVED" as const,
  }));
}

/**
 * Upsert RESTAURANT_CATEGORY BUSINESS_FACTs from this restaurant's category
 * ingredient union. Returns categories that received a non-empty fact.
 */
export function upsertCategoryIngredientAdditionFacts(input: {
  store: DecisionStore;
  restaurantKey: string;
  menu: CanonicalMenu;
  likelihood?: AdditionLikelihoodPolicy | null;
}): {
  facts: AdditionSetFact[];
  categoriesWithUnion: string[];
  compositions: CategoryIngredientComposition[];
} {
  const compositions = composeCategoryIngredientAdditions({
    menu: input.menu,
    likelihood: input.likelihood ?? null,
  });
  const facts: AdditionSetFact[] = [];
  const categoriesWithUnion: string[] = [];

  for (const comp of compositions) {
    if (!comp.eligible || !comp.additions.length) continue;

    const factId = categoryFactId(input.restaurantKey, comp.categoryName);
    const existing = input.store.facts
      .listActiveAdditionSets(input.restaurantKey)
      .find((f) => f.factId === factId);

    const payload = toAdditionDefs(comp.additions);
    const sig = payload.map((p) => `${p.nameKey}:${p.priceMinor}`).join("|");
    const existingSig = existing
      ? existing.additions.map((a) => `${a.nameKey}:${a.priceMinor}`).join("|")
      : "";

    if (existing && existingSig === sig) {
      facts.push(existing);
      categoriesWithUnion.push(comp.categoryName);
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
      sourceCategory: comp.categoryName,
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
      originalOperatorText: `Category ingredient union Tilbehør (${comp.additions.length} items) for ${comp.categoryName}`,
      evidenceJson: JSON.stringify({
        source: "CATEGORY_INGREDIENT_UNION",
        reason: comp.reason,
        count: comp.additions.length,
        priceSources: Object.fromEntries(
          comp.additions.map((a) => [a.nameKey, a.priceSource]),
        ),
      }),
    };
    input.store.facts.insertAdditionSet(fact);
    facts.push(fact);
    categoriesWithUnion.push(comp.categoryName);
  }

  return { facts, categoriesWithUnion, compositions };
}
