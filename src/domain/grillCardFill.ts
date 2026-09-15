/**
 * Grill / finger-food card fill from names + restaurant dip defaults.
 *
 * Live Grill often has Alm/Menu variants but empty ingredients and either
 * no Tilbehør or a dumped pizza-topping list. Name text like "m. pommes frites"
 * is source-supported evidence — not invention.
 */

import { formatProductName } from "./textNormalize.js";
import { isDipAddition } from "../learning/categoryLikelihood.js";

/** Veroni #49-style restaurant dips (10 kr). */
export const GRILL_DIP_ADDITIONS: Array<{ name: string; priceOre: number }> = [
  { name: "Salatmayonnaise", priceOre: 1000 },
  { name: "Remoulade", priceOre: 1000 },
  { name: "Ketchup", priceOre: 1000 },
];

const FRIES_IN_NAME_RE = /\b(pommes|frites)\b/i;
const PIZZA_TOPPING_ADD_RE =
  /\b(skinke|bacon|kebab|kylling|pepperoni|champignon|ananas|parmaskinke|kødsovs|kødstrimler|rejer|tun|musling|gorgonzola|jalapeños?|pølse|ost|tomat|løg|paprika|syltet)\b/i;

export function isGrillCategory(categoryName?: string): boolean {
  return /\bgrill\b/i.test(categoryName ?? "");
}

export function productWantsGrillDips(input: {
  name: string;
  categoryName?: string;
  description?: string;
  variants?: Array<{ name: string }>;
}): boolean {
  const name = input.name ?? "";
  const blob = `${name} ${input.categoryName ?? ""} ${input.description ?? ""}`;
  if (/\b(soda|sodavand|øl|vin|juice|kaffe|\bte\b)\b/i.test(name)) return false;
  // Finger food / fries plates / pommes / nuggets
  if (FRIES_IN_NAME_RE.test(blob)) return true;
  if (/\b(nuggets?|pommes)\b/i.test(name)) return true;
  if (/\bvalgfri\s+dyppelse\b/i.test(blob)) return true;
  if (/\bkebabmenu\b/i.test(name)) return true;
  if (/\bekstra\s*tilbeh/i.test(name)) return true;
  // Burger/sandwich with a Menu size variant ⇒ fries menu deal
  const hasMenuVariant = (input.variants ?? []).some((v) =>
    /\bmenu\b/i.test(v.name),
  );
  if (
    hasMenuVariant &&
    /burger|sandwich|pita|pitabrød|dürüm|durum|cafeteria/i.test(name)
  ) {
    return true;
  }
  return false;
}

/**
 * Infer ingredients shown on the card from the product name / known grill copy.
 */
export function inferGrillIngredients(input: {
  name: string;
  categoryName?: string;
  description?: string;
}): string[] {
  if (!isGrillCategory(input.categoryName) && !FRIES_IN_NAME_RE.test(input.name)) {
    // Still allow fries-named products outside Grill
    if (!FRIES_IN_NAME_RE.test(input.name) && !/\bgrill\b/i.test(input.name)) {
      return [];
    }
  }
  const name = input.name.trim();
  const out: string[] = [];
  const push = (s: string) => {
    const t = formatProductName(s);
    if (!t) return;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };

  if (/\bekstra\s*tilbeh/i.test(name)) {
    push("Salatmayonnaise");
    push("Remoulade");
    push("Ketchup");
    return out;
  }
  if (/\bkebabmenu\b/i.test(name)) {
    push("Pitabrød");
    push("Pommes frites");
    push("Sodavand");
    return out;
  }
  if (/^pommes\b/i.test(name) || /^pommes\s*frites\b/i.test(name)) {
    push("Pommes frites");
    return out;
  }
  if (/\bnuggets?\b/i.test(name)) {
    push("Nuggets");
    if (FRIES_IN_NAME_RE.test(name)) push("Pommes frites");
    return out;
  }
  if (FRIES_IN_NAME_RE.test(name)) {
    // "Fiskefilet m. pommes frites", "Kebabmix m. pommes frites", …
    push("Pommes frites");
    return out;
  }
  if (/\bbaconburger\b/i.test(name)) {
    push("Bacon");
    return out;
  }
  if (/\bcheeseburger\b/i.test(name)) {
    push("Ost");
    return out;
  }
  return out;
}

export function inferGrillDescription(input: {
  name: string;
  categoryName?: string;
  description?: string;
  ingredients?: string[];
}): string | null {
  const name = input.name.trim();
  const live = (input.description ?? "").trim();
  if (/\bekstra\s*tilbeh/i.test(name)) {
    return "Salatmayonnaise, remoulade og ketchup";
  }
  if (/\bkebabmenu\b/i.test(name)) {
    // Fix OCR garbage like "Pommes frites, M. pommes frites"
    if (!live || /m\.\s*pommes/i.test(live) || /pommes frites,\s*m\./i.test(live)) {
      return "Pitabrød, pommes frites og sodavand";
    }
  }
  if (/^pommes\b/i.test(name) && !live) {
    return "Valgfri dyppelse";
  }
  if (
    FRIES_IN_NAME_RE.test(name) &&
    (!live || live.length < 4) &&
    (input.ingredients?.length ?? 0) > 0
  ) {
    return input.ingredients!.join(", ");
  }
  return null;
}

/** True when Tilbehør looks like a pizza dump on a fries/dip product. */
export function grillTilbehorLooksWrong(
  additions: Array<{ name: string }>,
  input: { name: string; categoryName?: string; description?: string },
): boolean {
  if (!productWantsGrillDips(input)) return false;
  if (additions.length === 0) return true; // missing required dips
  const dipCount = additions.filter((a) => isDipAddition(a.name)).length;
  const pizzaLike = additions.filter((a) =>
    PIZZA_TOPPING_ADD_RE.test(a.name),
  ).length;
  if (dipCount === 0 && pizzaLike >= 2) return true;
  if (additions.length >= 8 && dipCount < 2) return true;
  return false;
}

/**
 * Prefer restaurant dips for grill finger-food / fries menus.
 * Replaces empty or pizza-dumped Tilbehør lists.
 */
export function preferGrillDipAdditions(
  additions: Array<{ name: string; priceOre: number }>,
  input: {
    name: string;
    categoryName?: string;
    description?: string;
    variants?: Array<{ name: string }>;
  },
): Array<{ name: string; priceOre: number }> {
  if (!productWantsGrillDips(input)) return additions;
  if (grillTilbehorLooksWrong(additions, input) || additions.length === 0) {
    return GRILL_DIP_ADDITIONS.map((a) => ({ ...a }));
  }
  // Keep existing if dips already present
  const hasDips = additions.some((a) => isDipAddition(a.name));
  if (hasDips) return additions;
  return GRILL_DIP_ADDITIONS.map((a) => ({ ...a }));
}
