/**
 * Live-first QA quality merge.
 *
 * Quality check improves the live menu. Live is the baseline; peer/logical
 * rules and polish fill gaps or fix defects. Never treat a PDF as absolute truth.
 */

import type { PlannedProductPayload } from "../runner/writePlan.js";
import {
  assessLabelQuality,
  formatProductName,
  stripTrailingPriceNoise,
} from "../domain/textNormalize.js";
import {
  sanitizeAdditionList,
  sanitizeIngredientList,
  dishNameHasIngredientDump,
  ingredientListHasDefects,
  additionListHasDefects,
  polishDescriptionText,
  isForbiddenTilbehorName,
  looksLikeToppingAsProductName,
} from "../domain/menuCardQuality.js";
import {
  grillTilbehorLooksWrong,
  isGrillCategory,
  isBurgerProductName,
  productWantsGrillDips,
  grillIngredientsInsufficient,
} from "../domain/grillCardFill.js";
import {
  looksLikeCategoryHeaderName,
  recoverProductLabelsForReconcile,
  stripPriceLeakFromDescription,
  type LiveProductSnapshot,
  type ReconcileField,
  type ReconcileFieldDelta,
  type ReconcileReasonCode,
} from "./menuReconcile.js";
import type { IngredientLikelihoodPolicy } from "../learning/ingredientLikelihood.js";
import type { ProbabilityPolicyMap } from "../learning/categoryLikelihood.js";
import {
  isForbiddenMenuVariantName,
  stripForbiddenMenuVariants,
} from "../learning/categorySizeVariantPolicy.js";
import type { DestinationCategory } from "./categoryMapping.js";
import { isTahCanaryProduct } from "./canaries.js";
import type { CanonicalMenu } from "../domain/schema/canonical.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../domain/versions.js";
import type { DryRunDestinationSnapshot } from "./dryRun.js";
export type MenuPlacementKind =
  | "dip"
  | "pizza"
  | "drink"
  | "grill"
  | "rice"
  | "other";

const DIP_PRODUCT_RE =
  /\b(dyppelse|dip|sauce|mayo|mayonnaise|remoulade|ketchup|dressing|valgfri\s+dyppelse)\b/i;
const DIP_CATEGORY_RE =
  /\b(tilbehør|tilbehor|dip|dyppelse|sauce|saucer|dressing)\b/i;
const PIZZA_CAT_RE = /\bpizza\b/i;
const DRINK_RE = /\b(cola|fanta|sprite|vand|sodavand|øl|øl|vin|juice|shake)\b/i;
const REVIEW_STUB_RE = /^review$/i;
const HYPHEN_BULLET_RE = /^\s*[-–—•]\s*/;

export function classifyMenuPlacementKind(input: {
  name: string;
  categoryName?: string;
  description?: string;
}): MenuPlacementKind {
  const name = input.name.trim();
  const cat = input.categoryName ?? "";
  const blob = `${name} ${cat} ${input.description ?? ""}`;
  if (DIP_PRODUCT_RE.test(name) || DIP_PRODUCT_RE.test(blob)) return "dip";
  if (DRINK_RE.test(name) || /drikke|drinks/i.test(cat)) return "drink";
  if (/ris|biryani|curry/i.test(name) || /ris|indisk/i.test(cat)) return "rice";
  if (/burger|durum|pita|kebab|grill/i.test(name) || /grill|burger/i.test(cat)) {
    return "grill";
  }
  if (/pizza/i.test(name) || PIZZA_CAT_RE.test(cat)) return "pizza";
  return "other";
}

export function findPreferredCategoryForKind(
  kind: MenuPlacementKind,
  categories: DestinationCategory[],
  currentCategoryIds: string[],
): DestinationCategory | null {
  if (kind !== "dip") {
    const current = categories.find((c) => currentCategoryIds.includes(c.databaseId));
    return current ?? null;
  }
  const dipHits = categories.filter((c) => DIP_CATEGORY_RE.test(c.name));
  if (dipHits.length === 1) return dipHits[0]!;
  if (dipHits.length > 1) {
    const tilbehor = dipHits.find((c) => /tilbeh/i.test(c.name));
    return tilbehor ?? dipHits[0]!;
  }
  // Soft fallback: any non-pizza category named extras-like
  const soft = categories.find((c) => /extra|side|anden/i.test(c.name));
  return soft ?? null;
}

