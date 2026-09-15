/**
 * Grill / finger-food card fill from names + restaurant dip defaults.
 *
 * Live Grill often has Alm/Menu variants but empty ingredients and either
 * no Tilbehør or a dumped pizza-topping list. Name text like "m. pommes frites"
 * is source-supported evidence — not invention.
 *
 * Burgers get a full Danish takeaway baseline (oksekød, salat, sauces, …)
 * plus the specialty named in the title — a single token like "Bacon" is not enough.
 */

import { formatProductName } from "./textNormalize.js";
import { isDipAddition } from "../learning/categoryLikelihood.js";
import {
  proposePeerIngredients,
  type IngredientLikelihoodPolicy,
} from "../learning/ingredientLikelihood.js";

export type GrillIngredientSource =
  | "PEER_SUBTYPE"
  | "PEER_KIND"
  | "DOMAIN_PRIOR"
  | "NONE";

/**
 * Peer-first grill/burger card ingredients; domain prior is fallback only.
 * Corrections that land in peer observe + distill become lasting ALLOW rows.
 */
export function resolveGrillIngredients(input: {
  name: string;
  categoryName?: string;
  description?: string;
  ingredientPolicy?: IngredientLikelihoodPolicy | null;
}): {
  ingredients: string[];
  description: string | null;
  source: GrillIngredientSource;
  bucketId: string | null;
} {
  const peer = proposePeerIngredients({
    name: input.name,
    ...(input.categoryName ? { categoryNames: [input.categoryName] } : {}),
    ...(input.description ? { description: input.description } : {}),
    policy: input.ingredientPolicy ?? null,
  });
  if (peer.ingredients.length >= 2) {
    return {
      ingredients: peer.ingredients,
      description: peer.description,
      source: peer.source === "NONE" ? "NONE" : peer.source,
      bucketId: peer.bucketId,
    };
  }
  const prior = inferGrillIngredients({
    name: input.name,
    ...(input.categoryName ? { categoryName: input.categoryName } : {}),
    ...(input.description ? { description: input.description } : {}),
  });
  if (prior.length === 0) {
    return {
      ingredients: [],
      description: null,
      source: "NONE",
      bucketId: null,
    };
  }
  return {
    ingredients: prior,
    description: null,
    source: "DOMAIN_PRIOR",
    bucketId: null,
  };
}

/** Veroni #49-style restaurant dips (10 kr). */
export const GRILL_DIP_ADDITIONS: Array<{ name: string; priceOre: number }> = [
  { name: "Salatmayonnaise", priceOre: 1000 },
  { name: "Remoulade", priceOre: 1000 },
  { name: "Ketchup", priceOre: 1000 },
];

/** Shared burger build — always include meat + greens + sauces. */
const BURGER_BASE = [
  "Oksekød",
  "Salat",
  "Tomat",
  "Løg",
  "Ketchup",
  "Mayo",
] as const;

const FRIES_IN_NAME_RE = /\b(pommes|frites)\b/i;
const PIZZA_TOPPING_ADD_RE =
  /\b(skinke|bacon|kebab|kylling|pepperoni|champignon|ananas|parmaskinke|kødsovs|kødstrimler|rejer|tun|musling|gorgonzola|jalapeños?|pølse|ost|tomat|løg|paprika|syltet)\b/i;

export function isGrillCategory(categoryName?: string): boolean {
  return /\bgrill\b/i.test(categoryName ?? "");
}

