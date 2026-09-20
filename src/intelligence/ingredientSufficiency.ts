/**
 * Semantic Completeness Engine (V1) — ingredient sufficiency assessor.
 *
 * Pure, side-effect-free structural judgement of whether an ingredient list is
 * *sufficient* for a product family. This replaces the naive
 * `ingredients.length >= 2` heuristic with per-family structural expectations:
 * a burger needs protein + sauce/greens, a pizza needs a base plus a substantive
 * topping, a drink has no ingredient representation at all, and so on.
 *
 * Design rules:
 * - Pure function: no I/O, no randomness, no clock, no mutation of inputs. The
 *   same inputs always yield the same {@link FieldSufficiencyStatus}.
 * - Single spine: the CREATE path and the QA/reconcile path must both call this
 *   one function. Do NOT fork a second sufficiency heuristic.
 * - Evidence honesty: an empty ingredient list is `UNRESOLVED` (no evidence),
 *   not `INSUFFICIENT` (evidence below bar). Unclassifiable food families with
 *   sparse ingredients stay `UNRESOLVED` so the engine routes them to review
 *   rather than fabricating a representation.
 * - No fabrication: this function never returns a value, only a status.
 *
 * Family groups:
 * - Burger-like families reuse the existing, authoritative
 *   `grillIngredientsInsufficient` from the domain grill-card logic (protein +
 *   sauce/greens + enough tokens). Vegetarian lines are exempted from the
 *   meat requirement, consistent with the Constitution's vegetarian handling.
 * - Pizza-like families require a base (dough/tomato/cheese) plus a substantive
 *   topping (protein or cheese).
 * - Wrap / pasta / nachos / sushi / indian families require two structural slots
 *   (base + filling/sauce). One slot only → `PARTIAL`; neither → `INSUFFICIENT`.
 * - Non-food and combo families are `NOT_APPLICABLE` for ingredient sufficiency.
 */

import type { FieldSufficiencyStatus } from "./types.js";
import type { ProductFamily } from "./peerCohorts.js";
import { grillIngredientsInsufficient } from "../domain/grillCardFill.js";

/* ------------------------------------------------------------------ */
/* Token matchers                                                      */
/* ------------------------------------------------------------------ */

/** Protein / meat / vegetarian protein signals (a patty of any kind). */
const MEAT_OR_PROTEIN_RE =
  /\b(oksekød|bøf|hakket|kød|kødsovs|kødstrimler|kylling|chicken|crispy|bacon|skinke|kebab|pepperoni|salami|pølse|tun|rejer|fisk|fiskefilet|falafel|vegetar|vegan|tofu|halloumi|döner|doner|köfte|kofte|nuggets|lamm|kalkun)\b/i;

/** Protein OR cheese — one substantive topping slot for pizza/nachos. */
const PROTEIN_OR_CHEESE_RE =
  /\b(oksekød|bøf|hakket|kød|kødsovs|kødstrimler|kylling|chicken|crispy|bacon|skinke|kebab|pepperoni|salami|pølse|tun|rejer|fisk|fiskefilet|falafel|vegetar|vegan|tofu|halloumi|döner|doner|köfte|kofte|nuggets|lamm|kalkun|ost|cheese|mozzarella|gorgonzola|parmesan|cheddar|feta)\b/i;

/**
 * Sauce / dressing / wet component signals.
 *
 * Danish compound nouns glue the modifier directly to "sovs" (kødsovs,
 * flødesovs, tomatsovs), so a leading `\b` before "sovs" never fires — the word
 * boundary exists only before the whole compound, not before the head noun. The
 * `\w*sovs\b` alternative matches any word ending in "sovs" regardless of the
 * (non-ASCII) modifier letters, so real Danish sauce terms are recognised
 * generically instead of by an ever-growing dish-name list.
 */
const SAUCE_RE =
  /\b(sauce|ketchup|mayo|mayonnaise|remoulade|dressing|bearnaise|pesto|carbonara|fløde|creme|cremefraiche|tomat|tomatsauce|tomatsovs|dip)\b|\w*sovs\b/i;

/** Bread / wrap / bun signals. */
const BREAD_RE =
  /\b(bolle|boller|brød|bun|brioche|burgerbolle|pitabrød|pita|durum|durumbrød|tortilla|wrap|rulle|sandwich|baguette|flute|ciabatta|focaccia|naan|pandekage|dej|bund|dough)\b/i;

/** Pasta base signals. */
const PASTA_BASE_RE =
  /\b(pasta|spaghetti|penne|fettuccine|tagliatelle|lasagne|macaroni|fusilli|rigatoni|nudler|noodle)\b/i;

/** Rice base signals (sushi / indian). */
const RICE_RE = /\b(ris|rice|sushi|maki|nigiri)\b/i;

/** Indian side/starch signals. */
const SAUCE_RICE_NAAN_RE =
  /\b(sauce|sovs|curry|masala|tikka|korma|ris|rice|naan|nan|brød|bolle|fløde|creme|yoghurt|raita)\b/i;

/** Nachos base signals. */
const NACHO_BASE_RE = /\b(nachos|chips|tortilla|majs|mais|corn)\b/i;

/** Pizza base signals (dough / tomato / cheese are all acceptable bases). */
const PIZZA_BASE_RE =
  /\b(tomat|tomato|ost|cheese|mozzarella|bund|crust|dej|dough|brød|skorpe|tomatsauce|tomatsovs|sauce|pizza)\b/i;

/**
 * Substantive pizza topping signals — protein or cheese.
 * Plain vegetables (løg, paprika, champignon) are NOT substantive toppings for
 * the purpose of this minimum bar.
 */