export function polishIngredientList(
  raw: readonly string[],
  productName?: string,
): string[] {
  return sanitizeIngredientList(raw, productName);
}

export function polishVariants(
  variants: Array<{ name: string; surchargeOre?: number; priceOre?: number }>,
): Array<{ name: string; surchargeOre: number }> {
  const cleaned = stripForbiddenMenuVariants(
    variants
      .map((v) => ({
        name: formatProductName(v.name.replace(HYPHEN_BULLET_RE, "")),
        surchargeOre: v.surchargeOre ?? v.priceOre ?? 0,
      }))
      .filter((v) => v.name && !REVIEW_STUB_RE.test(v.name)),
  );
  if (cleaned.length === 0) {
    return [{ name: "Alm.", surchargeOre: 0 }];
  }
  return cleaned;
}

export function polishAdditions(
  additions: Array<{ name: string; priceOre: number }>,
  productName?: string,
  categoryName?: string,
): Array<{ name: string; priceOre: number }> {
  return sanitizeAdditionList(
    additions.map((a) => ({
      name: a.name.replace(HYPHEN_BULLET_RE, ""),
      priceOre: a.priceOre,
    })),
    productName,
    categoryName,
  );
}

/** Field quality: higher is better. Defective live scores low so fixes can apply. */
export function fieldQualityScore(
  field: ReconcileField,
  value: unknown,
  ctx?: { categoryName?: string; productName?: string },
): number {
  switch (field) {
    case "name": {
      const n = String(value ?? "").trim();
      if (!n) return 0;
      if (looksLikeCategoryHeaderName(n)) return 0;
      if (looksLikeToppingAsProductName(n)) return 0;
      if (REVIEW_STUB_RE.test(n)) return 0;
      if (dishNameHasIngredientDump(n)) return 1;
      return Math.min(10, 4 + Math.min(6, Math.floor(n.length / 8)));
    }
    case "description": {
      const d = String(value ?? "").trim();
      if (!d) return 0;
      if (/\b\d{2,4}\b/.test(d)) return 1;
      if (/,\s*og\s*,/i.test(d) || /og,\s*$/i.test(d)) return 2;
      if (/[A-Za-zÆØÅæøå]{3,}og[A-Za-zÆØÅæøå]{3,}/i.test(d)) return 2;
      if (/\s+og\s*,\s*/i.test(d)) return 2;
      return Math.min(12, 3 + Math.min(9, Math.floor(d.length / 12)));
    }
    case "ingredients": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      if (ingredientListHasDefects(list, ctx?.productName)) return 1;
      const clean = polishIngredientList(list, ctx?.productName);
      if (clean.length === 0) return 0;
      if (
        ctx?.productName &&
        grillIngredientsInsufficient(clean, ctx.productName)
      ) {
        return 1;
      }
      return Math.min(12, clean.length * 2);
    }
    case "variants": {
      const list = Array.isArray(value)
        ? (value as Array<{ name?: string }>)
        : [];
      if (list.some((v) => REVIEW_STUB_RE.test(String(v.name ?? "")))) return 0;
      // Hard prior: "Menu" as variant is always defective (Menuer category instead).
      if (
        list.some((v) => isForbiddenMenuVariantName(String(v.name ?? "")))
      ) {
        return 0;
      }
      if (list.length === 0) return 1;
      return Math.min(8, 2 + list.length);
    }
    case "additions": {
      const list = Array.isArray(value)
        ? (value as Array<{ name?: string; priceOre?: number }>)
        : [];
      const named = list.filter(
        (a): a is { name: string; priceOre?: number } =>
          typeof a.name === "string" && a.name.trim().length > 0,
      );
      // Hard prior: product-as-tilbehør (pommes, valgfri dyppelse, …) is always defective.
      if (named.some((a) => isForbiddenTilbehorName(a.name))) {
        return 0;
      }
      const drinkLike =
        classifyMenuPlacementKind({
          name: ctx?.productName ?? "",
          categoryName: ctx?.categoryName ?? "",
        }) === "drink";
      // Drinks: empty Tilbehør is correct and must outrank any live dips.
      if (drinkLike) {
        return named.length === 0 ? 8 : 0;
      }
      const grillCtx = {
        name: ctx?.productName ?? "",
        categoryName: ctx?.categoryName ?? "",
      };
      // Fries / pommes / grill menus: pizza-dump Tilbehør scores 0; dips score high.
      if (productWantsGrillDips(grillCtx)) {
        if (grillTilbehorLooksWrong(named, grillCtx)) return 0;
        const dipHits = named.filter((a) =>
          /\b(mayo|mayonnaise|remoulade|ketchup)\b/i.test(a.name),
        ).length;
        if (dipHits >= 2 && named.length <= 6) return 9;
        if (named.length === 0) return 1;
      }
      if (
        additionListHasDefects(named, ctx?.productName, ctx?.categoryName)
      ) {
        return 1;
      }
      const clean = named.filter((a) => !REVIEW_STUB_RE.test(a.name));
      return Math.min(10, clean.length);
    }
    case "basePrice": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (n < 500 || n > 200_000) return 1;
      return 5;
    }
    case "categoryIds": {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      if (ids.length === 0) return 0;
      const kind = classifyMenuPlacementKind({
        name: ctx?.productName ?? "",
        categoryName: ctx?.categoryName ?? "",
      });
      if (kind === "dip" && PIZZA_CAT_RE.test(ctx?.categoryName ?? "")) return 0;
      return 5;
    }
    default:
      return 0;
  }
}

