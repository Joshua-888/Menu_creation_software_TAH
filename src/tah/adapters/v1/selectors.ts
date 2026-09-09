import { ADMIN_CONTRACT_V1 } from "../../contracts/v1.js";

/** Centralized CSS/id selectors for adapter v1 (no Playwright imports here). */
export const V1_SELECTORS = {
  menuNumber: "#menu_number",
  productName: "#name",
  description: "#description",
  basePrice: "#price",
  categoryCheckboxes: "input[type='checkbox'][name='categories[]']",
  categoryFilter: "select#category",
  variantList: "#variant-list",
  addVariant: "#add-variant",
  variantName: "input.variant-name",
  variantPrice: "input.variant-price",
  ingredientList: "#ingredient-list",
  addIngredient: "#add-ingredient",
  ingredientName: "input.ingredient-name",
  additionList: "#addition-list",
  addAddition: "#add-addition",
  additionName: "input.addition-name",
  additionPrice: "input.addition-price",
  image: "#image",
  active: "#active",
  blueprintVariant: "#blueprint-variant",
  blueprintIngredient: "#blueprint-ingredient",
  blueprintAddition: "#blueprint-addition",
} as const;

export const V1_ROUTES = ADMIN_CONTRACT_V1.routes;
