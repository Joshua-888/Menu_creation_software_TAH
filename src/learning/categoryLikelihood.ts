/**
 * Probability statistics from peer menus → allow/deny policies.
 *
 * Core idea: estimate P(feature | product_kind) across peer restaurants,
 * then decide with explicit thresholds (not one-off inventing).
 */

import type { PeerMenuSnapshot } from "./peerMenuStructure.js";
import {
  isInvalidFoodComponent,
  repriceTilbehorList,
} from "../domain/menuCardQuality.js";

export type ProductKind =
  | "drinks"
  | "finger_food"
  | "menu_with_fries"
  | "nachos"
  | "pizza"
  | "pasta"
  | "indian"
  | "sandwich_grill"
  | "vegetarian"
  | "other";

export type FeatureKey = "dip" | "meat_addition" | "any_addition";

const DIP_RE =
  /\b(salatmayo|salatmayonnaise|mayonnaise|mayo|remoulade|ketchup|kethup)\b/i;
const MEAT_ADD_RE =
  /\b(kebab|kylling|skinke|okse|oksekød|bacon|pepperoni|kødstrimler|kødsauce|kødboller|chorizo|bøf|rejer|tun|hakket)\b/i;
const VEG_NAME_RE = /\b(vegetar|vegan|falafel)\b/i;
const VEG_CAT_RE = /\b(vegetar|vegan)\b/i;
const DRINK_RE =
  /\b(soda|sodavand|cola|fanta|sprite|kildevand|\bvand\b|øl|beer|vin|juice|milkshake|shake|kaffe|\bthe\b|\btea\b|kakao)\b/i;
const FINGER_RE =
  /\b(pommes|frites|nuggets?|onion\s*rings?|mozzarella\s*sticks?|chicken\s*wings?|hot\s*wings?)\b/i;
const FRIES_CONTEXT_RE = /\b(pommes|frites)\b/i;
const MENU_RE = /\bmenu\b/i;
const PIZZA_RE =
  /\b(pizza|calzone|ufo|indbagt|vesuvio|margarita|margherita|hawaii|pepperoni|salatpizza)\b/i;
const PASTA_RE =
  /\b(pasta|spaghetti|lasagne|penne|fettuccine|tagliatelle|bolognese|alfredo)\b/i;
const INDIAN_RE =
  /\b(tikka|masala|curry|naan|butter\s*chicken|kottu|biryani|indisk|fried\s*rice|fried\s*noodles)\b/i;
const NACHOS_RE = /\bnachos\b/i;
const SANDWICH_RE =
  /\b(sandwich|burger|smash|pita|pitabrød|dürüm|durum|wrap|rulle|hotdog|pølse)\b/i;

export const ALL_KINDS: ProductKind[] = [
  "drinks",
  "finger_food",
  "menu_with_fries",
  "nachos",
  "pizza",
  "pasta",
  "indian",
  "sandwich_grill",
  "vegetarian",
  "other",
];

/** Decision thresholds (empirical). */
export const PROB_THRESHOLDS = {
  /** Allow feature if P(feature|kind) >= this. */
  allowMin: 0.35,
  /** Deny feature if P(feature|kind) <= this. */
  denyMax: 0.12,
  /** Minimum peer products in kind before trusting the rate. */
  minSupport: 3,
} as const;

export function isDipAddition(name: string): boolean {
  return DIP_RE.test(name);
}

export function isMeatAddition(name: string): boolean {
  return MEAT_ADD_RE.test(name);
}

export function classifyProductKind(input: {
  name: string;
  categoryNames?: string[];
  description?: string;
}): ProductKind {
  const name = input.name || "";
  const cats = (input.categoryNames ?? []).join(" ");
  const blob = `${name} ${cats} ${input.description ?? ""}`;

  if (DRINK_RE.test(name) || /drikke|drinks|sodavand/i.test(cats)) {
    return "drinks";
  }
  // Sandwich/burger (or other) menus that include fries → dips OK
  if (MENU_RE.test(name) && FRIES_CONTEXT_RE.test(blob)) {
    return "menu_with_fries";
  }
  if (/\bkebabmenu\b/i.test(name)) {
    return "menu_with_fries";
  }
  if (FINGER_RE.test(name)) return "finger_food";
  if (NACHOS_RE.test(name)) return "nachos";
  if (PIZZA_RE.test(name) || /pizza/i.test(cats)) return "pizza";
  if (PASTA_RE.test(name) || /pasta/i.test(cats)) return "pasta";
  if (INDIAN_RE.test(name) || /indisk|indian|asiatisk/i.test(cats)) {
    return "indian";
  }
  // Sandwich/burger alone → no dips
  if (SANDWICH_RE.test(name) || /grill|burger|sandwich/i.test(cats)) {
    return "sandwich_grill";
  }
  if (VEG_NAME_RE.test(name) || VEG_CAT_RE.test(cats)) return "vegetarian";
  return "other";
}