export function isLiveFieldDefective(
  field: ReconcileField,
  liveValue: unknown,
  ctx?: { categoryName?: string; productName?: string },
): boolean {
  return fieldQualityScore(field, liveValue, ctx) <= 1;
}

/**
 * QA merge: TargetMenu (sourcePayload from MenuIntelligenceEngine) is the
 * intelligence candidate. Live is baseline for never-worse comparison.
 * Does NOT invent ingredients/additions/descriptions — only hygiene + selection.
 */
export function buildQaTargetPayload(input: {
  live: LiveProductSnapshot;
  sourcePayload: PlannedProductPayload;
  liveCategoryName?: string;
  destinationCategories: DestinationCategory[];
  /** @deprecated Intelligence already applied — ignored. */
  ingredientLikelihood?: IngredientLikelihoodPolicy | null;
  /** @deprecated Intelligence already applied — ignored. */
  probabilityPolicy?: ProbabilityPolicyMap | null;
}): PlannedProductPayload {
  void input.ingredientLikelihood;
  void input.probabilityPolicy;
  const live = input.live;
  const source = input.sourcePayload;
  const catName = input.liveCategoryName ?? "";
  const ctx = { productName: live.name, categoryName: catName };

  const liveRecovered = recoverProductLabelsForReconcile({
    name: live.name,
    description: live.description ?? "",
    ingredients: live.ingredients ?? [],
    ...(catName ? { categoryName: catName } : {}),
  });

  // Name: prefer live unless defective; then TargetMenu / recovered.
  let name = live.name.trim();
  if (
    looksLikeCategoryHeaderName(name) ||
    looksLikeToppingAsProductName(name) ||
    !name ||
    dishNameHasIngredientDump(name)
  ) {
    const recovered = liveRecovered.name.trim();
    const recoveredOk =
      recovered &&
      !looksLikeCategoryHeaderName(recovered) &&
      !looksLikeToppingAsProductName(recovered);
    const src = formatProductName(source.name);
    name =
      (recoveredOk ? recovered : "") ||
      (src && !looksLikeToppingAsProductName(src) ? src : "") ||
      formatProductName(name) ||
      live.name.trim();
  } else {
    name = formatProductName(name);
  }

  // Ingredients: never-worse — keep richer valid live; else take TargetMenu.
  let ingredients = polishIngredientList(live.ingredients ?? [], name);
  const sourceIngredients = polishIngredientList(source.ingredients, name);
  const liveIngScore = fieldQualityScore("ingredients", ingredients, ctx);
  const srcIngScore = fieldQualityScore("ingredients", sourceIngredients, ctx);
  if (srcIngScore > liveIngScore || ingredients.length === 0) {
    ingredients = sourceIngredients.length ? sourceIngredients : ingredients;
  }

  // Description: never-worse hygiene; prefer TargetMenu when live defective.
  let description = polishDescriptionText(
    stripPriceLeakFromDescription(
      stripTrailingPriceNoise((live.description ?? "").trim()),
    ),
    name,
  );
  const sourceDesc = polishDescriptionText(
    stripPriceLeakFromDescription(
      stripTrailingPriceNoise(source.description || ""),
    ),
    name,
  );
  const liveDescScore = fieldQualityScore("description", description, {
    ...ctx,
    productName: name,
  });
  const srcDescScore = fieldQualityScore("description", sourceDesc, {
    ...ctx,
    productName: name,
  });
  if (srcDescScore > liveDescScore || liveDescScore <= 1) {
    description = sourceDesc || description;
  }

  // Additions: TargetMenu candidate vs live — strip only, never invent.
  const liveAdds = polishAdditions(live.additions ?? [], name, catName);
  const sourceAdds = polishAdditions(source.additions, name, catName);
  const liveAddScore = fieldQualityScore("additions", liveAdds, {
    ...ctx,
    productName: name,
  });
  const srcAddScore = fieldQualityScore("additions", sourceAdds, {
    ...ctx,
    productName: name,
  });
  let additions =
    srcAddScore > liveAddScore || liveAdds.length === 0
      ? sourceAdds
      : liveAdds;
  additions = polishAdditions(additions, name, catName);

  // Variants: strip Menu; prefer polished live unless defective.
  const liveVars = polishVariants(
    (live.variants ?? []).map((v) => ({
      name: v.name,
      surchargeOre: v.priceOre,
    })),
  );
  const sourceVars = polishVariants(source.variants);
  const liveHadForbiddenMenu = (live.variants ?? []).some((v) =>
    isForbiddenMenuVariantName(v.name),
  );
  const liveVarDefective =
    liveHadForbiddenMenu ||
    (live.variants ?? []).some((v) => REVIEW_STUB_RE.test(v.name)) ||
    (live.variants ?? []).length === 0;
  const variants =
    liveVarDefective && liveVars.length === 0
      ? sourceVars
      : liveVars.length
        ? liveVars
        : sourceVars;

  let basePriceOre = live.basePriceOre ?? 0;
  if (basePriceOre <= 0 && source.basePriceOre > 0) {
    basePriceOre = source.basePriceOre;
  }

  let categoryIds = [...(live.categoryIds ?? source.categoryIds)];
  const placement = classifyMenuPlacementKind({
    name,
    categoryName: catName,
    description,
  });
  if (placement === "dip" && PIZZA_CAT_RE.test(catName)) {
    const preferred = findPreferredCategoryForKind(
      "dip",
      input.destinationCategories,
      categoryIds,
    );
    if (preferred) categoryIds = [preferred.databaseId];
  }

  const assessment = assessLabelQuality({
    name,
    description,
    ingredients,
  });

  let outName = assessment.repaired.name || name;
  if (looksLikeToppingAsProductName(outName)) {
    const src = formatProductName(source.name);
    if (
      src &&
      !looksLikeToppingAsProductName(src) &&
      !looksLikeCategoryHeaderName(src)
    ) {
      outName = src;
    }
  }

  return {
    sourceId: source.sourceId,
    menuNumber: live.menuNumber || source.menuNumber,
    name: outName,
    description: assessment.repaired.description || description,
    basePriceOre,
    categoryIds,
    variants,
    ingredients: assessment.repaired.ingredients.length
      ? assessment.repaired.ingredients
      : ingredients,
    additions,
    intendedHidden: source.intendedHidden,
  };
}

