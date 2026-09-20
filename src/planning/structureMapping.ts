/**
 * Map productChoices + restaurant Tilbehør onto WritePlan payload fields
 * using peer-learned SEMANTIC_RULE placement.
 */

import type {
  CanonicalMenu,
  CanonicalProduct,
} from "../domain/schema/canonical.js";
import type { AdditionDefinition } from "../decisions/facts.js";
import { normalizeAdditionName } from "../decisions/facts.js";
import type { FactRegistry } from "../decisions/factStore.js";
import { resolveAdditionsForProduct } from "../decisions/precedence.js";
import {
  isSizeVariantName,
  type ChoicePlacement,
  type StructurePatternSummary,
} from "../learning/peerMenuStructure.js";
import {
  filterAdditionsWithTrace,
  classifyProductKind,
  type AdditionFilterTrace,
  type ProbabilityPolicyMap,
  type ProductKind,
} from "../learning/categoryLikelihood.js";
import {
  categoryExcludedFromStructuralFanOut,
  isForbiddenMenuVariantName,
  stripForbiddenMenuVariants,
} from "../learning/categorySizeVariantPolicy.js";
import {
  buildAdditionCandidatePool,
  isAdditionSetSufficient,
  resolveAdditionCandidates,
} from "../intelligence/additionCandidatePool.js";
import { inferProductFamily } from "../intelligence/peerCohorts.js";

export type MappedWriteFields = {
  variants: Array<{ name: string; surchargeOre: number }>;
  additions: Array<{ name: string; priceOre: number }>;
  mappingNotes: string[];
};

function hasSizePricing(product: CanonicalProduct): boolean {
  const sizeish = product.variants.filter(
    (v) =>
      isSizeVariantName(v.name) && !isForbiddenMenuVariantName(v.name),
  );
  if (sizeish.length >= 2) return true;
  // Alm. + Familie is a priced size pair (never Alm. + Menu — Menu is Menuer).
  const names = product.variants
    .map((v) => v.name.toLowerCase().trim())
    .filter((n) => !isForbiddenMenuVariantName(n));
  if (names.includes("alm.") && names.some((n) => n === "familie" || n === "fam.")) {
    return true;
  }
  return false;
}

function choicePlacementForProduct(
  product: CanonicalProduct,
  pattern: StructurePatternSummary,
): ChoicePlacement {
  return hasSizePricing(product)
    ? pattern.meatChoiceWithSize
    : pattern.meatChoiceWithoutSize;
}

/**
 * Apply peer structure mapping: productChoices → variants or 0kr additions.
 * Existing size variants are preserved when placement is additions.
 */
export function mapProductChoicesToWriteFields(
  product: CanonicalProduct,
  pattern: StructurePatternSummary,
): MappedWriteFields {
  const notes: string[] = [];
  const variants = product.variants.map((v) => ({
    name: v.name,
    surchargeOre: v.surcharge,
  }));
  const additions = product.addOns.map((a) => ({
    name: a.name,
    priceOre: a.price ?? 0,
  }));

  const choices = product.productChoices ?? [];
  if (!choices.length) {
    return { variants, additions, mappingNotes: notes };
  }

  const placement = choicePlacementForProduct(product, pattern);
  notes.push(`choice_placement=${placement}`);

  for (const choice of choices) {
    const optLabels = choice.options
      .map((o) => o.label)
      .filter((label): label is string => Boolean(label && label.trim()));
    if (!optLabels.length) continue;
    const isSide = /tilbehør/i.test(choice.prompt);
    // Required side "Vælg tilbehør" always as 0kr additions (customer picks side)
    const useAdditions = isSide || placement === "additions";

    if (useAdditions) {
      for (const label of optLabels) {
        if (
          additions.some(
            (a) => a.name.toLowerCase() === label.toLowerCase(),
          )
        ) {
          continue;
        }
        additions.push({ name: label, priceOre: 0 });
      }
      notes.push(
        `choice "${choice.prompt}" → additions[${optLabels.join(",")}]`,
      );
    } else {
      // Type choice owns the variant axis when there is no priced size pair.
      const next = optLabels.map((name) => ({ name, surchargeOre: 0 }));
      variants.length = 0;
      variants.push(...next);
      notes.push(
        `choice "${choice.prompt}" → variants[${optLabels.join(",")}]`,
      );
    }
  }

  if (variants.length === 0) {
    variants.push({ name: "Alm.", surchargeOre: 0 });
  }

  const stripped = stripForbiddenMenuVariants(variants);
  if (stripped.length !== variants.length) {
    notes.push("stripped_forbidden_Menu_variant");
    variants.length = 0;
    variants.push(...(stripped.length ? stripped : [{ name: "Alm.", surchargeOre: 0 }]));
  }

  return { variants, additions, mappingNotes: notes };
}

