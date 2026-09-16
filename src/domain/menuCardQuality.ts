/**
 * Premium menu-card quality policies.
 *
 * Hard rules operators expect:
 * - One real food item per ingredient / Tilbehør row (never "Skinkeog ananas")
 * - Never use dish names, "Tilbehør", or gibberish as ingredients/additions
 * - Product name is a dish title — not an ingredient dump
 * - Tilbehør prices vary: meat ≈ 2× vegetable/dip baseline
 */

import { isForbiddenMenuVariantName } from "../learning/categorySizeVariantPolicy.js";
import type {
  MigrationWritePlan,
  PlannedProductPayload,
} from "../runner/writePlan.js";
import {
  isBurgerProductName,
  isGrillCategory,
} from "./grillCardFill.js";
import { capitalizeFirstLetter, formatProductName } from "./textNormalize.js";

/** Baseline vegetable / dip Tilbehør price (10 kr). */
export const TILBEHOR_VEG_PRICE_ORE = 1000;
/** Meat Tilbehør price (20 kr) — typically double greens. */
export const TILBEHOR_MEAT_PRICE_ORE = 2000;

const META_TOKEN_RE =
  /^(tilbehør|tilbehor|ekstra|extras?|valgfri|valgbar|tilvalg|ingrediens(er)?|beskrivelse|menu|alm\.?|fam\.?|familie|review|diverse|andet)$/i;

const MEAT_ADDITION_RE =
  /\b(skinke|bacon|kebab|kylling|kødstrimler|kødsovs|kødsauce|pepperoni|parmaskinke|okse|oksekød|bøf|rejer|tun|musling|chorizo|pølse|hakket|kødboller|salami|kød)\b/i;

const VEG_OR_CHEESE_RE =
  /\b(tomat|ost|champignon|løg|rødløg|salat|ananas|jalapeños?|jalapenos|paprika|oliven|avocado|agurk|spidskål|spinat|gorgonzola|mozzarella|parmesan|basilikum|oregano|majs|peberfrugt|syltet|falafel|hummus|karrydressing|dressing|naan|ris|nudler|pommes)\b/i;

const DIP_ADDITION_RE =
  /\b(mayo|mayonnaise|salatmayo|salatmayonnaise|remoulade|ketchup|kethup|bearnaise|bearnaisesauce|dressing|sauce)\b/i;

/**
 * Hard SEMANTIC_RULE: these names are never Tilbehør on any category.
 * - Pommes frites is a product (own card / Menuer include), not an ekstra row
 * - "Valgfri dyppelse" is a meta prompt, not an individual ekstra
 * - Sodavand / pitabrød likewise belong as products or Menuer sub-choices
 */
const FORBIDDEN_TILBEHOR_RE =
  /^(m\.?\s*)?(pommes(\s*frites)?|frites|valgfri\s+dyppelse|valgbar\s+dyppelse|valgfri\s+sauce|dyppelse|sodavand|cola|fanta|sprite|kildevand|pitabrød|pita\s*brød)$/i;

export function isForbiddenTilbehorName(name: string): boolean {
  const t = name.trim().replace(/^\s*[-–—•]\s*/, "");
  if (!t) return false;
  if (FORBIDDEN_TILBEHOR_RE.test(t)) return true;
  // Catch "M. pommes frites", "Ekstra pommes", etc.
  if (/\b(pommes|frites)\b/i.test(t) && !/\b(mayo|ketchup|remoulade)\b/i.test(t)) {
    return true;
  }
  if (/\bvalgfri\s+dyppelse\b/i.test(t) || /^dyppelse$/i.test(t)) return true;
  if (/\b(sodavand|pitabrød)\b/i.test(t)) return true;
  return false;
}

