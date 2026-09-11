/**
 * Resolve effective price/addition values with documented precedence.
 */

import { randomUUID } from "node:crypto";
import type {
  AdditionDefinition,
  AdditionSetFact,
  ConflictReasonCode,
  FactConflict,
  PriceFact,
} from "./facts.js";
import { normalizeAdditionName } from "./facts.js";
import type { FactRegistry } from "./factStore.js";

export type PriceLookupContext = {
  restaurantKey: string;
  menuNumber?: string | null;
  sourceId?: string | null;
  sourceCategory?: string | null;
  appliesTo: string;
  /** Current explicit source amount in minor units, if present. */
  sourceAmountMinor?: number | null;
};

export type EffectivePriceResult = {
  amountMinor: number | null;
  source: string;
  conflict: FactConflict | null;
  factId: string | null;
};

/**
 * Precedence:
 * CURRENT_EXPLICIT_SOURCE >
 * EXACT_HUMAN_CORRECTION / EXACT_PRODUCT_FACT >
 * RESTAURANT_CATEGORY_FACT >
 * RESTAURANT_FACT
 */
export function resolveEffectivePrice(
  registry: FactRegistry,
  ctx: PriceLookupContext,
): EffectivePriceResult {
  if (ctx.sourceAmountMinor != null) {
    const facts = registry.listActivePriceFacts(ctx.restaurantKey);
    const learned = pickBestPriceFact(facts, ctx);
    if (learned && learned.amountMinor !== ctx.sourceAmountMinor) {
      const conflict: FactConflict = {
        code: "LEARNED_FACT_CONFLICT_WITH_SOURCE",
        message: `Source ${ctx.sourceAmountMinor} ≠ learned ${learned.amountMinor} for ${ctx.appliesTo}`,
        sourceValue: ctx.sourceAmountMinor,
        learnedValue: learned.amountMinor,
        restaurantKey: ctx.restaurantKey,
        factId: learned.factId,
      };
      registry.recordConflict({
        conflictId: `cfl_${randomUUID()}`,
        code: conflict.code,
        message: conflict.message,
        restaurantKey: ctx.restaurantKey,
        factId: learned.factId,
        payload: conflict,
      });
      return {
        amountMinor: ctx.sourceAmountMinor,
        source: "CURRENT_EXPLICIT_SOURCE",
        conflict,
        factId: learned.factId,
      };
    }
    return {
      amountMinor: ctx.sourceAmountMinor,
      source: "CURRENT_EXPLICIT_SOURCE",
      conflict: null,
      factId: null,
    };
  }

  const facts = registry.listActivePriceFacts(ctx.restaurantKey);
  const hit = pickBestPriceFact(facts, ctx);
  if (!hit) {
    return {
      amountMinor: null,
      source: "AI_OR_HUMAN_REVIEW",
      conflict: null,
      factId: null,
    };
  }
  return {
    amountMinor: hit.amountMinor,
    source: scopeToPrecedence(hit.scope),
    conflict: null,
    factId: hit.factId,
  };
}

function scopeToPrecedence(scope: PriceFact["scope"]): string {
  switch (scope) {
    case "EXACT_PRODUCT":
    case "EXACT_CASE":
      return "EXACT_PRODUCT_FACT";
    case "RESTAURANT_CATEGORY":
      return "RESTAURANT_CATEGORY_FACT";
    case "RESTAURANT":
      return "RESTAURANT_FACT";
    default:
      return "SEMANTIC_POLICY";
  }
}