/** Fan-out restaurant/category AdditionSetFact onto products missing source addOns. */
export function fanOutRestaurantAdditions(input: {
  menu: CanonicalMenu;
  registry: FactRegistry;
  restaurantKey: string;
}): {
  menu: CanonicalMenu;
  appliedMenus: string[];
  notes: string[];
  fanOutMenus: string[];
} {
  const notes: string[] = [];
  const appliedMenus: string[] = [];
  const fanOutMenus: string[] = [];
  const categories = input.menu.categories.map((cat) => ({
    ...cat,
    products: cat.products.map((p) => {
      const menuNumber = p.sourceMenuNumber ?? p.assignedMenuNumber ?? null;
      // Hard prior: never fan Tilbehør onto drinks / dip-diverse categories.
      if (
        categoryExcludedFromStructuralFanOut(cat.name) ||
        classifyProductKind({
          name: p.name,
          categoryNames: [cat.name],
        }) === "drinks"
      ) {
        return p;
      }
      const sourceAdditions = (p.addOns ?? []).map((a) => ({
        name: a.name,
        priceMinor: a.price ?? null,
      }));
      const resolved = resolveAdditionsForProduct({
        registry: input.registry,
        restaurantKey: input.restaurantKey,
        sourceCategory: cat.name,
        sourceId: p.sourceId,
        menuNumber,
        sourceAdditions,
      });
      if (
        resolved.origin === "RESTAURANT_CATEGORY_OR_RESTAURANT_FACT" ||
        resolved.origin === "EXACT_PRODUCT_FACT"
      ) {
        if (
          resolved.additions.length > 0 &&
          sourceAdditions.length === 0
        ) {
          // WP3: route the resolved fact set through the shared candidate pool so
          // a sparse-but-non-empty set is recognised (and reported) instead of
          // being treated as a complete set. No new business engine is introduced:
          // the pool only collects the authoritative fact additions here; domain
          // priors / peers are NOT injected until completeProductCard, which runs
          // AFTER the probability filter (injecting dips pre-filter would both
          // invert pipeline order and re-introduce stripped dips).
          const family = inferProductFamily({
            name: p.name,
            categoryName: cat.name,
          });
          const pool = buildAdditionCandidatePool({
            productName: p.name,
            categoryName: cat.name,
            family,
            restaurantAdditions: resolved.additions.map((a) => ({
              name: a.name,
              priceOre: a.priceMinor ?? null,
            })),
          });
          const { selected } = resolveAdditionCandidates(pool, {
            productName: p.name,
            categoryName: cat.name,
            family,
          });
          if (menuNumber) {
            appliedMenus.push(menuNumber);
            fanOutMenus.push(menuNumber);
          }
          const sparse = !isAdditionSetSufficient(family, selected);
          notes.push(
            `#${menuNumber ?? p.sourceId}: fan-out ${selected.map((a) => a.name).join(",")} (${resolved.origin})${sparse ? " [sparse:supplement-downstream]" : ""}`,
          );
          return {
            ...p,
            addOns: selected.map((a, idx) => ({
              sourceId: `${p.sourceId}::addon-fanout-${idx}`,
              name: a.name,
              ...(a.priceOre != null ? { price: a.priceOre } : {}),
              origin: "DERIVED" as const,
            })),
          };
        }
        if (
          resolved.origin === "EXACT_PRODUCT_FACT" &&
          resolved.additions.length === 0 &&
          sourceAdditions.length === 0 &&
          menuNumber
        ) {
          notes.push(`#${menuNumber}: exact suppress Tilbehør`);
        }
      }
      return p;
    }),
  }));
  return {
    menu: { ...input.menu, categories },
    appliedMenus,
    notes,
    fanOutMenus,
  };
}

export type ProductPolicyTrace = {
  menuNumber: string | null;
  sourceId: string;
  name: string;
  categoryName: string;
  kind: ProductKind;
  reasonCodes: string[];
  additionsBefore: string[];
  additionsAfter: string[];
  removed: Array<{ name: string; reason: string }>;
  fanOutTilbehor: boolean;
  structureNotes: string[];
};

