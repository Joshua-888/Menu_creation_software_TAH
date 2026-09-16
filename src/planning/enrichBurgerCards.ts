/**
 * Fill thin burger/grill cards before Tilbehør union + Create dry-run.
 * Order: source OCR ingredients → peer subtype/kind → domain prior.
 * Never restaurant-specific dish lists.
 */

import type { CanonicalMenu, CanonicalProduct } from "../domain/schema/canonical.js";
import {
  grillIngredientsInsufficient,
  isBurgerProductName,
  isGrillCategory,
  resolveGrillIngredients,
} from "../domain/grillCardFill.js";
import { classifyProductKind } from "../learning/categoryLikelihood.js";
import type { IngredientLikelihoodPolicy } from "../learning/ingredientLikelihood.js";

function enrichProduct(
  product: CanonicalProduct,
  categoryName: string,
  ingredientLikelihood?: IngredientLikelihoodPolicy | null,
): CanonicalProduct {
  const kind = classifyProductKind({
    name: product.name,
    categoryNames: [categoryName],
    ...(product.description ? { description: product.description } : {}),
  });
  const burgerLike =
    kind === "sandwich_grill" ||
    isBurgerProductName(product.name) ||
    isGrillCategory(categoryName);
  if (!burgerLike) return product;

  const existing = (product.ingredients ?? []).map((i) => i.display);
  const desc = product.description ?? "";
  if (
    existing.length >= 3 &&
    !grillIngredientsInsufficient(existing, product.name) &&
    desc.trim().length >= 8
  ) {
    return product;
  }

  const resolved = resolveGrillIngredients({
    name: product.name,
    categoryName,
    description: desc,
    ...(ingredientLikelihood != null
      ? { ingredientPolicy: ingredientLikelihood }
      : {}),
  });

  let ingredients = existing;
  if (
    resolved.ingredients.length > existing.length ||
    grillIngredientsInsufficient(existing, product.name)
  ) {
    ingredients =
      resolved.ingredients.length >= Math.max(2, existing.length)
        ? resolved.ingredients
        : existing.length
          ? existing
          : resolved.ingredients;
  }

  let description = desc.trim();
  if ((!description || description.length < 8) && ingredients.length >= 2) {
    description = ingredients.join(", ");
  } else if (resolved.description && (!description || description.length < 8)) {
    description = resolved.description;
  }

  return {
    ...product,
    ingredients: ingredients.map((display) => ({
      display,
      origin: "SYSTEM_DEFAULT" as const,
    })),
    ...(description ? { description } : {}),
  };
}

export function enrichCanonicalBurgerCards(
  menu: CanonicalMenu,
  ingredientLikelihood?: IngredientLikelihoodPolicy | null,
): CanonicalMenu {
  return {
    ...menu,
    categories: menu.categories.map((cat) => ({
      ...cat,
      products: cat.products.map((p) =>
        enrichProduct(p, cat.name, ingredientLikelihood),
      ),
    })),
  };
}