/**
 * Drop deltas that would make the live card worse (unless live is defective).
 */
export function filterNeverWorseDeltas(input: {
  live: LiveProductSnapshot;
  intended: PlannedProductPayload;
  deltas: ReconcileFieldDelta[];
  liveCategoryName?: string;
}): {
  kept: ReconcileFieldDelta[];
  blocked: Array<ReconcileFieldDelta & { blockReason: "BLOCKED_WORSE_THAN_LIVE" }>;
} {
  const ctx = {
    ...(input.liveCategoryName
      ? { categoryName: input.liveCategoryName }
      : {}),
    productName: input.live.name,
  };
  const kept: ReconcileFieldDelta[] = [];
  const blocked: Array<
    ReconcileFieldDelta & { blockReason: "BLOCKED_WORSE_THAN_LIVE" }
  > = [];

  for (const delta of input.deltas) {
    const beforeScore = fieldQualityScore(delta.field, delta.before, ctx);
    const afterScore = fieldQualityScore(delta.field, delta.after, ctx);
    const defective = isLiveFieldDefective(delta.field, delta.before, ctx);
    // Hard prior: never write a topping/sauce as the product name (Salatpizza→Tomat).
    if (delta.field === "name") {
      const afterName = String(delta.after ?? "").trim();
      const beforeName = String(delta.before ?? "").trim();
      if (looksLikeToppingAsProductName(afterName)) {
        blocked.push({ ...delta, blockReason: "BLOCKED_WORSE_THAN_LIVE" });
        continue;
      }
      if (
        (looksLikeToppingAsProductName(beforeName) ||
          looksLikeCategoryHeaderName(beforeName) ||
          !beforeName) &&
        afterName &&
        !looksLikeToppingAsProductName(afterName) &&
        !looksLikeCategoryHeaderName(afterName)
      ) {
        kept.push(delta);
        continue;
      }
    }
    // Hard prior: always allow clearing Tilbehør / dips off drinks.
    if (delta.field === "additions") {
      const productName = input.intended.name || input.live.name;
      const drinkLike =
        classifyMenuPlacementKind({
          name: productName,
          ...(input.liveCategoryName
            ? { categoryName: input.liveCategoryName }
            : {}),
        }) === "drink";
      const afterList = Array.isArray(delta.after)
        ? (delta.after as Array<{ name?: string }>).filter(
            (a) => typeof a.name === "string" && a.name.trim().length > 0,
          )
        : [];
      const beforeList = Array.isArray(delta.before)
        ? (delta.before as Array<{ name: string }>).filter(
            (a) => typeof a.name === "string" && a.name.trim().length > 0,
          )
        : [];
      if (drinkLike && afterList.length === 0) {
        kept.push(delta);
        continue;
      }
      // Hard prior: always strip forbidden Tilbehør (pommes, valgfri dyppelse, …).
      const beforeForbidden = beforeList.filter((a) =>
        isForbiddenTilbehorName(a.name),
      );
      const afterForbidden = afterList.filter((a) =>
        isForbiddenTilbehorName(String(a.name ?? "")),
      );
      if (beforeForbidden.length > 0 && afterForbidden.length === 0) {
        kept.push(delta);
        continue;
      }
      // Hard prior: strip dips from kinds that never allow them (burger/sandwich/pizza).
      const beforeDipHeavy = beforeList.filter((a) =>
        /\b(mayo|mayonnaise|remoulade|ketchup|salatmayo)\b/i.test(a.name),
      );
      const afterDipHeavy = afterList.filter((a) =>
        /\b(mayo|mayonnaise|remoulade|ketchup|salatmayo)\b/i.test(
          String(a.name ?? ""),
        ),
      );
      if (
        !productWantsGrillDips({
          name: productName,
          categoryName: input.liveCategoryName ?? "",
        }) &&
        beforeDipHeavy.length > 0 &&
        afterDipHeavy.length < beforeDipHeavy.length &&
        !/\b(pommes|frites|nuggets?)\b/i.test(productName)
      ) {
        kept.push(delta);
        continue;
      }
      // Hard prior: refill plain-burger ekstra after dip/forbidden strip left [].
      if (
        isBurgerProductName(productName) &&
        !productWantsGrillDips({
          name: productName,
          categoryName: input.liveCategoryName ?? "",
        }) &&
        (beforeList.length === 0 ||
          beforeDipHeavy.length > 0 ||
          beforeForbidden.length > 0) &&
        afterList.length >= 3 &&
        afterDipHeavy.length === 0 &&
        afterForbidden.length === 0
      ) {
        kept.push(delta);
        continue;
      }
      // Hard prior: always allow fixing fries/grill Tilbehør to restaurant dips.
      const grillCtx = {
        name: productName,
        categoryName: input.liveCategoryName ?? "",
      };
      if (
        productWantsGrillDips(grillCtx) &&
        (grillTilbehorLooksWrong(beforeList, grillCtx) ||
          beforeList.length === 0) &&
        afterList.length > 0
      ) {
        kept.push(delta);
        continue;
      }
    }
    // Hard prior: upgrade thin burger ingredient cards (e.g. only "Bacon").
    if (delta.field === "ingredients") {
      const productName = input.intended.name || input.live.name;
      const beforeList = Array.isArray(delta.before)
        ? (delta.before as string[]).filter(
            (x) => typeof x === "string" && x.trim().length > 0,
          )
        : [];
      const afterList = Array.isArray(delta.after)
        ? (delta.after as string[]).filter(
            (x) => typeof x === "string" && x.trim().length > 0,
          )
        : [];
      if (
        isBurgerProductName(productName) &&
        grillIngredientsInsufficient(beforeList, productName) &&
        afterList.length >= 4
      ) {
        kept.push(delta);
        continue;
      }
    }
    // Hard prior: always strip forbidden "Menu" variants (Menuer is a category).
    if (delta.field === "variants") {
      const beforeList = Array.isArray(delta.before)
        ? (delta.before as Array<{ name?: string }>)
        : [];
      const afterList = Array.isArray(delta.after)
        ? (delta.after as Array<{ name?: string }>)
        : [];
      const beforeHadMenu = beforeList.some((v) =>
        isForbiddenMenuVariantName(String(v.name ?? "")),
      );
      const afterHasMenu = afterList.some((v) =>
        isForbiddenMenuVariantName(String(v.name ?? "")),
      );
      if (beforeHadMenu && !afterHasMenu) {
        kept.push(delta);
        continue;
      }
    }
    if (!defective && afterScore < beforeScore) {
      blocked.push({ ...delta, blockReason: "BLOCKED_WORSE_THAN_LIVE" });
      continue;
    }
    // Category: only keep when fixing kind conflict
    if (delta.field === "categoryIds") {
      const kind = classifyMenuPlacementKind({
        name: input.intended.name,
        ...(input.liveCategoryName
          ? { categoryName: input.liveCategoryName }
          : {}),
      });
      if (
        kind === "dip" &&
        PIZZA_CAT_RE.test(input.liveCategoryName ?? "")
      ) {
        kept.push(delta);
      } else if (defective || afterScore > beforeScore) {
        kept.push(delta);
      } else {
        blocked.push({ ...delta, blockReason: "BLOCKED_WORSE_THAN_LIVE" });
      }
      continue;
    }
    kept.push(delta);
  }
  return { kept, blocked };
}