export function isVegetarianContext(input: {
  name: string;
  categoryNames?: string[];
}): boolean {
  const cats = (input.categoryNames ?? []).join(" ");
  return VEG_CAT_RE.test(cats) || VEG_NAME_RE.test(input.name);
}

export type ProbCell = {
  kind: ProductKind;
  feature: FeatureKey;
  /** Products of this kind across peers. */
  n: number;
  /** Products with the feature. */
  k: number;
  /** Maximum-likelihood rate k/n (0 if n=0). */
  pHat: number;
  /** Laplace-smoothed probability (k+1)/(n+2). */
  pSmooth: number;
  /** Decision from thresholds + support. */
  decision: "ALLOW" | "DENY" | "UNCERTAIN";
};

export type KindProbabilityRow = {
  kind: ProductKind;
  n: number;
  features: Record<FeatureKey, ProbCell>;
  examples: string[];
};

export type ProbabilityPolicyMap = {
  restaurantsAnalyzed: number;
  hosts: string[];
  thresholds: typeof PROB_THRESHOLDS;
  byKind: KindProbabilityRow[];
  /** Effective policy after stats + hard safety priors. */
  policy: {
    dipAllowKinds: ProductKind[];
    dipDenyKinds: ProductKind[];
    neverTilbehorKinds: ProductKind[];
    neverMeatAddKinds: ProductKind[];
  };
  rules: string[];
  fingerprint: string;
};

function decideFromRate(n: number, pSmooth: number): ProbCell["decision"] {
  if (n < PROB_THRESHOLDS.minSupport) return "UNCERTAIN";
  if (pSmooth >= PROB_THRESHOLDS.allowMin) return "ALLOW";
  if (pSmooth <= PROB_THRESHOLDS.denyMax) return "DENY";
  return "UNCERTAIN";
}

function emptyFeatures(kind: ProductKind): Record<FeatureKey, ProbCell> {
  const mk = (feature: FeatureKey): ProbCell => ({
    kind,
    feature,
    n: 0,
    k: 0,
    pHat: 0,
    pSmooth: 0.5,
    decision: "UNCERTAIN",
  });
  return {
    dip: mk("dip"),
    meat_addition: mk("meat_addition"),
    any_addition: mk("any_addition"),
  };
}

/**
 * Estimate P(feature|kind) from peer snapshots (pooled across restaurants).
 */
export function estimateKindProbabilities(
  snaps: PeerMenuSnapshot[],
): KindProbabilityRow[] {
  const acc = new Map<
    ProductKind,
    {
      n: number;
      dip: number;
      meat: number;
      any: number;
      examples: string[];
    }
  >();
  for (const k of ALL_KINDS) {
    acc.set(k, { n: 0, dip: 0, meat: 0, any: 0, examples: [] });
  }

  for (const snap of snaps) {
    for (const p of snap.products) {
      const kind = classifyProductKind({
        name: p.name,
        ...(p.categoryNames ? { categoryNames: p.categoryNames } : {}),
      });
      const cur = acc.get(kind)!;
      cur.n += 1;
      const adds = p.additions ?? [];
      const hasDip = adds.some((a) => isDipAddition(a.name));
      const hasMeat = adds.some((a) => isMeatAddition(a.name));
      const hasAny = adds.length > 0;
      if (hasDip) cur.dip += 1;
      if (hasMeat) cur.meat += 1;
      if (hasAny) cur.any += 1;
      if (cur.examples.length < 6) {
        cur.examples.push(
          `${snap.host}:${p.menuNumber}:${p.name.slice(0, 36)}${hasDip ? "[DIP]" : ""}${hasMeat ? "[MEAT]" : ""}`,
        );
      }
    }
  }

  return ALL_KINDS.map((kind) => {
    const cur = acc.get(kind)!;
    const cell = (feature: FeatureKey, k: number): ProbCell => {
      const n = cur.n;
      const pHat = n ? k / n : 0;
      const pSmooth = (k + 1) / (n + 2);
      return {
        kind,
        feature,
        n,
        k,
        pHat,
        pSmooth,
        decision: decideFromRate(n, pSmooth),
      };
    };
    return {
      kind,
      n: cur.n,
      features: {
        dip: cell("dip", cur.dip),
        meat_addition: cell("meat_addition", cur.meat),
        any_addition: cell("any_addition", cur.any),
      },
      examples: cur.examples,
    };
  });
}

