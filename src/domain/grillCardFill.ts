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
 * If peer ALLOW rows still fail the burger quality gate (no meat/sauce),
 * merge domain prior so thin peer consensus cannot leave empty meat cards.
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
  const prior = inferGrillIngredients({
    name: input.name,
    ...(input.categoryName ? { categoryName: input.categoryName } : {}),
    ...(input.description ? { description: input.description } : {}),
  });

  if (peer.ingredients.length >= 2) {
    if (!grillIngredientsInsufficient(peer.ingredients, input.name)) {
      return {
        ingredients: peer.ingredients,
        description: peer.description,
        source: peer.source === "NONE" ? "NONE" : peer.source,
        bucketId: peer.bucketId,
      };
    }
    // Peer consensus missing meat/sauce — merge domain prior tokens
    const merged: string[] = [];
    for (const x of [...prior, ...peer.ingredients]) {
      pushUnique(merged, x);
    }
    if (merged.length >= 2) {
      return {
        ingredients: merged,
        description: peer.description ?? (merged.length ? merged.join(", ") : null),
        source: peer.source === "NONE" ? "DOMAIN_PRIOR" : peer.source,
        bucketId: peer.bucketId,
      };
    }
  }

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

/**
 * Paid ekstra on plain burgers/sandwiches (not dips, not pommes).
 * Used when QA/Create strips forbidden/dip Tilbehør and would otherwise leave [].
 */
export const BURGER_EKSTRA_ADDITIONS: Array<{ name: string; priceOre: number }> =
  [
    { name: "Bacon", priceOre: 2000 },
    { name: "Ost", priceOre: 1000 },
    { name: "Salat", priceOre: 1000 },
    { name: "Tomat", priceOre: 1000 },
    { name: "Løg", priceOre: 1000 },
    { name: "Oksekød", priceOre: 2000 },
    { name: "Agurk", priceOre: 1000 },
    { name: "Jalapeños", priceOre: 1000 },
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
  return /\b(grill|burgers?)\b/i.test(categoryName ?? "");
}

export function isBurgerProductName(name: string): boolean {
  return /burger|cafeteria|smash|murphy|crunch|spice\s+me|dirty\s+smash|bearnaise\s+smash|classic\s+smash/i.test(
    name,
  );
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
  // Fries plates / named combo products (not Menu variants — Menu is Menuer category)
  if (/\bmenu\b/i.test(name) && /burger|sandwich|kebab|pita|dürüm|durum/i.test(name)) {
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
    if (ingredients.length < 3) return true;
    const blob = ingredients.join(" ").toLowerCase();
    const hasMeat =
      /\boksekød\b/.test(blob) ||
      /\bbøf\b/.test(blob) ||
      /\bchicken\b/.test(blob) ||
      /\bkylling\b/.test(blob) ||
      /\bcrispy\b/.test(blob);
    if (!hasMeat) return true;
    const hasSauceOrTopping =
      /\b(ketchup|mayo|mayonnaise|remoulade|dressing|sauce|burgersauce|bearnaise|chili|honey|coleslaw|colslaw)\b/.test(
        blob,
      ) || ingredients.length >= 4;
    if (!hasSauceOrTopping) return true;
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

/**
 * After dip/forbidden strip, plain burgers must still get paid ekstra toppings.
 * Never invent dips or pommes here — only sandwich_grill-style ekstra.
 */
export function preferBurgerEkstraAdditions(
  additions: Array<{ name: string; priceOre: number }>,
  input: {
    name: string;
    categoryName?: string;
    description?: string;
  },
): Array<{ name: string; priceOre: number }> {
  if (productWantsGrillDips(input)) return additions;
  const burgerLike =
    isBurgerProductName(input.name) ||
    (/\b(grill|burgers?)\b/i.test(input.categoryName ?? "") &&
      /burger|sandwich|cafeteria|smash|murphy|crunch|spice|dirty|bearnaise/i.test(
        `${input.name} ${input.description ?? ""}`,
      ));
  if (!burgerLike) return additions;
  if (additions.length > 0) return additions;
  return BURGER_EKSTRA_ADDITIONS.map((a) => ({ ...a }));
}