export function liveSnapshotCategoryName(
  live: LiveProductSnapshot,
  categories: DestinationCategory[],
): string {
  const id = live.categoryIds?.[0];
  if (!id) return "";
  return categories.find((c) => c.databaseId === id)?.name ?? "";
}

/** Build a CanonicalMenu from the live destination (QA without PDF). */
export function canonicalMenuFromLiveDestination(input: {
  restaurantName: string;
  destination: DryRunDestinationSnapshot;
}): CanonicalMenu {
  const catById = new Map(
    input.destination.categories.map((c) => [c.databaseId, c]),
  );
  const groups = new Map<
    string,
    {
      catId: string;
      catName: string;
      products: DryRunDestinationSnapshot["products"];
    }
  >();

  for (const p of input.destination.products) {
    if (isTahCanaryProduct(p.name)) continue;
    const catId = p.categoryIds[0] ?? "__uncategorized__";
    const catName =
      catById.get(catId)?.name ??
      (catId === "__uncategorized__" ? "Uncategorized" : catId);
    const existing = groups.get(catId);
    if (existing) existing.products.push(p);
    else groups.set(catId, { catId, catName, products: [p] });
  }

  let catOrder = 0;
  const categories = [...groups.values()].map((g) => {
    catOrder += 1;
    let productOrder = 0;
    return {
      sourceId: `live-cat:${g.catId}`,
      name: g.catName,
      sourceOrder: catOrder,
      commonIngredients: [],
      products: g.products.map((p) => {
        productOrder += 1;
        return {
          sourceId: `live-prod:${p.databaseId}`,
          categorySourceId: `live-cat:${g.catId}`,
          name: p.name,
          description: p.description ?? "",
          sourceMenuNumber: p.menuNumber,
          assignedMenuNumber: p.menuNumber,
          sourceOrder: productOrder,
          ...(typeof p.basePriceOre === "number"
            ? { basePrice: p.basePriceOre, basePriceOrigin: "SOURCE" as const }
            : {}),
          ingredients: (p.ingredients ?? [])
            .map((display) => ({
              display,
              origin: "SOURCE" as const,
            }))
            .filter((i) => i.display.trim()),
          variants: (p.variants ?? []).map((v, i) => ({
            sourceId: `live-var:${p.databaseId}:${i}`,
            name: v.name,
            nameOrigin: "SOURCE" as const,
            surcharge: v.priceOre,
            surchargeOrigin: "SOURCE" as const,
            isBase: i === 0,
          })),
          addOns: (p.additions ?? []).map((a, i) => ({
            sourceId: `live-add:${p.databaseId}:${i}`,
            name: a.name,
            price: a.priceOre,
            origin: "SOURCE" as const,
          })),
          productChoices: [],
          isCombo: false,
          status: "READY" as const,
          issues: [],
        };
      }),
    };
  });

  return {
    restaurantName: input.restaurantName,
    sourceInfo: "live_destination",
    destinationInfo: input.destination.host,
    categories,
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
    status: "READY",
    issues: [],
  };
}

