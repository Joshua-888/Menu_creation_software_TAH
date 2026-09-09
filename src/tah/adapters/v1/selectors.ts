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
  variantIdHidden: "tr.variant-form input[name*='[id]']",
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
  /** Prefer update form that owns product fields; ignore delete/logout forms. */
  productUpdateForm: "form:has(#menu_number)",
  productEditLink: "a[href*='/admin/menu/'][href$='/edit']",
} as const;

/** Unwrapped route strings (contract stores Evidenced values). */
export const V1_ROUTES = {
  login: ADMIN_CONTRACT_V1.routes.login.value,
  dashboard: ADMIN_CONTRACT_V1.routes.dashboard.value,
  menuList: ADMIN_CONTRACT_V1.routes.menuList.value,
  menuCreate: ADMIN_CONTRACT_V1.routes.menuCreate.value,
  menuEditPattern: ADMIN_CONTRACT_V1.routes.menuEditPattern.value,
  menuUpdateAction: ADMIN_CONTRACT_V1.routes.menuUpdateAction.value,
  categoriesList: ADMIN_CONTRACT_V1.routes.categoriesList.value,
  categoryEditPattern: ADMIN_CONTRACT_V1.routes.categoryEditPattern.value,
  categoryShowPattern: ADMIN_CONTRACT_V1.routes.categoryShowPattern.value,
} as const;

export function menuEditPath(databaseId: string): string {
  return `/admin/menu/${databaseId}/edit`;
}