const PIZZA_SUBSTANTIVE_TOPPING_RE =
  /\b(skinke|bacon|kebab|kylling|chicken|pepperoni|champignon|ananas|parmaskinke|kødsovs|kødstrimler|rejer|tun|musling|gorgonzola|pølse|salami|ost|cheese|mozzarella|feta|halloumi|falafel)\b/i;

/** Fries / potato base signals. */
const FRIES_BASE_RE =
  /\b(pommes|frites|fries|kartoffel|kartofler|potato|bådkartofler|nacho|chips)\b/i;

/**
 * Vegetarian signals — these lines must not be forced to satisfy meat rules.
 * Matched without trailing word boundaries so compound tokens such as
 * "Vegetarbøf" / "planteburger" are recognised.
 */
const VEGETARIAN_RE = /(vegetar|vegetarian|vegan|falafel|tofu|halloumi|plantebøf|planteburger)/i;

/* ------------------------------------------------------------------ */
/* Structural helpers                                                  */
/* ------------------------------------------------------------------ */

/** Two-slot structural check: base slot + filling/sauce slot. */
function assessTwoSlot(
  tokens: readonly string[],
  blob: string,
  base: RegExp,
  filling: RegExp,
): FieldSufficiencyStatus {
  if (tokens.length === 0) return "UNRESOLVED";
  const hasBase = base.test(blob);
  const hasFilling = filling.test(blob);
  if (hasBase && hasFilling) return "SUFFICIENT";
  if (hasBase || hasFilling) return "PARTIAL";
  return "INSUFFICIENT";
}

/**
 * Pizza-family minimum: [base] + [substantive topping].
 * Base-only evidence (e.g. ["Tomat", "Løg"]) is `PARTIAL`: a valid base exists,
 * but the substantive (cheese/protein) topping that makes the product a pizza is
 * missing, so it is not `INSUFFICIENT` (evidence exists) nor `SUFFICIENT`.
 */
function assessPizzaLike(
  tokens: readonly string[],
  blob: string,
): FieldSufficiencyStatus {
  if (tokens.length === 0) return "UNRESOLVED";
  const hasBase = PIZZA_BASE_RE.test(blob);
  const hasTopping = PIZZA_SUBSTANTIVE_TOPPING_RE.test(blob);
  if (hasBase && hasTopping) return "SUFFICIENT";
  if (hasBase || hasTopping) return "PARTIAL";
  return "INSUFFICIENT";
}

/** Sides: at least a recognizable potato/protein token; otherwise partial. */
function assessSide(tokens: readonly string[], blob: string): FieldSufficiencyStatus {
  if (tokens.length === 0) return "UNRESOLVED";
  if (FRIES_BASE_RE.test(blob) || MEAT_OR_PROTEIN_RE.test(blob)) return "SUFFICIENT";
  return "PARTIAL";
}

/**
 * Assess whether an ingredient list is structurally sufficient for a family.
 *
 * @param family      Product family from the single peer-cohort taxonomy.
 * @param _subtype    Optional subtype refinement (reserved for a later WP; no
 *                    subtype rules exist yet, so it is intentionally unused).
 * @param ingredients Ingredient display strings as they appear on the card.
 * @param productName Product name (used for burger/grill plate detection).
 * @returns SUFFICIENT | PARTIAL | INSUFFICIENT | UNRESOLVED | NOT_APPLICABLE.
 */
export function assessIngredientSufficiency(
  family: ProductFamily,
  _subtype: string | undefined,
  ingredients: readonly string[],
  productName: string,
): FieldSufficiencyStatus {
  const tokens = ingredients
    .map((i) => (i ?? "").trim())
    .filter((i) => i.length > 0);
  const blob = tokens.join(" ").toLowerCase();

  switch (family) {
    case "BURGER":
    case "BACON_BURGER":
    case "CHEESE_BURGER": {
      if (tokens.length === 0) return "UNRESOLVED";
      // Vegetarian lines must not be forced to satisfy the meat requirement.
      if (VEGETARIAN_RE.test(blob)) {
        return tokens.length >= 2 ? "SUFFICIENT" : "PARTIAL";
      }
      return grillIngredientsInsufficient(tokens, productName)
        ? "INSUFFICIENT"
        : "SUFFICIENT";
    }
    case "SANDWICH":
      return assessTwoSlot(tokens, blob, BREAD_RE, MEAT_OR_PROTEIN_RE);
    case "PIZZA":
    case "SALATPIZZA":
    case "CALZONE":
      return assessPizzaLike(tokens, blob);
    case "DURUM":
    case "PITA":
      return assessTwoSlot(tokens, blob, BREAD_RE, MEAT_OR_PROTEIN_RE);
    case "PASTA":
      return assessTwoSlot(tokens, blob, PASTA_BASE_RE, SAUCE_RE);
    case "INDIAN_MAIN":
      return assessTwoSlot(tokens, blob, MEAT_OR_PROTEIN_RE, SAUCE_RICE_NAAN_RE);
    case "FRIES":
      return assessSide(tokens, blob);
    case "NACHOS":
      return assessTwoSlot(tokens, blob, NACHO_BASE_RE, PROTEIN_OR_CHEESE_RE);
    case "SUSHI":
      return assessTwoSlot(tokens, blob, RICE_RE, MEAT_OR_PROTEIN_RE);
    case "DRINK":
    case "COMBO_MENU":
      // Drinks have no ingredient representation (DRINKS_NO_FOOD_EXTRAS); a combo
      // menu's contents live in `comboComponents`, not in ingredient slots.
      return "NOT_APPLICABLE";
    case "OTHER_FOOD":
    case "UNKNOWN":
      // Unclassifiable food: no structural model. Sparse input stays UNRESOLVED
      // so the engine routes to review rather than fabricating a representation.
      return tokens.length < 2 ? "UNRESOLVED" : "SUFFICIENT";
  }
}
