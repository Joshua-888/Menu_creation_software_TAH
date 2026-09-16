/**
 * Apply approved restaurant facts + structure SEMANTIC_RULEs onto a menu
 * BEFORE product-card completion. Part of MenuIntelligenceEngine — not dryRun.
 */

import type { CanonicalMenu } from "../domain/schema/canonical.js";
import type { DecisionStore } from "../decisions/store.js";
import {
  defaultStructurePattern,
  loadActiveStructurePattern,
} from "../learning/structurePolicy.js";
import { applyCategoryVariantFanOut } from "../learning/categorySizeVariantPolicy.js";
import {
  applyProbabilityFilterToMenu,
  fanOutRestaurantAdditions,
  type ProductPolicyTrace,
} from "../planning/structureMapping.js";
import { menuNumbersWithKeepTilbehorOverride } from "../learning/tilbehorOverride.js";
import {
  filterAdditionsWithTrace,
  type ProbabilityPolicyMap,
} from "../learning/categoryLikelihood.js";

export type ApprovedFactsApplication = {
  menu: CanonicalMenu;
  policyTraces: ProductPolicyTrace[];
  fanOutMenus: string[];
};

/**
 * Variant fan-out + Tilbehør BUSINESS_FACT fan-out + hard/prior addition filter.
 * Must run inside MenuIntelligenceEngine before completeProductCard.
 */
export function applyApprovedFactsToMenu(input: {
  menu: CanonicalMenu;
  restaurantKey: string;
  decisionStore?: DecisionStore | null;
  probabilityPolicy?: ProbabilityPolicyMap | null;
}): ApprovedFactsApplication {
  const policyTraces: ProductPolicyTrace[] = [];
  let menu = input.menu;

  const structurePattern =
    (input.decisionStore
      ? loadActiveStructurePattern(input.decisionStore)
      : null) ?? defaultStructurePattern();

  {
    const fan = applyCategoryVariantFanOut({
      menu,
      policy:
        structurePattern.categoryVariantFanOut ??
        defaultStructurePattern().categoryVariantFanOut,
    });
    menu = fan.menu;
    for (const t of fan.traces) {
      if (!t.applied) continue;
      for (const u of t.productsUpdated) {
        policyTraces.push({
          menuNumber: u.menuNumber,
          sourceId: u.sourceId,
          name: "",
          categoryName: t.categoryName,
          kind: "other",
          reasonCodes: ["CATEGORY_STRUCTURAL_VARIANT_FANOUT"],
          additionsBefore: [],
          additionsAfter: [],
          removed: [],
          fanOutTilbehor: false,
          structureNotes: [
            `category structural variants → [${t.kindsApplied.join(", ")}] ` +
              `(${u.beforeVariants.join("|") || "∅"} → ${u.afterVariants.join("|")})`,
          ],
        });
      }
    }
  }

  let fanOutMenus: string[] = [];
  let keepTilbehorMenus: Set<string> = new Set();
  if (input.decisionStore) {
    keepTilbehorMenus = menuNumbersWithKeepTilbehorOverride(
      input.decisionStore.facts,
      input.restaurantKey,
    );
    const fan = fanOutRestaurantAdditions({
      menu,
      registry: input.decisionStore.facts,
      restaurantKey: input.restaurantKey,
    });
    menu = fan.menu;
    fanOutMenus = fan.fanOutMenus;
  }

  if (input.probabilityPolicy) {
    const filtered = applyProbabilityFilterToMenu({
      menu,
      policy: input.probabilityPolicy,
      fanOutMenus,
      keepTilbehorMenus,
    });
    menu = filtered.menu;
    policyTraces.push(...filtered.traces);
  } else {
    // Hard priors without peer policy (drinks never Tilbehør) — fail-closed strip.
    const categories = menu.categories.map((cat) => ({
      ...cat,
      products: cat.products.map((p) => {
        const before = (p.addOns ?? []).map((a) => ({
          name: a.name,
          priceOre: a.price ?? 0,
        }));
        const filter = filterAdditionsWithTrace({
          name: p.name,
          categoryNames: [cat.name],
          additions: before,
          policy: null,
        });
        if (filter.after.length === before.length && filter.removed.length === 0) {
          return p;
        }
        return {
          ...p,
          addOns: filter.after.map((a, idx) => ({
            sourceId: `${p.sourceId}::addon-hard-${idx}`,
            name: a.name,
            price: a.priceOre,
            origin: "DERIVED" as const,
          })),
        };
      }),
    }));
    menu = { ...menu, categories };
  }

  return { menu, policyTraces, fanOutMenus };
}
