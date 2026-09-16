/**
 * Drop OCR section-heading / meta / marketing / variant-label rows mistaken as products.
 * Objective rules only — does not invent replacements.
 */

import type { CanonicalMenu } from "../domain/schema/canonical.js";
import { classifyPhrase } from "./semanticClassifier.js";
import { looksLikeToppingAsProductName } from "../domain/menuCardQuality.js";
import { looksLikeGarbageName } from "../domain/textNormalize.js";

export type DroppedHeadingProduct = {
  sourceId: string;
  name: string;
  categoryName: string;
  reason: string;
};

const MARKETING_PROSE_RE =
  /\b(kan rumme|siddende gæster|velkommen|åbningstid|åbent|telefon|adresse)\b/i;

const BARE_CATEGORY_RE =
  /^(forretter|hovedretter|desserter|drikkevarer|tilbehør|sides|menuer|indisk(\s+forretter)?|vegetar|nudler(\s+og\s+ris)?)$/i;

const VARIANT_LABEL_ONLY_RE =
  /^(stor(\s+\/?\s*lille)?|lille(\s+\/?\s*stor)?|alm\.?(\s*\/\s*familie)?|familie)$/i;

const META_PRODUCT_RE =
  /^(valgfri(\s+\w+)?|ekstra\s+tilbehør|tilbehør|diverse|andet)$/i;

/**
 * Remove products that are clearly not dish titles.
 */
export function dropInvalidHeadingProducts(menu: CanonicalMenu): {
  menu: CanonicalMenu;
  dropped: DroppedHeadingProduct[];
} {
  const dropped: DroppedHeadingProduct[] = [];
  const categories = menu.categories.map((cat) => {
    const products = cat.products.filter((p) => {
      const name = (p.name ?? "").trim();
      const cls = classifyPhrase(name, { layoutRole: "product" });
      const sameAsCategory =
        name.toLowerCase() === cat.name.trim().toLowerCase() ||
        (cls.entityType === "CATEGORY" &&
          cat.name.toLowerCase().includes(name.toLowerCase()) &&
          name.length <= cat.name.length + 2);

      if (cls.entityType === "META_INSTRUCTION" || META_PRODUCT_RE.test(name)) {
        dropped.push({
          sourceId: p.sourceId,
          name,
          categoryName: cat.name,
          reason: "OCR_META_AS_PRODUCT",
        });
        return false;
      }

      if (
        BARE_CATEGORY_RE.test(name) ||
        sameAsCategory ||
        (cls.entityType === "CATEGORY" && name.split(/\s+/).length <= 3)
      ) {
        if (/\b(hawaii|pepperoni|margarita|vesuvio|calzone|bambino)\b/i.test(name)) {
          return true;
        }
        if (name.split(/\s+/).length >= 2 && !sameAsCategory && !BARE_CATEGORY_RE.test(name)) {
          return true;
        }
        dropped.push({
          sourceId: p.sourceId,
          name,
          categoryName: cat.name,
          reason: "OCR_CATEGORY_HEADING_AS_PRODUCT",
        });
        return false;
      }

      if (MARKETING_PROSE_RE.test(name) || /^restaurant$/i.test(name)) {
        dropped.push({
          sourceId: p.sourceId,
          name,
          categoryName: cat.name,
          reason: "OCR_MARKETING_PROSE_AS_PRODUCT",
        });
        return false;
      }

      if (VARIANT_LABEL_ONLY_RE.test(name)) {
        dropped.push({
          sourceId: p.sourceId,
          name,
          categoryName: cat.name,
          reason: "OCR_VARIANT_LABEL_AS_PRODUCT",
        });
        return false;
      }

      // Ingredient-phrase mistaken as pasta/sauce product with no dish structure
      if (
        /^(klassisk\s+italiensk\s+kødsovs|kødsovs|kødsauce)$/i.test(name) &&
        p.ingredients.length === 0
      ) {
        dropped.push({
          sourceId: p.sourceId,
          name,
          categoryName: cat.name,
          reason: "INGREDIENT_PHRASE_AS_PRODUCT",
        });
        return false;
      }

      // Pure ingredient token that is NOT a known pizza dish style
      if (
        cls.entityType === "INGREDIENT" &&
        !/\b(hawaii|pepperoni|margarita|vesuvio|calzone|bambino)\b/i.test(name) &&
        name.split(/\s+/).length <= 2
      ) {
        const hasPizzaStructure =
          /pizza|calzone|ufo|indbagt/i.test(cat.name) &&
          (p.variants.length > 0 ||
            p.ingredients.some((i) => /tomat|ost/i.test(i.display)));
        // Keep only if it is a known pizza-style title; else drop OCR topping rows
        if (!hasPizzaStructure || !/\b(pepperoni|hawaii|margarita|vesuvio)\b/i.test(name)) {
          dropped.push({
            sourceId: p.sourceId,
            name,
            categoryName: cat.name,
            reason: "TOPPING_TOKEN_AS_PRODUCT",
          });
          return false;
        }
      }

      // OCR junk: "Josu Tomat" / random + topping
      if (
        /\btomat\b/i.test(name) &&
        !/pizza|salat|suppe|sauce/i.test(name) &&
        /^[A-Za-zÆØÅæøå]{2,8}\s+Tomat$/i.test(name) &&
        !/^(cherry|soltørret)\s+tomat$/i.test(name)
      ) {
        dropped.push({
          sourceId: p.sourceId,
          name,
          categoryName: cat.name,
          reason: "OCR_GARBAGE_TOPPING_NAME",
        });
        return false;
      }

      if (looksLikeGarbageName(name) || looksLikeToppingAsProductName(name)) {
        const hasPrice =
          p.basePrice != null ||
          p.variants.some((v) => (v.sourceTotalPrice ?? 0) > 0);
        if (!hasPrice && p.ingredients.length === 0) {
          dropped.push({
            sourceId: p.sourceId,
            name,
            categoryName: cat.name,
            reason: looksLikeGarbageName(name)
              ? "OCR_GARBAGE_PRODUCT_NAME"
              : "TOPPING_AS_PRODUCT_NAME",
          });
          return false;
        }
      }
      return true;
    });
    return { ...cat, products };
  });

  // Also drop combo/menu clones of dropped garbage titles
  const droppedNameKeys = new Set(
    dropped.map((d) => d.name.trim().toLowerCase()),
  );
  const categories2 = categories.map((cat) => {
    if (!/^menuer$/i.test(cat.name)) return cat;
    const products = cat.products.filter((p) => {
      const base = (p.name ?? "")
        .replace(/\s+menu$/i, "")
        .trim()
        .toLowerCase();
      if (
        droppedNameKeys.has(base) ||
        BARE_CATEGORY_RE.test(base) ||
        VARIANT_LABEL_ONLY_RE.test(base) ||
        META_PRODUCT_RE.test(base)
      ) {
        dropped.push({
          sourceId: p.sourceId,
          name: p.name,
          categoryName: cat.name,
          reason: "OCR_GARBAGE_MENU_CLONE",
        });
        return false;
      }
      return true;
    });
    return { ...cat, products };
  });

  return {
    menu: { ...menu, categories: categories2 },
    dropped,
  };
}