/**
 * Build policy from probabilities.
 * Hard safety priors (operator):
 * - drinks never tilbehør
 * - vegetarian never meat additions
 * - mayo dips ONLY on finger_food + menu_with_fries
 *   (not pizza/pasta/indian/nachos/sandwich — unless classified as menu_with_fries)
 */
export function distillProbabilityPolicy(
  snaps: PeerMenuSnapshot[],
): ProbabilityPolicyMap {
  const byKind = estimateKindProbabilities(snaps);
  const hosts = snaps.map((s) => s.host);

  const dipAllowKinds: ProductKind[] = ["finger_food", "menu_with_fries"];
  const dipDenyKinds: ProductKind[] = [
    "drinks",
    "nachos",
    "pizza",
    "pasta",
    "indian",
    "sandwich_grill",
    "vegetarian",
    "other",
  ];
  const neverTilbehorKinds: ProductKind[] = ["drinks"];
  const neverMeatAddKinds: ProductKind[] = ["vegetarian", "drinks"];

  for (const row of byKind) {
    const meat = row.features.meat_addition;
    if (meat.decision === "DENY" && !neverMeatAddKinds.includes(row.kind)) {
      neverMeatAddKinds.push(row.kind);
    }
  }

  const rules = [
    `P(dip|kind) stats inform evidence; operator prior: dips ONLY finger_food + menu_with_fries`,
    `P(dip|kind) allow threshold pSmooth>=${PROB_THRESHOLDS.allowMin} (min n=${PROB_THRESHOLDS.minSupport})`,
    `P(dip|kind) deny threshold pSmooth<=${PROB_THRESHOLDS.denyMax}`,
    `Effective dip ALLOW kinds: ${dipAllowKinds.join(", ")}`,
    `Effective dip DENY kinds: ${dipDenyKinds.join(", ")}`,
    `Never Tilbehør: ${neverTilbehorKinds.join(", ")}`,
    `Never meat additions: ${neverMeatAddKinds.join(", ")}`,
    `Sandwiches/burgers: NO dips unless product kind is menu_with_fries (name/desc includes pommes)`,
  ];

  for (const row of byKind) {
    const d = row.features.dip;
    rules.push(
      `stat ${row.kind}: n=${d.n} P_dip≈${d.pHat.toFixed(2)} (smooth ${d.pSmooth.toFixed(2)}) → ${d.decision}`,
    );
  }

  const fingerprint = [
    "prob",
    dipAllowKinds.slice().sort().join("+"),
    dipDenyKinds.slice().sort().join("+"),
    `th${PROB_THRESHOLDS.allowMin}-${PROB_THRESHOLDS.denyMax}`,
  ].join("|");

  return {
    restaurantsAnalyzed: snaps.length,
    hosts,
    thresholds: PROB_THRESHOLDS,
    byKind,
    policy: {
      dipAllowKinds,
      dipDenyKinds,
      neverTilbehorKinds,
      neverMeatAddKinds,
    },
    rules,
    fingerprint,
  };
}

export function productAllowsDips(
  input: { name: string; categoryNames?: string[]; description?: string },
  policy: ProbabilityPolicyMap,
): boolean {
  const kind = classifyProductKind(input);
  if (policy.policy.neverTilbehorKinds.includes(kind)) return false;
  if (policy.policy.dipDenyKinds.includes(kind)) return false;
  return policy.policy.dipAllowKinds.includes(kind);
}

export function productForbidsAllTilbehor(
  input: { name: string; categoryNames?: string[] },
  policy?: ProbabilityPolicyMap | null,
): boolean {
  const kind = classifyProductKind(input);
  // Hard prior — never depends on peer policy being loaded.
  if (kind === "drinks") return true;
  if (policy?.policy.neverTilbehorKinds.includes(kind)) return true;
  return false;
}

export function productForbidsMeatAdditions(
  input: { name: string; categoryNames?: string[] },
  policy: ProbabilityPolicyMap,
): boolean {
  if (isVegetarianContext(input)) return true;
  const kind = classifyProductKind(input);
  return policy.policy.neverMeatAddKinds.includes(kind);
}