export function isBurgerProductName(name: string): boolean {
  return /burger|cafeteria/i.test(name);
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

function pushUnique(out: string[], raw: string): void {
  const t = formatProductName(raw);
  if (!t) return;
  if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  out.push(t);
}

/** Full burger ingredient list for the card (not paid Tilbehør). */
export function inferBurgerIngredients(name: string): string[] {
  const out: string[] = [];
  for (const b of BURGER_BASE) pushUnique(out, b);

  if (/bacon/i.test(name)) pushUnique(out, "Bacon");
  if (/cheese|ost/i.test(name)) pushUnique(out, "Ost");
  if (/cafeteria|hjemmelavet/i.test(name)) {
    pushUnique(out, "Agurk");
  }
  // Specialty after meat for readable cards
  if (/bacon/i.test(name)) {
    const bacon = out.filter((x) => /bacon/i.test(x));
    const rest = out.filter((x) => !/bacon/i.test(x));
    const meat = rest.filter((x) => /oksekød/i.test(x));
    const other = rest.filter((x) => !/oksekød/i.test(x));
    return [...meat, ...bacon, ...other];
  }
  if (/cheese|ost/i.test(name) && !/bacon/i.test(name)) {
    const cheese = out.filter((x) => /^ost$/i.test(x));
    const rest = out.filter((x) => !/^ost$/i.test(x));
    const meat = rest.filter((x) => /oksekød/i.test(x));
    const other = rest.filter((x) => !/oksekød/i.test(x));
    return [...meat, ...cheese, ...other];
  }
  return out;
}

/**
 * True when live ingredients are too thin for a burger / named grill plate.
 * e.g. Baconburger with only ["Bacon"].
 */
export function grillIngredientsInsufficient(
  ingredients: readonly string[],
  productName: string,
): boolean {
  if (isBurgerProductName(productName)) {
    if (ingredients.length < 4) return true;
    const blob = ingredients.join(" ").toLowerCase();
    if (!/\boksekød\b/.test(blob) && !/\bbøf\b/.test(blob)) return true;
    if (!/\b(ketchup|mayo|mayonnaise|remoulade|dressing)\b/.test(blob)) {
      return true;
    }
    return false;
  }
  if (
    FRIES_IN_NAME_RE.test(productName) &&
    /\b(fiske|kylling|kebab|pølse|nuggets?|grill)\b/i.test(productName) &&
    ingredients.length <= 1
  ) {
    return true;
  }
  return ingredients.length === 0;
}

/**
 * Infer ingredients shown on the card from the product name / known grill copy.
 */
export function inferGrillIngredients(input: {
  name: string;
  categoryName?: string;
  description?: string;
}): string[] {
  const name = input.name.trim();
  if (
    !isGrillCategory(input.categoryName) &&
    !FRIES_IN_NAME_RE.test(name) &&
    !isBurgerProductName(name)
  ) {
    return [];
  }

  const out: string[] = [];
  const push = (s: string) => pushUnique(out, s);

  if (isBurgerProductName(name)) {
    return inferBurgerIngredients(name);
  }

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
  if (/\bfiskefilet\b/i.test(name)) {
    push("Fiskefilet");
    if (FRIES_IN_NAME_RE.test(name)) push("Pommes frites");
    return out;
  }
  if (/\bgrillk[y]?lling\b/i.test(name)) {
    push("Grillkylling");
    if (FRIES_IN_NAME_RE.test(name)) push("Pommes frites");
    return out;
  }
  if (/\bkebabmix\b/i.test(name)) {
    push("Kebab");
    if (FRIES_IN_NAME_RE.test(name)) push("Pommes frites");
    return out;
  }
  if (/\bpølsemix\b/i.test(name)) {
    push("Pølse");
    if (FRIES_IN_NAME_RE.test(name)) push("Pommes frites");
    return out;
  }
  if (FRIES_IN_NAME_RE.test(name)) {
    push("Pommes frites");
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
    if (!live || /m\.\s*pommes/i.test(live) || /pommes frites,\s*m\./i.test(live)) {
      return "Pitabrød, pommes frites og sodavand";
    }
  }
  if (/^pommes\b/i.test(name) && !live) {
    return "Valgfri dyppelse";
  }
  if (
    (isBurgerProductName(name) || FRIES_IN_NAME_RE.test(name)) &&
    (input.ingredients?.length ?? 0) >= 2
  ) {
    if (!live || live.length < 12 || grillIngredientsInsufficient(
      live.split(/\s*,\s*/),
      name,
    )) {
      return input.ingredients!.join(", ");
    }
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
  if (additions.length === 0) return true;
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
  const hasDips = additions.some((a) => isDipAddition(a.name));
  if (hasDips) return additions;
  return GRILL_DIP_ADDITIONS.map((a) => ({ ...a }));
}
