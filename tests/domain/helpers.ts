import { kronerToOre } from "../../src/domain/money.js";
import type {
  SourceCategory,
  SourceIngredient,
  SourceMenu,
  SourceProduct,
  SourceVariant,
} from "../../src/domain/schema/source.js";

export function ing(
  display: string,
  origin: SourceIngredient["origin"] = "SOURCE",
): SourceIngredient {
  return { display, origin };
}

export function variant(
  sourceId: string,
  name: string,
  opts?: {
    totalKroner?: number;
    explicitSurchargeKroner?: number;
  },
): SourceVariant {
  const v: SourceVariant = { sourceId, name };
  if (opts?.totalKroner !== undefined) {
    v.sourceTotalPrice = kronerToOre(opts.totalKroner);
  }
  if (opts?.explicitSurchargeKroner !== undefined) {
    v.sourceExplicitSurcharge = kronerToOre(opts.explicitSurchargeKroner);
  }
  return v;
}

export function product(
  partial: Omit<SourceProduct, "ingredients" | "variants" | "addOns" | "productChoices" | "isCombo"> &
    Partial<
      Pick<
        SourceProduct,
        "ingredients" | "variants" | "addOns" | "productChoices" | "isCombo"
      >
    >,
): SourceProduct {
  return {
    ingredients: [],
    variants: [],
    addOns: [],
    productChoices: [],
    isCombo: false,
    ...partial,
  };
}

export function category(
  partial: Omit<SourceCategory, "commonIngredients" | "products"> &
    Partial<Pick<SourceCategory, "commonIngredients" | "products">>,
): SourceCategory {
  return {
    commonIngredients: [],
    products: [],
    ...partial,
  };
}

export function menu(
  partial: Omit<SourceMenu, "categories"> & { categories: SourceCategory[] },
): SourceMenu {
  return partial;
}

export { kronerToOre };