export type AdditionFilterReasonCode =
  | "DIP_DENY_KIND"
  | "MEAT_FORBID_VEG"
  | "NEVER_TILBEHOR_KIND"
  | "KEPT"
  | "FANOUT_TILBEHOR"
  | "STRUCTURE_VARIANT"
  | "STRUCTURE_ADDITION";

export type AdditionFilterTrace = {
  kind: ProductKind;
  before: Array<{ name: string; priceOre: number }>;
  after: Array<{ name: string; priceOre: number }>;
  removed: Array<{ name: string; priceOre: number; reason: AdditionFilterReasonCode }>;
  reasonCodes: AdditionFilterReasonCode[];
};

export function filterAdditionsForProduct(input: {
  name: string;
  categoryNames?: string[];
  description?: string;
  additions: Array<{ name: string; priceOre: number }>;
  policy?: ProbabilityPolicyMap | null;
}): Array<{ name: string; priceOre: number }> {
  return filterAdditionsWithTrace(input).after;
}

export function filterAdditionsWithTrace(input: {
  name: string;
  categoryNames?: string[];
  description?: string;
  additions: Array<{ name: string; priceOre: number }>;
  policy?: ProbabilityPolicyMap | null;
}): AdditionFilterTrace {
  const kind = classifyProductKind(input);
  const before = input.additions.map((a) => ({ ...a }));
  if (productForbidsAllTilbehor(input, input.policy ?? null)) {
    return {
      kind,
      before,
      after: [],
      removed: before.map((a) => ({
        ...a,
        reason: "NEVER_TILBEHOR_KIND" as const,
      })),
      reasonCodes: before.length ? ["NEVER_TILBEHOR_KIND"] : [],
    };
  }
  const policy = input.policy;
  if (!policy) {
    // Hard priors without peer artifact: drinks already cleared; dips only on
    // finger_food / menu_with_fries (never pizza/burger/sandwich alone).
    const kind = classifyProductKind(input);
    const hardAllowDips =
      kind === "finger_food" || kind === "menu_with_fries";
    const removed: AdditionFilterTrace["removed"] = [];
    const after: Array<{ name: string; priceOre: number }> = [];
    const reasonCodes = new Set<AdditionFilterReasonCode>();
    for (const a of before) {
      if (isInvalidFoodComponent(a.name, input.name)) {
        removed.push({ ...a, reason: "DIP_DENY_KIND" });
        reasonCodes.add("DIP_DENY_KIND");
        continue;
      }
      if (!hardAllowDips && isDipAddition(a.name)) {
        removed.push({ ...a, reason: "DIP_DENY_KIND" });
        reasonCodes.add("DIP_DENY_KIND");
        continue;
      }
      if (isVegetarianContext(input) && isMeatAddition(a.name)) {
        removed.push({ ...a, reason: "MEAT_FORBID_VEG" });
        reasonCodes.add("MEAT_FORBID_VEG");
        continue;
      }
      after.push(a);
    }
    const priced = repriceTilbehorList(after);
    if (priced.length > 0) reasonCodes.add("KEPT");
    return {
      kind,
      before,
      after: priced,
      removed,
      reasonCodes: [...reasonCodes],
    };
  }
  const allowDips = productAllowsDips(input, policy);
  const forbidMeat = productForbidsMeatAdditions(input, policy);
  const removed: AdditionFilterTrace["removed"] = [];
  const after: Array<{ name: string; priceOre: number }> = [];
  const reasonCodes = new Set<AdditionFilterReasonCode>();

  for (const a of before) {
    if (isInvalidFoodComponent(a.name, input.name)) {
      removed.push({ ...a, reason: "DIP_DENY_KIND" });
      reasonCodes.add("DIP_DENY_KIND");
      continue;
    }
    if (!allowDips && isDipAddition(a.name)) {
      removed.push({ ...a, reason: "DIP_DENY_KIND" });
      reasonCodes.add("DIP_DENY_KIND");
      continue;
    }
    if (forbidMeat && isMeatAddition(a.name)) {
      removed.push({ ...a, reason: "MEAT_FORBID_VEG" });
      reasonCodes.add("MEAT_FORBID_VEG");
      continue;
    }
    after.push(a);
  }
  const priced = repriceTilbehorList(after);
  if (priced.length > 0) {
    reasonCodes.add("KEPT");
  }

  return {
    kind,
    before,
    after: priced,
    removed,
    reasonCodes: [...reasonCodes],
  };
}
