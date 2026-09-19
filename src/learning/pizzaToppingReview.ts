/**
 * Seed review when pizza-like products still lack ingredients after description recovery.
 */

import type { CanonicalMenu, CanonicalProduct } from "../domain/schema/canonical.js";
import { proposePizzaToppingsFromDescription } from "./pizzaToppings.js";
import { productLooksPizzaLike } from "./pizzaToppings.js";

export const PIZZA_TOPPING_DECISION_TYPE = "INGREDIENT_SEMANTICS";

export function findPizzaMissingIngredientProducts(menu: CanonicalMenu): Array<{
  product: CanonicalProduct;
  categoryName: string;
  proposal: ReturnType<typeof proposePizzaToppingsFromDescription>;
}> {
  const out: Array<{
    product: CanonicalProduct;
    categoryName: string;
    proposal: ReturnType<typeof proposePizzaToppingsFromDescription>;
  }> = [];
  for (const cat of menu.categories) {
    for (const p of cat.products) {
      const hasIng = (p.ingredients ?? []).some((i) => i.display?.trim());
      if (hasIng) continue;
      if (
        !productLooksPizzaLike({
          name: p.name,
          categoryName: cat.name,
        })
      ) {
        continue;
      }
      const proposal = proposePizzaToppingsFromDescription({
        name: p.name,
        categoryName: cat.name,
        description: p.description ?? "",
        existingIngredients: [],
      });
      out.push({ product: p, categoryName: cat.name, proposal });
    }
  }
  return out;
}

/** Questions for pizza products where description recovery already applied (info) or still missing. */
export function pizzaToppingReviewQuestions(
  menu: CanonicalMenu,
  limit = 15,
): Array<{
  decisionCaseId: string | null;
  questionType: string;
  title: string;
  prompt: string;
  optionsJson: string;
  productRef: string | null;
  batchKey: string | null;
}> {
  const hits = findPizzaMissingIngredientProducts(menu).slice(0, limit);
  return hits.map(({ product, categoryName, proposal }) => {
    const menuNumber =
      product.sourceMenuNumber ?? product.assignedMenuNumber ?? "?";
    if (proposal && proposal.ingredients.length > 0) {
      return {
        decisionCaseId: null,
        questionType: PIZZA_TOPPING_DECISION_TYPE,
        title: `Pizza toppings recovered · #${menuNumber} ${product.name}`,
        prompt: `Description → ingredients for #${menuNumber} (${categoryName}): ${proposal.ingredients.join(", ")}.${
          proposal.excludedDips.length
            ? ` Excluded dips: ${proposal.excludedDips.join(", ")}.`
            : ""
        } Dry-run CREATE will use these as DERIVED toppings.`,
        optionsJson: JSON.stringify([
          {
            id: "accept_recovered",
            label: "Accept recovered toppings",
            resolution: "ACCEPT_RECOVERED_TOPPINGS",
          },
          {
            id: "needs_manual",
            label: "Needs manual ingredient edit",
            resolution: "NEEDS_MANUAL_INGREDIENTS",
          },
        ]),
        productRef: product.sourceId,
        batchKey: `${PIZZA_TOPPING_DECISION_TYPE}:recovered:${menuNumber}`,
      };
    }
    return {
      decisionCaseId: null,
      questionType: PIZZA_TOPPING_DECISION_TYPE,
      title: `Missing pizza ingredients · #${menuNumber} ${product.name}`,
      prompt: `#${menuNumber} ${product.name} (${categoryName}) has no source ingredients and description did not yield a topping list. Provide toppings in source/re-extract before live create.`,
      optionsJson: JSON.stringify([
        {
          id: "needs_source_fix",
          label: "Needs better source / re-extract",
          resolution: "NEEDS_SOURCE_FIX",
        },
        {
          id: "skip_product",
          label: "Skip product in dry-run plan",
          resolution: "SKIP_PRODUCT",
        },
      ]),
      productRef: product.sourceId,
      batchKey: `${PIZZA_TOPPING_DECISION_TYPE}:missing:${menuNumber}`,
    };
  });
}