/** Real food tokens (Danish takeaway lexicon). Unknown non-food tokens are dropped. */
const FOOD_LEXICON = new Set(
  [
    "tomat",
    "ost",
    "skinke",
    "bacon",
    "æg",
    "egg",
    "kebab",
    "champignon",
    "pepperoni",
    "ananas",
    "parmaskinke",
    "kødsovs",
    "kødsauce",
    "syltet paprika",
    "paprika",
    "bearnaisesauce",
    "bearnaise",
    "løg",
    "log",
    "rødløg",
    "tun",
    "rejer",
    "musling",
    "gorgonzola",
    "kødstrimler",
    "jalapenos",
    "jalapeños",
    "salat",
    "dressing",
    "falafel",
    "oliven",
    "kylling",
    "ananas",
    "pommes",
    "pommes frites",
    "salatmayonnaise",
    "salatmayo",
    "mayonnaise",
    "mayo",
    "remoulade",
    "ketchup",
    "agurk",
    "avocado",
    "spidskål",
    "hummus",
    "karrydressing",
    "spinat",
    "parmesan",
    "flødesovs",
    "penne",
    "spaghetti",
    "tigerrejer",
    "naanbrød",
    "naan",
    "ris",
    "nudler",
    "kartofler",
    "oksefyld",
    "grøntsager",
    "indisk ost",
    "mozzarella",
    "basilikum",
    "oregano",
    "majs",
    "peberfrugt",
    "salami",
    "chorizo",
    "pølse",
    "hakket",
    "kødboller",
    "oksekød",
    "bøf",
    "reje",
    "muslinger",
    "syltet",
  ].map((s) => s.toLowerCase()),
);

/**
 * Dish / pizza style names that are never ingredients or Tilbehør.
 * (Product titles, not food components.)
 */
const DISH_NAME_BLOCKLIST = new Set(
  [
    "margarita",
    "margherita",
    "hawaii",
    "nordgårds",
    "nordgards",
    "nordgàrds",
    "preben",
    "sofi",
    "patricia",
    "kalista",
    "elia",
    "tobi",
    "log", // when alone as dish #9 name — handled carefully
    "seafood",
    "dagulas",
    "brianboss",
    "benja", // OCR junk / made-up
    "josu",
    "jega",
    "karan",
    "seetha",
    "glori",
    "bambino",
    "tino bambino",
  ].map((s) => s.toLowerCase()),
);

const KNOWN_JUNK_RE =
  /^(benja|nordsjæls|nordsjaels|xyz|test|asdf|foo|bar|lorem)$/i;

function normKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function isMetaMenuToken(name: string): boolean {
  return META_TOKEN_RE.test(name.trim());
}

export function isDishNameBlockedAsFoodToken(name: string): boolean {
  const k = normKey(name);
  if (!k) return false;
  if (DISH_NAME_BLOCKLIST.has(k)) return true;
  if (KNOWN_JUNK_RE.test(k)) return true;
  return false;
}

export function isKnownFoodToken(name: string): boolean {
  const k = normKey(name);
  if (!k) return false;
  if (FOOD_LEXICON.has(k)) return true;
  // Multi-word: all parts known, or whole phrase in lexicon
  if (k.includes(" ")) {
    if (FOOD_LEXICON.has(k)) return true;
    const parts = k.split(" ");
    if (parts.every((p) => FOOD_LEXICON.has(p) || DIP_ADDITION_RE.test(p))) {
      return true;
    }
  }
  if (DIP_ADDITION_RE.test(k) || MEAT_ADDITION_RE.test(k) || VEG_OR_CHEESE_RE.test(k)) {
    return true;
  }
  return false;
}

/**
 * Hard SEMANTIC_RULE: these tokens are toppings/sauces, never dish titles.
 * Promoting ingredients[0] ("Tomat") into the product name must never happen.
 * Distinct from dish titles that also appear as toppings (Pepperoni, Hawaii).
 */
const NEVER_DISH_PRODUCT_NAME_RE =
  /^(tomat|ost|salat|dressing|mayonnaise|mayo|salatmayo|salatmayonnaise|remoulade|ketchup|kethup|løg|rødløg|champignon|spaghetti|penne|basilikum|oregano|majs|oliven|agurk|avocado|hummus)$/i;

/**
 * True when a product name is clearly a topping/sauce, not a dish title.
 * Blocks the Salatpizza→"Tomat" class of QA disasters permanently.
 */
export function looksLikeToppingAsProductName(name: string): boolean {
  const n = name.trim().replace(/^\d+\.\s*/, "").trim();
  if (!n) return false;
  if (NEVER_DISH_PRODUCT_NAME_RE.test(n)) return true;
  // "Tomat og ost" / "Ost, salat" — topping soup mistaken for a title
  if (
    /^(tomat|ost|salat|dressing|løg|champignon)\b/i.test(n) &&
    /\b(og|,|;)\b/i.test(n)
  ) {
    return true;
  }
  return false;
}

