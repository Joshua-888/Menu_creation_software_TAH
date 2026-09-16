/**
 * Hard SEMANTIC_RULE: Menu column prices become Menuer category products —
 * never Alm./Menu variants on the burger card.
 *
 * Each Menuer item is priced at the Menu column total and requires
 * fries + dip + soda sub-choices (combo composition).
 */

import type {
  SourceCategory,
  SourceMenu,
  SourceProduct,
  SourceProductChoice,
} from "../domain/schema/source.js";

const MENUER_CATEGORY = "Menuer";

function menuPriceOre(product: SourceProduct): number | null {
  const opt = (product.sourcePriceOptions ?? []).find(
    (o) => /^menu$/i.test(o.label.trim()),
  );
  return opt?.sourceTotalPrice ?? null;
}

function basePriceOre(product: SourceProduct): number | null {
  const opt = (product.sourcePriceOptions ?? []).find(
    (o) => /^base$/i.test(o.label.trim()),
  );
  if (opt?.sourceTotalPrice != null) return opt.sourceTotalPrice;
  const alm = product.variants.find((v) => /^alm\.?$/i.test(v.name));
  return alm?.sourceTotalPrice ?? null;
}

function menuerChoices(burgerSourceId: string): SourceProductChoice[] {
  return [
    {
      sourceId: `${burgerSourceId}::menuer-choice-burger`,
      prompt: "Burger",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: [{ productSourceId: burgerSourceId, label: "Inkluderet" }],
    },
    {
      sourceId: `${burgerSourceId}::menuer-choice-fries`,
      prompt: "Fries",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        {
          productSourceId: `${burgerSourceId}::menuer-fries`,
          label: "Fries",
        },
      ],
    },
    {
      sourceId: `${burgerSourceId}::menuer-choice-dip`,
      prompt: "Dip",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        {
          productSourceId: `${burgerSourceId}::menuer-dip`,
          label: "Dip",
        },
      ],
    },
    {
      sourceId: `${burgerSourceId}::menuer-choice-soda`,
      prompt: "Sodavand",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        {
          productSourceId: `${burgerSourceId}::menuer-soda`,
          label: "Sodavand",
        },
      ],
    },
  ];
}

/**
 * Append a Menuer category with one combo product per source item that has a
 * Menu price option. Does not mutate the input menu.
 */
export function synthesizeMenuerProductsFromMenuPrices(
  menu: SourceMenu,
): SourceMenu {
  const menuerProducts: SourceProduct[] = [];
  let order = 0;

  for (const cat of menu.categories) {
    if (/^menuer$/i.test(cat.name.trim())) continue;
    for (const p of cat.products) {
      const menuOre = menuPriceOre(p);
      if (menuOre == null) continue;
      const baseOre = basePriceOre(p);
      // Skip if Menu option equals base (not a real combo upsell)
      if (baseOre != null && menuOre <= baseOre) continue;

      const name = /menu\b/i.test(p.name) ? p.name : `${p.name} Menu`;
      const sourceId = `src:menuer:${p.sourceId}`;
      menuerProducts.push({
        sourceId,
        name,
        description: `Menu: ${p.name}, fries, dip & sodavand`,
        sourceOrder: order++,
        ingredients: [],
        variants: [
          {
            sourceId: `${sourceId}::v-alm`,
            name: "Alm.",
            sourceTotalPrice: menuOre,
            evidence: p.evidence,
          },
        ],
        addOns: [],
        productChoices: menuerChoices(p.sourceId),
        isCombo: true,
        confidence: p.confidence ?? 0.75,
        ...(p.evidence ? { evidence: p.evidence } : {}),
      });
    }
  }

  if (!menuerProducts.length) return menu;

  const existingMenuer = menu.categories.find((c) =>
    /^menuer$/i.test(c.name.trim()),
  );
  const otherCats = menu.categories.filter(
    (c) => !/^menuer$/i.test(c.name.trim()),
  );

  const menuerCat: SourceCategory = existingMenuer
    ? {
        ...existingMenuer,
        products: [...existingMenuer.products, ...menuerProducts],
      }
    : {
        sourceId: "cat:menuer",
        name: MENUER_CATEGORY,
        sourceOrder: otherCats.length,
        commonIngredients: [],
        products: menuerProducts,
      };

  const categories = existingMenuer
    ? menu.categories.map((c) =>
        /^menuer$/i.test(c.name.trim()) ? menuerCat : c,
      )
    : [
        ...otherCats.map((c, idx) => ({ ...c, sourceOrder: idx })),
        { ...menuerCat, sourceOrder: otherCats.length },
      ];

  return { ...menu, categories };
}
