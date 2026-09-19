/**
 * Single authoritative Menu Intelligence Engine.
 * CREATE_MENU and QA_RECONCILE both call this — no separate semantic paths.
 */

import type { CanonicalMenu } from "../domain/schema/canonical.js";
import { applyPizzaToppingRecovery } from "../planning/applyPizzaToppingRecovery.js";
import { completeCanonicalMenuCards } from "./completeProductCard.js";
import { applyApprovedFactsToMenu } from "./applyApprovedFacts.js";
import { dropInvalidHeadingProducts } from "./dropInvalidHeadings.js";
import {
  evaluateMenuQualityContract,
  qualityContractBlocksWrite,
} from "./qualityContract.js";
import {
  MENU_CONSTITUTION_VERSION,
  MENU_AS_VARIANT_SUPERSESSION,
} from "./constitution.js";
import type {
  MenuIntelligenceInput,
  MenuIntelligenceResult,
} from "./types.js";
import type { ProbabilityPolicyMap } from "../learning/categoryLikelihood.js";

/**
 * Run the unified intelligence pipeline on a canonical menu.
 *
 * Flow:
 * pizza recovery → drop OCR heading products → approved facts → complete → quality
 */
export function runMenuIntelligence(
  input: MenuIntelligenceInput & {
    probabilityPolicy?: ProbabilityPolicyMap | null;
  },
): MenuIntelligenceResult {
  const recovered = applyPizzaToppingRecovery(input.canonicalMenu);
  let menu: CanonicalMenu = recovered.menu;

  const droppedHeadings = dropInvalidHeadingProducts(menu);
  menu = droppedHeadings.menu;

  const facts = applyApprovedFactsToMenu({
    menu,
    restaurantKey: input.restaurantKey,
    decisionStore: input.decisionStore ?? null,
    probabilityPolicy: input.probabilityPolicy ?? null,
  });
  menu = facts.menu;

  const completed = completeCanonicalMenuCards({
    menu,
    ingredientLikelihood: input.ingredientLikelihood ?? null,
    preserveLiveRichness: input.mode === "QA_RECONCILE",
  });
  menu = completed.menu;

  const quality = evaluateMenuQualityContract(menu);
  const writeGate = qualityContractBlocksWrite(quality);

  const policyTraces = completed.traces.map((card, idx) => {
    const product = menu.categories
      .flatMap((c) => c.products.map((p) => ({ p, cat: c.name })))
      .find((x) => x.p.name === card.name);
    const pq = quality.products.find(
      (q) => q.name === card.name || q.productSourceId === product?.p.sourceId,
    );
    return {
      productSourceId: product?.p.sourceId ?? `trace-${idx}`,
      name: card.name,
      category: card.categoryName,
      fields: {
        name: {
          value: card.name,
          source:
            (card.provenance.find((p) => p.field === "name")?.origin ===
            "SEMANTIC_RULE"
              ? "SEMANTIC_RULE"
              : "SOURCE") as string,
          policy:
            (
              card.policyTrace.categoryQualifiedProductName as
                | { policyId?: string }
                | undefined
            )?.policyId ?? null,
        },
        ingredients: card.ingredients.map((v) => ({
          value: v,
          origin: card.policyTrace.ingredientOrigin,
        })),
        description: {
          value: card.description,
          policy: "generated_from_final_ingredients",
          constitution: MENU_CONSTITUTION_VERSION,
        },
        additions: card.additions.map((a) => ({
          name: a.name,
          priceOre: a.priceOre,
          priceProvenance: a.priceProvenance ?? null,
        })),
        variants: card.variants,
        combo: {
          isCombo: card.isCombo,
          menuAsVariantPolicy: MENU_AS_VARIANT_SUPERSESSION,
        },
        provenance: card.provenance,
        policyTrace: card.policyTrace,
        approvedFactsTraces: facts.policyTraces.filter(
          (t) => t.sourceId === product?.p.sourceId,
        ),
        droppedHeadingsInCategory: droppedHeadings.dropped.filter(
          (d) => d.categoryName === card.categoryName,
        ),
      },
      qualityChecks: pq?.checks ?? [],
      // WP4: additive per-field completeness explainability. Existing consumers
      // of policyTraces (portal, reports) are unaffected — this is a new optional
      // field, not a reshape of existing trace data.
      completenessTraces: card.completenessTraces,
    };
  });

  return {
    constitutionVersion: MENU_CONSTITUTION_VERSION,
    mode: input.mode,
    targetMenu: menu,
    quality,
    policyTraces,
    writeEligible: !writeGate.blocked && quality.readyProductIds.length > 0,
    ...(writeGate.reason ? { writeBlockReason: writeGate.reason } : {}),
  };
}

export type { MenuIntelligenceInput, MenuIntelligenceResult };