/** True when token must never appear as ingredient or Tilbehør. */
export function isInvalidFoodComponent(
  name: string,
  productName?: string,
): boolean {
  const t = name.trim();
  if (!t) return true;
  if (isMetaMenuToken(t)) return true;
  if (isDishNameBlockedAsFoodToken(t)) return true;
  if (KNOWN_JUNK_RE.test(t)) return true;
  if (productName) {
    const pn = normKey(productName.replace(/^\d+\.\s*/, ""));
    const tk = normKey(t);
    if (pn && tk && (pn === tk || pn.startsWith(tk + " ") || tk === pn.split(/\s+/)[0])) {
      // Exact product title as component (e.g. Margarita on Margarita)
      if (pn === tk) return true;
    }
  }
  // Reject unknown single-token non-food (Benja, etc.)
  if (!isKnownFoodToken(t) && !/[,\s]/.test(t) && t.length <= 24) {
    // Allow compound dish-legal foods we haven't listed if they contain a known root
    if (!MEAT_ADDITION_RE.test(t) && !VEG_OR_CHEESE_RE.test(t) && !DIP_ADDITION_RE.test(t)) {
      return true;
    }
  }
  return false;
}

/**
 * Split OCR-glued "Skinkeog ananas" / "Skinkeog pølse" into separate foods.
 * Also splits "X og Y" already-spaced pairs when both are foods.
 */
export function splitGluedFoodToken(raw: string): string[] {
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) return [];

  // Explicit known glues
  const explicit: Array<[RegExp, string[]]> = [
    [/^(skinke)\s*og\s*(ananas)$/i, ["Skinke", "Ananas"]],
    [/^(skinke)og(ananas)$/i, ["Skinke", "Ananas"]],
    [/^(skinke)\s*og\s*(pølse|polse)$/i, ["Skinke", "Pølse"]],
    [/^(skinke)og(pølse|polse)$/i, ["Skinke", "Pølse"]],
    [/^(skinke)\s*og\s*(bacon)$/i, ["Skinke", "Bacon"]],
    [/^(skinke)og(bacon)$/i, ["Skinke", "Bacon"]],
    [/^(ost)\s*og\s*(løg|log)$/i, ["Ost", "Løg"]],
    [/^(ost)og(løg|log)$/i, ["Ost", "Løg"]],
  ];
  for (const [re, parts] of explicit) {
    if (re.test(s)) return parts;
  }

  // General: WordogWord (no spaces) where both sides look like food
  const glued = s.match(/^([A-Za-zÆØÅæøå]{2,})og([A-Za-zÆØÅæøå]{2,})$/i);
  if (glued) {
    const a = glued[1]!;
    const b = glued[2]!;
    // "ogæg" → og + æg (conjunction + food)
    if (/^og$/i.test(a) && isKnownFoodToken(b)) {
      return [capitalizeFirstLetter(b)];
    }
    if (isKnownFoodToken(a) && isKnownFoodToken(b)) {
      return [capitalizeFirstLetter(a), capitalizeFirstLetter(b)];
    }
  }

  // "X og Y" spaced — only split when both are food (not "Tomat og ost" as one cell;
  // that belongs in description). For ingredient cells, prefer split.
  const spacedOg = s.match(/^(.+?)\s+og\s+(.+)$/i);
  if (spacedOg) {
    const a = spacedOg[1]!.trim();
    const b = spacedOg[2]!.trim();
    if (
      isKnownFoodToken(a) &&
      isKnownFoodToken(b) &&
      !/,/.test(a) &&
      !/,/.test(b)
    ) {
      return [capitalizeFirstLetter(a), capitalizeFirstLetter(b)];
    }
  }

  return [s];
}

export type AdditionPriceTier = "meat" | "vegetable" | "dip" | "other";

export function classifyTilbehorPriceTier(name: string): AdditionPriceTier {
  if (DIP_ADDITION_RE.test(name)) return "dip";
  if (MEAT_ADDITION_RE.test(name)) return "meat";
  if (VEG_OR_CHEESE_RE.test(name)) return "vegetable";
  return "other";
}