export function qaTargetHasWriteBlockingIssues(
  payload: PlannedProductPayload,
  liveCategoryName?: string,
): string | null {
  const assessment = assessLabelQuality({
    name: payload.name,
    description: payload.description,
    ingredients: payload.ingredients,
  });
  if (
    assessment.severity === "BLOCK" ||
    assessment.severity === "REVIEW"
  ) {
    return `LABEL_QUALITY_${assessment.severity}: ${assessment.reasons.join(",")}`;
  }
  if (payload.variants.some((v) => REVIEW_STUB_RE.test(v.name))) {
    return "REVIEW_VARIANT_STUB";
  }
  const kind = classifyMenuPlacementKind({
    name: payload.name,
    ...(liveCategoryName ? { categoryName: liveCategoryName } : {}),
    description: payload.description,
  });
  // Pizza-like categories need listed toppings. Grill may be name-only on
  // the source menu — do not block Opdater for Tilbehør / description fills.
  if (
    kind !== "drink" &&
    payload.ingredients.length === 0 &&
    !DIP_PRODUCT_RE.test(payload.name) &&
    !isGrillCategory(liveCategoryName)
  ) {
    if (
      /pizza|pasta|salad|salat/i.test(liveCategoryName ?? "") ||
      /pizza|pasta/i.test(payload.name)
    ) {
      return "EMPTY_INGREDIENTS_FOR_FOOD";
    }
  }
  if (ingredientListHasDefects(payload.ingredients, payload.name)) {
    return "INVALID_INGREDIENT_TOKENS";
  }
  if (additionListHasDefects(payload.additions, payload.name)) {
    return "INVALID_OR_FLAT_TILBEHOR";
  }
  if (dishNameHasIngredientDump(payload.name)) {
    return "NAME_INGREDIENT_DUMP";
  }
  return null;
}

/** Re-export reason helper for reports. */
export type NeverWorseBlock = {
  field: ReconcileField;
  reasons: ReconcileReasonCode[];
  blockReason: "BLOCKED_WORSE_THAN_LIVE";
};