function pickBestPriceFact(
  facts: PriceFact[],
  ctx: PriceLookupContext,
): PriceFact | null {
  const scored = facts
    .filter((f) => f.appliesTo === ctx.appliesTo || f.label === ctx.appliesTo)
    .map((f) => {
      let score = 0;
      if (
        (f.scope === "EXACT_PRODUCT" || f.scope === "EXACT_CASE") &&
        ((ctx.menuNumber && f.menuNumber === ctx.menuNumber) ||
          (ctx.sourceId && f.sourceId === ctx.sourceId))
      ) {
        score = 100;
      } else if (
        f.scope === "RESTAURANT_CATEGORY" &&
        ctx.sourceCategory &&
        f.sourceCategory === ctx.sourceCategory
      ) {
        score = 50;
      } else if (f.scope === "RESTAURANT") {
        score = 20;
      } else {
        score = 0;
      }
      if (f.origin === "HUMAN_CORRECTION") score += 5;
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.f ?? null;
}

export type AdditionDiff = {
  sourceOnly: string[];
  policyOnly: string[];
  both: string[];
  conflictingPrice: Array<{
    name: string;
    sourceMinor: number;
    policyMinor: number;
  }>;
};

export function diffAdditionSets(input: {
  source: Array<{ name: string; priceMinor: number | null }>;
  policy: AdditionDefinition[];
}): AdditionDiff {
  const srcMap = new Map(
    input.source.map((s) => [normalizeAdditionName(s.name), s]),
  );
  const polMap = new Map(input.policy.map((p) => [p.nameKey, p]));
  const sourceOnly: string[] = [];
  const policyOnly: string[] = [];
  const both: string[] = [];
  const conflictingPrice: AdditionDiff["conflictingPrice"] = [];

  for (const [k, s] of srcMap) {
    const p = polMap.get(k);
    if (!p) sourceOnly.push(s.name);
    else {
      both.push(s.name);
      if (
        s.priceMinor != null &&
        p.priceMinor != null &&
        s.priceMinor !== p.priceMinor
      ) {
        conflictingPrice.push({
          name: s.name,
          sourceMinor: s.priceMinor,
          policyMinor: p.priceMinor,
        });
      }
    }
  }
  for (const [k, p] of polMap) {
    if (!srcMap.has(k)) policyOnly.push(p.name);
  }
  return { sourceOnly, policyOnly, both, conflictingPrice };
}

/**
 * Apply category addition set unless product excluded or source defines
 * product-specific additions (source exact wins — no blind union).
 */
export function resolveAdditionsForProduct(input: {
  registry: FactRegistry;
  restaurantKey: string;
  sourceCategory: string | null;
  sourceId: string;
  menuNumber: string | null;
  sourceAdditions: Array<{ name: string; priceMinor: number | null }>;
}): {
  additions: AdditionDefinition[];
  origin: string;
  conflicts: FactConflict[];
} {
  const sets = input.registry
    .listActiveAdditionSets(input.restaurantKey)
    .filter((s) => {
      if (s.excludedSourceIds.includes(input.sourceId)) return false;
      if (
        input.menuNumber &&
        s.excludedMenuNumbers.includes(input.menuNumber)
      ) {
        return false;
      }
      if (s.scope === "RESTAURANT") return true;
      if (
        s.scope === "RESTAURANT_CATEGORY" &&
        input.sourceCategory &&
        s.sourceCategory === input.sourceCategory
      ) {
        return true;
      }
      if (
        s.scope === "EXACT_PRODUCT" &&
        s.evidenceJson
      ) {
        const ev = JSON.parse(s.evidenceJson) as { menuNumber?: string };
        return ev.menuNumber != null && ev.menuNumber === input.menuNumber;
      }
      return false;
    })
    .sort((a, b) => scopeRank(b.scope) - scopeRank(a.scope));

  const conflicts: FactConflict[] = [];

  // Exact source list present → prefer source; flag policy-only extras (no inject)
  if (input.sourceAdditions.length > 0) {
    const best = sets[0];
    if (best) {
      const diff = diffAdditionSets({
        source: input.sourceAdditions,
        policy: best.additions,
      });
      for (const c of diff.conflictingPrice) {
        const fc: FactConflict = {
          code: "ADDITION_PRICE_CONFLICT",
          message: `${c.name}: source ${c.sourceMinor} vs policy ${c.policyMinor}`,
          sourceValue: c.sourceMinor,
          learnedValue: c.policyMinor,
          restaurantKey: input.restaurantKey,
          factId: best.factId,
        };
        conflicts.push(fc);
        input.registry.recordConflict({
          conflictId: `cfl_${randomUUID()}`,
          code: fc.code,
          message: fc.message,
          restaurantKey: input.restaurantKey,
          factId: best.factId,
          payload: fc,
        });
      }
    }
    return {
      additions: input.sourceAdditions.map((s) => ({
        additionId: `add_${normalizeAdditionName(s.name).replace(/\s+/g, "-")}`,
        name: s.name,
        nameKey: normalizeAdditionName(s.name),
        priceMinor: s.priceMinor,
        currency: "DKK" as const,
        required: false,
        minSelections: null,
        maxSelections: null,
        origin: "SOURCE" as const,
      })),
      origin: "CURRENT_EXPLICIT_SOURCE",
      conflicts,
    };
  }

  const best = sets[0];
  if (!best) {
    return { additions: [], origin: "AI_OR_HUMAN_REVIEW", conflicts };
  }
  return {
    additions: best.additions,
    origin: "RESTAURANT_CATEGORY_OR_RESTAURANT_FACT",
    conflicts,
  };
}

function scopeRank(scope: AdditionSetFact["scope"]): number {
  switch (scope) {
    case "EXACT_PRODUCT":
    case "EXACT_CASE":
      return 100;
    case "RESTAURANT_CATEGORY":
      return 50;
    case "RESTAURANT":
      return 20;
    default:
      return 0;
  }
}

export function assertNoCrossRestaurantPriceLeak(input: {
  factsA: PriceFact[];
  restaurantB: string;
  appliesTo: string;
}): void {
  for (const f of input.factsA) {
    if (
      f.restaurantKey !== input.restaurantB &&
      f.appliesTo === input.appliesTo &&
      f.status === "ACTIVE"
    ) {
      // Caller must not apply — this is a test helper assertion surface
      throw new Error(
        `CROSS_RESTAURANT_FACT_LEAK_BLOCKED: ${f.factId} from ${f.restaurantKey}`,
      );
    }
  }
}