export function defaultTilbehorPriceOre(name: string): number {
  const tier = classifyTilbehorPriceTier(name);
  if (tier === "meat") return TILBEHOR_MEAT_PRICE_ORE;
  return TILBEHOR_VEG_PRICE_ORE;
}

/**
 * Reprice Tilbehør when the list is flat (all same price) or zero/missing.
 * Meat → 20 kr, veg/dip/other → 10 kr.
 */
export function repriceTilbehorList(
  additions: Array<{ name: string; priceOre: number }>,
): Array<{ name: string; priceOre: number }> {
  if (additions.length === 0) return [];
  const prices = additions.map((a) => a.priceOre).filter((p) => p > 0);
  const allSame =
    prices.length >= 2 && prices.every((p) => p === prices[0]);
  const anyMissing = additions.some((a) => !a.priceOre || a.priceOre <= 0);
  const shouldReprice = allSame || anyMissing;

  return additions.map((a) => {
    const logical = defaultTilbehorPriceOre(a.name);
    if (!shouldReprice && a.priceOre > 0) {
      // Still bump meat that was incorrectly priced at veg baseline
      if (
        classifyTilbehorPriceTier(a.name) === "meat" &&
        a.priceOre <= TILBEHOR_VEG_PRICE_ORE
      ) {
        return { name: a.name, priceOre: TILBEHOR_MEAT_PRICE_ORE };
      }
      return a;
    }
    return { name: a.name, priceOre: logical };
  });
}

/**
 * Expand, split, and sanitize ingredient rows for a product.
 */
