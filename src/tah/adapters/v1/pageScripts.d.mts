export type ProductListRow = {
  databaseId: string | null;
  menuNumber: string | null;
  name: string;
  categoryText: string | null;
  priceText: string | null;
  statusText: string | null;
  editPath: string | null;
  showPath: string | null;
};

export type CategoryRow = {
  databaseId: string;
  name: string;
  order: number | null;
  itemCount: number | null;
  editPath: string;
};

export type ProductEditExtract = {
  menuNumber: string | null;
  name: string | null;
  description: string | null;
  basePriceRaw: string | null;
  active: boolean | null;
  categoryIds: string[];
  variants: Array<{
    databaseId: string | null;
    name: string;
    priceRaw: string;
    index: number;
  }>;
  ingredients: Array<{
    databaseId: string | null;
    name: string;
    index: number;
  }>;
  additions: Array<{
    databaseId: string | null;
    name: string;
    priceRaw: string;
    index: number;
  }>;
  formAction: string | null;
  formMethod: string | null;
  formMethodOverride: string | null;
  hasExistingImageHint: boolean;
};

export type VisibleProductFields = {
  menuNumber: string | null;
  name: string | null;
  description: string | null;
  basePrice: string | null;
  active: boolean | null;
  variantNames: string[];
  variantPrices: string[];
  ingredientNames: string[];
  additionNames: string[];
  additionPrices: string[];
  categoryIds: string[];
};

export function extractProductListRows(): ProductListRow[];
export function extractCategoryRows(): CategoryRow[];
export function extractProductEdit(selectors: {
  productUpdateForm: string;
  menuNumber: string;
  productName: string;
  description: string;
  basePrice: string;
  active: string;
  categoryCheckboxes: string;
}): ProductEditExtract;
export function extractVisibleProductFields(): VisibleProductFields;