/** Apply category-likelihood probability policy to product addOns. */
export function applyProbabilityFilterToMenu(input: {
  menu: CanonicalMenu;
  policy: ProbabilityPolicyMap;
  fanOutMenus?: Set<string> | string[];
  structureNotesBySourceId?: Map<string, string[]>;
  /** Menu numbers with KEEP_TILBEHOR EXACT_PRODUCT overrides — skip dip strip. */
  keepTilbehorMenus?: Set<string> | string[];
}): { menu: CanonicalMenu; traces: ProductPolicyTrace[] } {
  const fanSet = new Set(input.fanOutMenus ?? []);
  const keepSet = new Set(input.keepTilbehorMenus ?? []);
  const traces: ProductPolicyTrace[] = [];
  const categories = input.menu.categories.map((cat) => ({
    ...cat,
    products: cat.products.map((p) => {
      const menuNumber = p.sourceMenuNumber ?? p.assignedMenuNumber ?? null;
      const before = (p.addOns ?? []).map((a) => ({
        name: a.name,
        priceOre: a.price ?? 0,
      }));
      if (menuNumber && keepSet.has(menuNumber)) {
        traces.push({
          menuNumber,
          sourceId: p.sourceId,
          name: p.name,
          categoryName: cat.name,
          kind: filterAdditionsWithTrace({
            name: p.name,
            categoryNames: [cat.name],
            additions: before,
            policy: input.policy,
          }).kind,
          reasonCodes: ["KEPT", "OPERATOR_KEEP_TILBEHOR"],
          additionsBefore: before.map((a) => a.name),
          additionsAfter: before.map((a) => a.name),
          removed: [],
          fanOutTilbehor: fanSet.has(menuNumber),
          structureNotes:
            input.structureNotesBySourceId?.get(p.sourceId) ?? [],
        });
        return p;
      }
      const desc = p.description;
      const filter: AdditionFilterTrace = filterAdditionsWithTrace({
        name: p.name,
        categoryNames: [cat.name],
        ...(desc ? { description: desc } : {}),
        additions: before,
        policy: input.policy,
      });
      const reasonCodes: string[] = [...filter.reasonCodes];
      const fanOutTilbehor = menuNumber != null && fanSet.has(menuNumber);
      if (fanOutTilbehor) reasonCodes.push("FANOUT_TILBEHOR");
      const structureNotes =
        input.structureNotesBySourceId?.get(p.sourceId) ?? [];
      if (structureNotes.some((n) => /→ variants/i.test(n))) {
        reasonCodes.push("STRUCTURE_VARIANT");
      }
      if (structureNotes.some((n) => /→ additions/i.test(n))) {
        reasonCodes.push("STRUCTURE_ADDITION");
      }
      traces.push({
        menuNumber,
        sourceId: p.sourceId,
        name: p.name,
        categoryName: cat.name,
        kind: filter.kind,
        reasonCodes: [...new Set(reasonCodes)],
        additionsBefore: filter.before.map((a) => a.name),
        additionsAfter: filter.after.map((a) => a.name),
        removed: filter.removed.map((a) => ({
          name: a.name,
          reason: a.reason,
        })),
        fanOutTilbehor,
        structureNotes,
      });
      if (filter.after.length === before.length) {
        const afterNames = new Set(filter.after.map((a) => a.name));
        if (before.every((a) => afterNames.has(a.name))) return p;
      }
      return {
        ...p,
        addOns: filter.after.map((a, idx) => ({
          sourceId: `${p.sourceId}::addon-prob-${idx}`,
          name: a.name,
          price: a.priceOre,
          origin: "DERIVED" as const,
        })),
      };
    }),
  }));
  return {
    menu: { ...input.menu, categories },
    traces,
  };
}

/** Veroni #49-derived Tilbehør BUSINESS_FACT (operator/source names; price from menu "10"). */
export function veroniDefaultTilbehorAdditions(): AdditionDefinition[] {
  const names = ["Salatmayonnaise", "Remoulade", "Ketchup"];
  return names.map((name) => ({
    additionId: `add_${normalizeAdditionName(name).replace(/\s+/g, "-")}`,
    name,
    nameKey: normalizeAdditionName(name),
    priceMinor: 1000,
    currency: "DKK" as const,
    required: false,
    minSelections: null,
    maxSelections: null,
    origin: "HUMAN_PROVIDED_BUSINESS_FACT" as const,
  }));
}