export function sanitizeIngredientList(
  raw: readonly string[],
  productName?: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let base = item.replace(/^\s*[-–—•]\s*/, "").trim();
    base = base.replace(/\bogæg\b/gi, "æg").replace(/\bogost\b/gi, "ost");
    base = base.replace(/\s+\d{2,4}\s*(kr\.?)?\s*$/gi, "").trim();
    // Drop leading dangling "og "
    base = base.replace(/^og\s+/i, "").trim();
    for (const part of splitGluedFoodToken(base)) {
      let s = part.trim().replace(/\s+/g, " ");
      if (!s) continue;
      // OCR
      s = s
        .replace(/\blog\b/gi, "løg")
        .replace(/\bkodsovs\b/gi, "kødsovs")
        .replace(/\bpolse\b/gi, "pølse");
      s = capitalizeFirstLetter(s);
      if (/\d{2,4}/.test(s)) continue;
      if (isInvalidFoodComponent(s, productName)) continue;
      const key = normKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/**
 * Sanitize Tilbehør: drop dish names / meta / junk; reprice logically.
 */
export function sanitizeAdditionList(
  raw: Array<{ name: string; priceOre: number }>,
  productName?: string,
  categoryName?: string,
): Array<{ name: string; priceOre: number }> {
  // Hard prior: drinks never carry Tilbehør / dips — even if already live.
  // (Duplicated lightly so this module stays free of learning-layer imports.)
  const blob = `${productName ?? ""} ${categoryName ?? ""}`;
  if (
    /\b(soda|sodavand|cola|fanta|sprite|kildevand|\bvand\b|øl|beer|vin|juice|milkshake|shake|kaffe|\bte\b|\btea\b|kakao)\b/i.test(
      blob,
    ) ||
    /\b(drikke|drinks)\b/i.test(blob)
  ) {
    return [];
  }

  const cleaned: Array<{ name: string; priceOre: number }> = [];
  const seen = new Set<string>();
  for (const a of raw) {
    for (const part of splitGluedFoodToken(a.name.replace(/^\s*[-–—•]\s*/, ""))) {
      let name = formatProductName(part);
      if (!name) continue;
      name = name
        .replace(/\blog\b/gi, "Løg")
        .replace(/\bkodsovs\b/gi, "Kødsovs");
      name = capitalizeFirstLetter(name);
      if (isForbiddenTilbehorName(name)) continue;
      if (isInvalidFoodComponent(name, productName)) continue;
      // Tilbehør must be known food — never menu item titles
      if (!isKnownFoodToken(name) && !DIP_ADDITION_RE.test(name)) continue;
      const key = normKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push({ name, priceOre: a.priceOre });
    }
  }
  return repriceTilbehorList(cleaned);
}

/**
 * Polish description lists: split glues, fix "og,", drop meta tokens.
 */
export function polishDescriptionText(
  description: string,
  productName?: string,
): string {
  let d = description.trim();
  if (!d) return "";
  // Fix "Tomat og, ost" → treat as list
  d = d.replace(/\s+og\s*,\s*/gi, ", ");
  d = d.replace(/,\s*og\s+/gi, ", ");
  d = d.replace(/\s{2,}/g, " ");

  // Split on commas and rejoin sanitized parts
  const parts = d
    .split(/\s*,\s*/)
    .flatMap((p) => splitGluedFoodToken(p))
    .map((p) =>
      capitalizeFirstLetter(
        p
          .replace(/\blog\b/gi, "løg")
          .replace(/\bkodsovs\b/gi, "kødsovs")
          .replace(/\bpolse\b/gi, "pølse")
          .trim(),
      ),
    )
    .filter((p) => p && !isInvalidFoodComponent(p, productName));

  // Deduplicate
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const p of parts) {
    const k = normKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  return uniq.join(", ");
}

/**
 * Strip ingredient dumps from dish titles.
 * "Ufo –Glori kodsovs, spaghetti, syltet paprika og log" → "Ufo Glori"
 */
export function cleanDishDisplayName(rawName: string): {
  name: string;
  movedToDescription: string[];
} {
  let name = rawName.trim().replace(/\s+/g, " ");
  name = name.replace(/^\d+\.\s*/, "");
  const moved: string[] = [];

  // If commas (or " og " with multiple foods), keep title head only
  if (/,/.test(name) || (/\bog\b/i.test(name) && name.split(/\s+/).length > 5)) {
    const head = name.split(",")[0]!.trim();
    const rest = name
      .slice(head.length)
      .replace(/^[\s,]+/, "")
      .trim();
    if (rest) {
      moved.push(
        ...rest
          .split(/\s*(?:,|\bog\b)\s*/i)
          .map((x) => x.trim())
          .filter(Boolean),
      );
    }
    name = head;
  }

  // Normalize dash variants: "Ufo –Glori" / "Ufo - Glori"
  name = name.replace(/\s*[-–—]\s*/g, " ").replace(/\s+/g, " ").trim();

  // Strip trailing food lexicon tokens from the title (kodsovs, spaghetti…)
  // Exception: "Salatpizza kebab" / "Vegetarpizza falafel" — protein is the dish title.
  const tokens = name.split(/\s+/);
  while (tokens.length > 1) {
    if (
      tokens.length === 2 &&
      /^(salatpizza|vegetarpizza)$/i.test(tokens[0]!)
    ) {
      break;
    }
    const last = tokens[tokens.length - 1]!;
    const lastKey = normKey(last);
    if (
      FOOD_LEXICON.has(lastKey) ||
      MEAT_ADDITION_RE.test(last) ||
      VEG_OR_CHEESE_RE.test(last) ||
      /^(kodsovs|kødsovs|spaghetti|syltet|paprika|log|løg)$/i.test(last)
    ) {
      moved.unshift(tokens.pop()!);
      continue;
    }
    break;
  }
  name = tokens.join(" ").trim();

  // OCR in remaining short title
  name = name.replace(/\bkodsovs\b/gi, "").replace(/\s+/g, " ").trim();
  name = formatProductName(name);

  return {
    name: name || formatProductName(rawName),
    movedToDescription: moved,
  };
}

export function ingredientListHasDefects(
  ingredients: readonly string[],
  productName?: string,
): boolean {
  for (const i of ingredients) {
    if (/^[A-Za-zÆØÅæøå]{3,}og[A-Za-zÆØÅæøå]{3,}$/i.test(i.trim())) return true;
    if (isInvalidFoodComponent(i, productName)) return true;
  }
  return false;
}

export function additionListHasDefects(
  additions: Array<{ name: string; priceOre?: number }>,
  productName?: string,
  categoryName?: string,
): boolean {
  const blob = `${productName ?? ""} ${categoryName ?? ""}`;
  if (
    (/\b(soda|sodavand|cola|fanta|sprite|kildevand|\bvand\b|øl|beer|vin|juice|milkshake|shake|kaffe|\bte\b|\btea\b|kakao)\b/i.test(
      blob,
    ) ||
      /\b(drikke|drinks)\b/i.test(blob)) &&
    additions.length > 0
  ) {
    return true;
  }
  // Fries / pommes / grill menus with a pizza-topping dump and no dips
  if (
    (/\b(pommes|frites|nuggets?)\b/i.test(blob) ||
      /\bgrill\b/i.test(categoryName ?? "")) &&
    additions.length >= 6 &&
    !additions.some((a) =>
      /\b(mayo|mayonnaise|remoulade|ketchup)\b/i.test(a.name),
    )
  ) {
    return true;
  }
  if (additions.length === 0) return false;
  for (const a of additions) {
    if (isForbiddenTilbehorName(a.name)) return true;
    if (isInvalidFoodComponent(a.name, productName)) return true;
    if (!isKnownFoodToken(a.name) && !DIP_ADDITION_RE.test(a.name)) return true;
  }
  const prices = additions.map((a) => a.priceOre ?? 0).filter((p) => p > 0);
  if (
    prices.length >= 2 &&
    prices.every((p) => p === prices[0]) &&
    additions.some((a) => classifyTilbehorPriceTier(a.name) === "meat") &&
    additions.some((a) => classifyTilbehorPriceTier(a.name) !== "meat")
  ) {
    return true; // flat pricing across meat + veg
  }
  return false;
}

export function dishNameHasIngredientDump(name: string): boolean {
  const n = name.trim();
  if (/,/.test(n) && n.split(",").length >= 2) return true;
  if (/\b(kodsovs|kødsovs|spaghetti|syltet paprika)\b/i.test(n)) return true;
  return false;
}

export type CreateCardQualityGateResult = {
  ok: boolean;
  blockers: string[];
};

function looksLikeBurgerPayload(
  payload: PlannedProductPayload,
  categoryHint?: string,
): boolean {
  return (
    isBurgerProductName(payload.name) ||
    isGrillCategory(categoryHint) ||
    /\b(burgers?|grill)\b/i.test(categoryHint ?? "")
  );
}

/**
 * Hard pre-live-write gate for Create / QA plans.
 * Blocks storefront publish when SEMANTIC_RULEs are violated.
 */
export function assertCreateCardQuality(
  plan: MigrationWritePlan,
): CreateCardQualityGateResult {
  const blockers: string[] = [];
  let burgerProductCount = 0;

  for (const op of plan.operations) {
    if (op.action !== "CREATE" && op.action !== "UPDATE") continue;
    if (op.entityType !== "product") continue;
    const payload = op.expectedPayload;
    if (!payload) continue;
    const categoryHint = op.identity.categoryHint;

    for (const v of payload.variants ?? []) {
      if (isForbiddenMenuVariantName(v.name)) {
        blockers.push(
          `${payload.menuNumber || payload.name}: forbidden Menu variant "${v.name}"`,
        );
      }
    }

    if (looksLikeBurgerPayload(payload, categoryHint)) {
      // Menuer combos are not plain burger cards
      if (
        /^menuer$/i.test((categoryHint ?? "").trim()) ||
        /\bmenu\b/i.test(payload.name)
      ) {
        continue;
      }
      burgerProductCount += 1;
      if ((payload.ingredients ?? []).length < 2) {
        blockers.push(
          `${payload.menuNumber || payload.name}: burger needs ≥2 ingredients`,
        );
      }
      if (!(payload.description ?? "").trim()) {
        blockers.push(
          `${payload.menuNumber || payload.name}: burger needs Beskrivelse`,
        );
      }
      if ((payload.additions ?? []).length < 1) {
        blockers.push(
          `${payload.menuNumber || payload.name}: burger needs Tilbehør`,
        );
      }
      if (/^grill$/i.test((categoryHint ?? "").trim())) {
        blockers.push(
          `${payload.menuNumber || payload.name}: burger category must be Burgers, not Grill`,
        );
      }
    }
  }

  const grillCategoryCreates = plan.operations.filter(
    (op) =>
      op.entityType === "category" &&
      op.action === "CREATE" &&
      /^grill$/i.test(String(op.identity.name ?? "")),
  );
  if (grillCategoryCreates.length && burgerProductCount >= 2) {
    blockers.push(
      "Category Grill created for burger/smash products — use Burgers",
    );
  }

  return { ok: blockers.length === 0, blockers };
}

