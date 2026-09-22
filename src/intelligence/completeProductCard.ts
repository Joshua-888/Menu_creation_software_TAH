/**
 * One professional product-card completion engine used by Create and QA.
 */

import type { CanonicalProduct, CanonicalMenu } from "../domain/schema/canonical.js";
import {
  resolveGrillIngredients,
  grillIngredientsInsufficient,
  preferBurgerEkstraAdditions,
  preferGrillDipAdditions,
  productWantsGrillDips,
  isBurgerProductName,
  isGrillCategory,
  type GrillIngredientSource,
} from "../domain/grillCardFill.js";
import {
  formatDescriptionFromIngredients,
  formatProductName,
} from "../domain/textNormalize.js";
import {
  defaultTilbehorPriceOre,
  isForbiddenTilbehorName,
  sanitizeIngredientList,
  sanitizeAdditionList,
} from "../domain/menuCardQuality.js";
import { isForbiddenMenuVariantName } from "../learning/categorySizeVariantPolicy.js";
import { classifyProductKind } from "../learning/categoryLikelihood.js";
import type { IngredientLikelihoodPolicy } from "../learning/ingredientLikelihood.js";
import {
  classifyPhrase,
  isInvalidAdditionEntity,
  isInvalidIngredientEntity,
} from "./semanticClassifier.js";
import {
  buildAdditionCandidatePool,
  resolveAdditionCandidates,
  resolveAdditionPrice,
  isAdditionSetSufficient,
  additionTierRank,
  type AdditionCandidate,
} from "./additionCandidatePool.js";
import { inferProductFamily, isFoodFamily } from "./peerCohorts.js";
import { assessIngredientSufficiency } from "./ingredientSufficiency.js";
import { getFieldRequirements } from "./fieldRequirements.js";
import { applyCategoryQualifiedProductName } from "./categoryQualifiedProductName.js";
import { parseSourceComponents } from "./sourceComponentParse.js";
import { normalizeAdditionName } from "../decisions/facts.js";
import type {
  CompletedProductCard,
  FieldCompletenessTrace,
  FieldProvenance,
  FieldRequirementLevel,
  FieldSufficiencyStatus,
  ProductFamily,
  SemanticProvenanceTier,
} from "./types.js";

function provenance(
  field: string,
  value: string,
  origin: FieldProvenance["origin"],
  confidence: number,
  extra?: Partial<FieldProvenance>,
): FieldProvenance {
  return { field, value, origin, confidence, ...extra };
}

function DanishDescription(ingredients: string[]): string {
  return formatDescriptionFromIngredients(ingredients);
}

function filterValidIngredients(
  raw: string[],
  productName: string,
): { list: string[]; provenance: FieldProvenance[] } {
  const list: string[] = [];
  const prov: FieldProvenance[] = [];
  for (const token of sanitizeIngredientList(raw, productName)) {
    if (
      /^menu\s*:/i.test(token) ||
      /^(tilbehør|menu|valgfri)/i.test(token.trim()) ||
      /\[(spatial-fallback|base-menu-reassign|col-shift)/i.test(token)
    ) {
      continue;
    }
    const comboProduct = /\bmenu\b/i.test(productName);
    const shortCombo =
      token.split(/\s+/).length <= 4 &&
      !/\|/.test(token) &&
      /\b(sodavand|cola|fanta|sprite|pommes|pomfrit+er?|frites|nuggets?|pitabrød)\b/i.test(
        token,
      );
    if (comboProduct && shortCombo) {
      list.push(token);
      prov.push(
        provenance("ingredients", token, "SOURCE", 0.9, {
          reason: "combo_component",
        }),
      );
      continue;
    }
    const cls = classifyPhrase(token, {
      layoutRole: "ingredient_line",
      parentProductName: productName,
    });
    if (isInvalidIngredientEntity(cls.entityType) && cls.entityType !== "INGREDIENT") {
      if (cls.entityType === "UNKNOWN" && token.toLowerCase() === productName.toLowerCase()) {
        continue;
      }
      if (
        cls.entityType === "META_INSTRUCTION" ||
        cls.entityType === "CATEGORY" ||
        cls.entityType === "COMBO_CONTEXT" ||
        cls.entityType === "PRODUCT_NAME"
      ) {
        continue;
      }
    }
    if (token.toLowerCase() === productName.toLowerCase()) continue;
    list.push(token);
    prov.push(
      provenance("ingredients", token, "SOURCE", cls.confidence, {
        reason: cls.reason,
      }),
    );
  }
  return { list, provenance: prov };
}

function filterValidAdditions(
  raw: Array<{ name: string; priceOre?: number }>,
  productFamily: ProductFamily,
): CompletedProductCard["additions"] {
  const out: CompletedProductCard["additions"] = [];
  for (const a of raw) {
    const name = formatProductName(a.name);
    if (!name || isForbiddenTilbehorName(name)) continue;
    const cls = classifyPhrase(name);
    if (isInvalidAdditionEntity(cls.entityType)) continue;
    if (productFamily === "DRINK") {
      // Constitution: drinks never inherit food dips / burger extras
      if (
        /\b(mayo|mayonnaise|ketchup|remoulade|bacon|ost|salat|tomat|løg|oksekød)\b/i.test(
          name,
        )
      ) {
        continue;
      }
    }
    out.push({
      name,
      ...(a.priceOre != null
        ? {
            priceOre: a.priceOre,
            priceProvenance: provenance(
              "addition.price",
              String(a.priceOre),
              a.priceOre != null ? "SOURCE" : "SYSTEM_DEFAULT",
              a.priceOre != null ? 0.9 : 0.3,
            ),
          }
        : {}),
    });
  }
  return out;
}

/**
 * Conservative name/category domain priors — only when source evidence is thin
 * and the inference is objectively encoded in the dish title.
 */
function inferDomainIngredientsFromName(input: {
  name: string;
  categoryName: string;
  family: ProductFamily;
}): string[] {
  const name = input.name.trim();
  const out: string[] = [];
  const push = (t: string) => {
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  if (/\bspaghetti\s+bolognese\b/i.test(name)) {
    push("Spaghetti");
    push("Kødsovs");
    return out;
  }
  if (/\b(durum|dürüm)\b/i.test(name) && /\bkebab\b/i.test(name)) {
    push("Kebab");
    push("Durumbrød");
    return out;
  }
  if (/\bdurum\b/i.test(name) && /falafel/i.test(`${name} ${input.categoryName}`)) {
    push("Falafel");
    push("Durumbrød");
    return out;
  }
  if (/\bpasta\s+bolognese\b/i.test(name) || /\bbolognese\b/i.test(name)) {
    push("Pasta");
    push("Kødsovs");
    return out;
  }
  if (/\bpenne\b/i.test(name) && /\b(arrabbiata|carbonara|bolognese)\b/i.test(name)) {
    push("Penne");
    if (/\bcarbonara\b/i.test(name)) {
      push("Bacon");
      push("Æg");
      push("Parmesan");
    } else if (/\bbolognese\b/i.test(name)) {
      push("Kødsovs");
    }
    return out;
  }
  if (/\b(pommes|frites)\b/i.test(name) || input.family === "FRIES") {
    if (/\bkebab/i.test(name)) push("Kebab");
    if (/\bkylling/i.test(name)) push("Kylling");
    if (/\bfisk/i.test(name)) push("Fiskefilet");
    if (/\bpølse/i.test(name)) push("Pølse");
    if (/\bnuggets?/i.test(name)) push("Nuggets");
    if (/\bgrillkyling|grill\s*kylling/i.test(name)) push("Grillkylling");
    push("Pommes frites");
    if (out.length === 1) push("Kartofler");
    return out;
  }
  if (/^naan(brød)?$/i.test(name) || /\bnaanbrød\b/i.test(name)) {
    push("Naan");
    push("Hvedemel");
    return out;
  }
  if (/^pommes$/i.test(name)) {
    push("Pommes frites");
    push("Kartofler");
    return out;
  }
  if (
    input.family === "PIZZA" ||
    input.family === "CALZONE" ||
    input.family === "SALATPIZZA" ||
    // NOTE: "indbagt" (Danish for battered/deep-fried) is a generic cooking
    // method word, NOT a pizza/calzone signal. Bare name/category matching on
    // it fabricated pizza toppings on unrelated fried dishes (WP-F). Pizza
    // topping injection now requires a real pizza/calzone family or an
    // unambiguous pizza-shop token/category.
    /pizza|calzone|ufo|bambino/i.test(name) ||
    /pizza|calzone|ufo/i.test(input.categoryName)
  ) {
    push("Tomat");
    push("Ost");
    if (/pepperoni/i.test(name)) push("Pepperoni");
    if (/hawaii/i.test(name)) {
      push("Skinke");
      push("Ananas");
    }
    if (/margarita|margherita/i.test(name)) push("Basilikum");
    if (/vegetar/i.test(name)) {
      push("Champignon");
      push("Paprika");
      push("Løg");
    }
    if (/calzone/i.test(name) || input.family === "CALZONE") {
      push("Skinke");
    }
    if (/\bufo\b/i.test(name)) {
      push("Kødsovs");
    }
    return out;
  }
  if (/\bfried\s+rice\b/i.test(name) || /\bstegte\s+ris\b/i.test(name)) {
    push("Ris");
    push("Æg");
    push("Grøntsager");
    return out;
  }
  if (/\bfried\s+noodles\b/i.test(name) || /\bstegte\s+nudler\b/i.test(name)) {
    push("Nudler");
    push("Grøntsager");
    return out;
  }
  if (/\bsamosa\b/i.test(name)) {
    push("Dej");
    push("Grøntsager");
    return out;
  }
  if (/\bkottu\b/i.test(name)) {
    push("Brød");
    push("Grøntsager");
    return out;
  }
  // Thai / Asian takeaway title priors (ASCII or Danish)
  if (/pad\s*thai/i.test(name)) {
    push("Risnudler");
    push("Æg");
    push("Bønnespirer");
    if (/kylling/i.test(name)) push("Kylling");
    if (/rejer/i.test(name)) push("Rejer");
    if (/vegetar|tofu/i.test(name)) push("Tofu");
    return out;
  }
  if (/tom\s*yam|tom\s*yum/i.test(name)) {
    push("Rejer");
    push("Lemongrass");
    push("Chili");
    return out;
  }
  if (/satay/i.test(name)) {
    push("Kylling");
    push("Peanut sauce");
    return out;
  }
  if (/forårsruller|foraarsruller/i.test(name)) {
    push("Kylling");
    push("Grøntsager");
    return out;
  }
  if (/curry/i.test(name)) {
    push("Kokosmælk");
    push("Basilikum");
    if (/kylling/i.test(name)) push("Kylling");
    if (/okse|beef/i.test(name)) push("Oksekød");
    if (/tofu/i.test(name)) push("Tofu");
    if (/massaman/i.test(name)) push("Kartofler");
    return out;
  }
  if (/\bwok\b/i.test(name)) {
    push("Grøntsager");
    if (/kylling/i.test(name)) push("Kylling");
    if (/cashew/i.test(name)) push("Cashewnødder");
    if (/basilicum|basilikum/i.test(name)) push("Basilikum");
    return out;
  }
  if (/sweet\s*(and|&)\s*sour/i.test(name)) {
    push("Ananas");
    push("Peber");
    push("Løg");
    if (/kylling/i.test(name)) push("Kylling");
    return out;
  }
  return out;
}

/**
 * Wrap plain source additions as SOURCE-tier candidates for sufficiency tracing.
 * No business logic: identity only, so the shared bar can judge the set.
 */
function toSourceCandidates(
  additions: ReadonlyArray<{ name: string; priceOre?: number | null }>,
): AdditionCandidate[] {
  const out: AdditionCandidate[] = [];
  for (const a of additions) {
    const name = (a.name ?? "").trim();
    if (!name) continue;
    const nameKey = normalizeAdditionName(name);
    if (!nameKey) continue;
    out.push({
      name,
      nameKey,
      priceOre: a.priceOre ?? null,
      tier: "SOURCE",
      priceSource: "SOURCE",
    });
  }
  return out;
}

/**
 * Trace-facing sufficiency of an addition set for a family. Uses the shared
 * WP3 bar ({@link isAdditionSetSufficient}); a drink is NOT_APPLICABLE and an
 * empty set is UNRESOLVED (no evidence) rather than a below-bar failure.
 */
function additionsSufficiencyStatus(
  family: ProductFamily,
  candidates: readonly AdditionCandidate[],
): FieldSufficiencyStatus {
  if (family === "DRINK") return "NOT_APPLICABLE";
  if (candidates.length === 0) return "UNRESOLVED";
  return isAdditionSetSufficient(family, candidates) ? "SUFFICIENT" : "PARTIAL";
}

/**
 * Ordinal ranking of sufficiency status, higher = better evidence. Used to
decide whether a candidate resolution STRICTLY improves the card; a status that
 * stays the same must not trigger a speculative addition (WP4 ruling on generic
 * curry priors that do not resolve the real missing requirement).
 */
function sufficiencyRank(status: FieldSufficiencyStatus): number {
  switch (status) {
    case "SUFFICIENT":
      return 3;
    case "PARTIAL":
      return 2;
    case "INSUFFICIENT":
      return 1;
    case "UNRESOLVED":
      return 0;
    case "NOT_APPLICABLE":
      return -1;
  }
}

/** Map a grill-resolution source onto the shared provenance tier hierarchy. */
function grillSourceTier(source: GrillIngredientSource): SemanticProvenanceTier {
  switch (source) {
    case "PEER_SUBTYPE":
      return "PEER_SUBTYPE";
    case "PEER_KIND":
      return "PEER_FAMILY";
    case "DOMAIN_PRIOR":
      return "DOMAIN_PRIOR";
    case "NONE":
      return "UNRESOLVED";
  }
}

/** Build a WP1 completness trace record without ever over-claiming evidence. */
function buildCompletenessTrace(input: {
  field: string;
  requirementLevel: FieldRequirementLevel;
  initialStatus: FieldSufficiencyStatus;
  finalStatus: FieldSufficiencyStatus;
  evidenceConsidered: SemanticProvenanceTier[];
  selectedTier?: SemanticProvenanceTier;
  selectedValue?: unknown;
}): FieldCompletenessTrace {
  const trace: FieldCompletenessTrace = {
    field: input.field,
    requirementLevel: input.requirementLevel,
    initialStatus: input.initialStatus,
    evidenceConsidered: [...new Set(input.evidenceConsidered)],
    finalStatus: input.finalStatus,
  };
  if (input.selectedTier !== undefined) trace.selectedTier = input.selectedTier;
  if (input.selectedValue !== undefined) trace.selectedValue = input.selectedValue;
  return trace;
}

/**
 * Complete a single product card from source + peer + constitution rules.
 * Shared by Create and QA — no separate grillCardFill universe at call sites.
 */
export function completeProductCard(input: {
  product: CanonicalProduct;
  categoryName: string;
  ingredientLikelihood?: IngredientLikelihoodPolicy | null;
  existingAdditions?: Array<{ name: string; priceOre?: number }>;
  preserveLiveRichness?: boolean;
}): CompletedProductCard {
  const sourceName = formatProductName(input.product.name);
  const qualified = applyCategoryQualifiedProductName({
    productName: sourceName,
    categoryName: input.categoryName,
  });
  const name = qualified.name;
  const family = inferProductFamily({
    name,
    categoryName: input.categoryName,
    ...(input.product.description
      ? { description: input.product.description }
      : {}),
  });
  const provenanceList: FieldProvenance[] = [
    provenance(
      "name",
      name,
      qualified.trace.changed ? "SEMANTIC_RULE" : "SOURCE",
      qualified.trace.changed ? 0.92 : 0.95,
      qualified.trace.changed
        ? {
            reason: `${qualified.trace.policyId}:${qualified.trace.reason}`,
            sourceRef: qualified.trace.originalName,
          }
        : undefined,
    ),
    provenance("category", input.categoryName, "SOURCE", 0.9),
  ];

  const isCombo =
    input.product.isCombo ||
    family === "COMBO_MENU" ||
    /\bmenu\b/i.test(name);

  const sourceDescription = (input.product.description ?? "").trim();
  const sourceRawText = input.product.evidence?.rawText;
  const derivedMenuWithoutPrintedContents =
    isCombo &&
    /^menu:\s*/i.test(sourceDescription) &&
    !/\b(sodavand|pomfrit|pommes|frites|nuggets|fries|dip)\b/i.test(
      sourceDescription,
    );

  const parsedSource = parseSourceComponents({
    name,
    ...(sourceDescription ? { description: sourceDescription } : {}),
    ...(!derivedMenuWithoutPrintedContents && sourceRawText
      ? { rawText: sourceRawText }
      : {}),
    existingIngredients: derivedMenuWithoutPrintedContents
      ? []
      : input.product.ingredients.map((i) => i.display),
  });

  const sourceIngredients = parsedSource.ingredients;
  const filtered = filterValidIngredients(sourceIngredients, name);

  let ingredients = filtered.list;
  // WP4: pre-resolution snapshot so the completeness trace can report the tier
  // that actually produced the ACCEPTED final value (never over-claim a prior
  // when the accepted ingredients remain the source list).
  const ingredientsBeforeResolution = [...ingredients];
  let ingredientOrigin: FieldProvenance["origin"] = "SOURCE";
  let description =
    (input.product.description ?? "").trim() ||
    DanishDescription(ingredients);

  // ---- Semantic Completeness Engine (V1) — WP4 ----------------------------
  // Requirement model + structural sufficiency judgement. These are used ONLY
  // to decide whether the EXISTING resolution mechanisms run, and to record an
  // explainability trace. They never invent values and never change the quality
  // gate (READY/REVIEW/BLOCKED) directly — that is a later work package (WP5).
  const requirements = getFieldRequirements(family, undefined);
  const initialIngredientStatus = assessIngredientSufficiency(
    family,
    undefined,
    ingredients,
    name,
  );
  const ingredientEvidence: SemanticProvenanceTier[] =
    ingredients.length > 0 ? ["SOURCE"] : [];
  let ingredientSelectedTier: SemanticProvenanceTier | undefined =
    ingredients.length > 0 ? "SOURCE" : undefined;

  const sourceAdditionsForTrace: Array<{ name: string; priceOre: number | null }> = [
    ...(input.existingAdditions ?? []).map((a) => ({
      name: a.name,
      priceOre: a.priceOre ?? null,
    })),
    ...input.product.addOns.map((a) => ({
      name: a.name,
      priceOre: a.price ?? null,
    })),
  ];
  const initialAdditionStatus = additionsSufficiencyStatus(
    family,
    toSourceCandidates(sourceAdditionsForTrace),
  );
  const additionEvidence: SemanticProvenanceTier[] =
    sourceAdditionsForTrace.length > 0 ? ["SOURCE"] : [];
  let additionSelectedTier: SemanticProvenanceTier | undefined;

  const kind = classifyProductKind({
    name,
    categoryNames: [input.categoryName],
    ...(input.product.description
      ? { description: input.product.description }
      : {}),
  });
  const burgerLike =
    kind === "sandwich_grill" ||
    isBurgerProductName(name) ||
    isGrillCategory(input.categoryName) ||
    family === "BURGER" ||
    family === "BACON_BURGER" ||
    family === "CHEESE_BURGER";
  const isWrap =
    family === "DURUM" ||
    family === "PITA" ||
    (/\b(durum|dürüm|pita)\b/i.test(name) && !isCombo);

  // WP4: drive the EXISTING grill resolution from the structural sufficiency
  // assessment (WP2) instead of the naive `ingredients.length < 2` heuristic.
  // INSUFFICIENT / PARTIAL / UNRESOLVED trigger resolution; SUFFICIENT /
  // NOT_APPLICABLE skip it (no resolution attempt is made).
  const ingredientNeedsResolution =
    initialIngredientStatus !== "SUFFICIENT" &&
    initialIngredientStatus !== "NOT_APPLICABLE";

  const needsFill =
    !isCombo &&
    !isWrap &&
    isFoodFamily(family) &&
    burgerLike &&
    (ingredients.length < 2 ||
      ingredientNeedsResolution ||
      !(input.product.description ?? "").trim());

  if (needsFill) {
    const resolved = resolveGrillIngredients({
      name,
      categoryName: input.categoryName,
      ...(input.product.description
        ? { description: input.product.description }
        : {}),
      ingredientPolicy: input.ingredientLikelihood ?? null,
    });
    ingredientEvidence.push(grillSourceTier(resolved.source));
    if (resolved.ingredients.length >= 2) {
      if (
        input.preserveLiveRichness &&
        ingredients.length >= resolved.ingredients.length &&
        !grillIngredientsInsufficient(ingredients, name)
      ) {
        // QA never-worse: keep richer live card
      } else {
        ingredientSelectedTier = grillSourceTier(resolved.source);
        ingredients = sanitizeIngredientList(resolved.ingredients);
        ingredientOrigin =
          resolved.source === "DOMAIN_PRIOR"
            ? "DOMAIN_PRIOR"
            : resolved.source === "NONE"
              ? "DERIVED"
              : "PEER_INFERENCE";
        for (const ing of ingredients) {
          provenanceList.push(
            provenance("ingredients", ing, ingredientOrigin, 0.75, {
              cohort: resolved.bucketId ?? family,
              reason: `resolveGrillIngredients:${resolved.source}`,
            }),
          );
        }
        description = DanishDescription(ingredients);
        provenanceList.push(
          provenance("description", description, "DERIVED", 0.85, {
            reason: "generated_from_final_ingredients",
          }),
        );
      }
    }
  }

  // WP4: re-assess the CURRENT list so name-encoded domain priors run only while
  // the card is still structurally insufficient for its family. The old
  // `< 2` gate is kept in the union so existing thin-list behavior is preserved
  // (no richness loss); the new structural trigger only ADDS attempts where a
  // length-2+ list is still below its family's evidence bar (e.g. sparse pizza).
  const ingredientStatusAfterGrill = assessIngredientSufficiency(
    family,
    undefined,
    ingredients,
    name,
  );
  const domainPriorNeeded =
    ingredientStatusAfterGrill !== "SUFFICIENT" &&
    ingredientStatusAfterGrill !== "NOT_APPLICABLE";

  if (
    !isCombo &&
    isFoodFamily(family) &&
    (ingredients.length < 2 || domainPriorNeeded)
  ) {
    const prior = inferDomainIngredientsFromName({
      name,
      categoryName: input.categoryName,
      family,
    });
    if (prior.length >= 2) {
      const merged = sanitizeIngredientList([...ingredients, ...prior], name);
      // WP4 improvement gate: when the card is a LENGTH-OK list (it was NOT
      // triggered by the legacy `length < 2` path), only accept the name-encoded
      // prior if it STRICTLY improves structural sufficiency. A generic
      // curry-family prior that adds basil without resolving the real missing
      // requirement (e.g. Massaman: potato+peanut+coconut milk, still
      // INSUFFICIENT afterwards) must not be forced in; the status is recorded in
      // the completeness trace for WP5 review instead. Thin-list (length < 2)
      // legacy behavior is preserved unconditionally.
      const triggeredByLength = ingredients.length < 2;
      const gatedByImprovement = !triggeredByLength;
      const mergedStatus = assessIngredientSufficiency(family, undefined, merged, name);
      const improves = sufficiencyRank(mergedStatus) > sufficiencyRank(ingredientStatusAfterGrill);
      if (gatedByImprovement && !improves) {
        // Do not fabricate completeness: leave the card as-is and let the
        // INSUFFICIENT/UNRESOLVED status surface via the trace.
        ingredientEvidence.push(grillSourceTier("DOMAIN_PRIOR"));
      } else {
        ingredients = merged;
        ingredientOrigin = "DOMAIN_PRIOR";
        ingredientEvidence.push("DOMAIN_PRIOR");
        ingredientSelectedTier = "DOMAIN_PRIOR";
        for (const ing of ingredients) {
          provenanceList.push(
            provenance("ingredients", ing, "DOMAIN_PRIOR", 0.7, {
              reason: "name_encoded_domain_prior",
            }),
          );
        }
        description = DanishDescription(ingredients);
        provenanceList.push(
          provenance("description", description, "DERIVED", 0.85, {
            reason: "generated_from_final_ingredients",
          }),
        );
      }
    } else if (ingredients.length === 1 && /\b(durum|pita)\b/i.test(name)) {
      const wrap = /\bdurum\b/i.test(name) ? "Durumbrød" : "Pitabrød";
      ingredients = sanitizeIngredientList([...ingredients, wrap], name);
      ingredientOrigin = "DOMAIN_PRIOR";
      description = DanishDescription(ingredients);
    } else if (ingredients.length >= 1) {
      provenanceList.push(...filtered.provenance);
      if (isFoodFamily(family)) {
        description = DanishDescription(ingredients);
        provenanceList.push(
          provenance("description", description, "DERIVED", 0.9, {
            reason: "generated_from_final_ingredients",
          }),
        );
      }
    }
  } else if (ingredients.length >= 1) {
    provenanceList.push(...filtered.provenance);
    // Always refresh description from final ingredients for food
    if (isFoodFamily(family) && !isCombo) {
      description = DanishDescription(ingredients);
      provenanceList.push(
        provenance("description", description, "DERIVED", 0.9, {
          reason: "generated_from_final_ingredients",
        }),
      );
    }
  }

  if (isCombo && ingredients.length >= 2) {
    description = DanishDescription(ingredients);
  }

  const variants = (input.product.variants ?? [])
    .filter((v) => !isForbiddenMenuVariantName(v.name))
    .map((v) => ({
      name: v.name,
      ...(v.sourceTotalPrice != null ? { priceOre: v.sourceTotalPrice } : {}),
      isBase: v.isBase,
    }));

  for (const v of input.product.variants ?? []) {
    if (isForbiddenMenuVariantName(v.name)) {
      provenanceList.push(
        provenance("variants", v.name, "DERIVED", 1, {
          reason: "MENU_IS_COMBO_NOT_VARIANT:stripped",
        }),
      );
    }
  }

  let additions = filterValidAdditions(
    [
      ...(input.existingAdditions ?? []),
      ...input.product.addOns.map((a) => ({
        name: a.name,
        ...(a.price != null ? { priceOre: a.price } : {}),
      })),
    ],
    family,
  );

  // WP4: the addition requirements matrix now gates the work. A family whose
  // `additions` requirement is FORBIDDEN (DRINK under DRINKS_NO_FOOD_EXTRAS) must
  // never even invoke the WP3 candidate pool — no food extras on a drink.
  // Families with additions NOT_APPLICABLE likewise skip pool invocation.
  // Tracked candidates carry REAL tiers so the completion trace never over-claims.
  let additionFinalCandidates: AdditionCandidate[] = [];
  const additionsForbidden =
    requirements.additions === "FORBIDDEN" ||
    requirements.additions === "NOT_APPLICABLE";

  if (additionsForbidden) {
    additions = [];
    additionFinalCandidates = [];
    // FORBIDDEN/NOT_APPLICABLE: no resolution was attempted, so the trace must
    // not claim any tier was inspected as candidate evidence.
    additionEvidence.length = 0;
    additionSelectedTier = undefined;
  } else if (burgerLike && !isCombo && !isWrap) {
    const dipCtx = {
      name,
      categoryName: input.categoryName,
      description,
      variants,
    };
    const dipWanted = productWantsGrillDips(dipCtx);
    if (dipWanted) {
      // WP3: never fabricate a 0 (free) price. Fall to the conservative
      // domain-prior price tier when a source addition lacks a price.
      const asPriced = additions.map((a) => ({
        name: a.name,
        priceOre: a.priceOre ?? defaultTilbehorPriceOre(a.name),
      }));
      additions = preferGrillDipAdditions(asPriced, dipCtx).map((a) => ({
        name: a.name,
        priceOre: a.priceOre,
      }));
      // Dips come from the authoritative restaurant dip set — a domain prior.
      additionEvidence.push("DOMAIN_PRIOR");
      additionSelectedTier = "DOMAIN_PRIOR";
      additionFinalCandidates = additions.map((a) => ({
        name: a.name,
        nameKey: normalizeAdditionName(a.name),
        priceOre: a.priceOre ?? null,
        tier: "DOMAIN_PRIOR" as const,
        priceSource: "DOMAIN_PRIOR" as const,
      }));
    } else {
      // Source additions are the authoritative tier; domain priors only fill the
      // gap when the resulting set is insufficient for the family.
      const domainPriors = preferBurgerEkstraAdditions([], dipCtx).map((a) => ({
        name: a.name,
        priceOre: a.priceOre,
      }));
      const poolContext = {
        productName: name,
        categoryName: input.categoryName,
        ...(description ? { description } : {}),
        family,
        kind,
        isCombo,
      };
      const pool = buildAdditionCandidatePool({
        ...poolContext,
        sourceAdditions: additions.map((a) => ({
          name: a.name,
          priceOre: a.priceOre ?? null,
        })),
        domainPriorAdditions: domainPriors,
      });
      // Reuse the pool's REAL tier data as trace evidence (no invention).
      additionEvidence.push(...pool.map((c) => c.tier));
      const { selected } = resolveAdditionCandidates(pool, poolContext);
      if (selected.length > 0) {
        const first = selected[0]!;
        additionSelectedTier = selected.reduce(
          (best, c) =>
            additionTierRank(c.tier) > additionTierRank(best) ? c.tier : best,
          first.tier,
        );
      }
      additionFinalCandidates = selected;
      additions = selected.map((c) => {
        // WP3: resolve price through the shared tier order (peer → domain prior →
        // UNRESOLVED) instead of defaulting to 0. Never fabricate a free price.
        const priceOre =
          c.priceOre ??
          resolveAdditionPrice({
            name: c.name,
            domainPriorPriceOre: defaultTilbehorPriceOre(c.name),
          }).priceOre;
        return {
          name: c.name,
          ...(priceOre != null ? { priceOre } : {}),
          ...(c.tier === "DOMAIN_PRIOR"
            ? {
                priceProvenance: provenance(
                  "addition.price",
                  String(priceOre),
                  "DOMAIN_PRIOR",
                  0.55,
                  { reason: "burger_ekstra_fallback" },
                ),
              }
            : {}),
        };
      });
    }
  } else {
    // No resolution path ran; the final set is the filtered source evidence.
    additionFinalCandidates = toSourceCandidates(
      additions.map((a) => ({ name: a.name, priceOre: a.priceOre ?? null })),
    );
  }

  // WP3: sanitize requires a concrete price, and it reprices via the authorized
  // domain-prior tier (repriceTilbehorList). Supply that tier here rather than a
  // fabricated 0 (free) price so nothing downstream sees a bogus zero.
  additions = sanitizeAdditionList(
    additions.map((a) => ({
      name: a.name,
      priceOre: a.priceOre ?? defaultTilbehorPriceOre(a.name),
    })),
    name,
    input.categoryName,
  ).map((a) => ({
    name: a.name,
    priceOre: a.priceOre,
  }));

  const existingChoices = (input.product.productChoices ?? []).map((pc) => ({
    prompt: pc.prompt,
    options: pc.options.map((o) => o.label ?? o.productSourceId),
  }));
  const productChoices =
    existingChoices.length > 0 ? existingChoices : parsedSource.productChoices;

  // ---- Semantic Completeness Engine (V1) — WP4 explainability ---------------
  // Additive per-field traces for the two most developed resolution paths. They
  // never invent evidence: every tier listed came from an actual resolution
  // attempt (ingredients) or the real candidate pool (additions). This is NOT a
  // quality gate — READY/REVIEW/BLOCKED is decided by qualityContract (WP5).
  const finalIngredientStatus = assessIngredientSufficiency(
    family,
    undefined,
    ingredients,
    name,
  );
  const finalAdditionStatus = additionsSufficiencyStatus(
    family,
    additionFinalCandidates,
  );
  // Honesty guard: only claim a prior tier as `selectedTier` when the accepted
  // list actually differs from the pre-resolution source list. If resolution ran
  // but the source list won (e.g. richer live card preserved), the accepted tier
  // is SOURCE, not the prior we merely inspected.
  const ingredientsChangedByResolution =
    ingredients.length !== ingredientsBeforeResolution.length ||
    ingredients.some((v, i) => v !== ingredientsBeforeResolution[i]);
  const effectiveIngredientTier: SemanticProvenanceTier | undefined =
    ingredientsChangedByResolution
      ? ingredientSelectedTier
      : ingredients.length > 0
        ? "SOURCE"
        : undefined;
  const completenessTraces: FieldCompletenessTrace[] = [
    buildCompletenessTrace({
      field: "ingredients",
      requirementLevel: requirements.ingredients,
      initialStatus: initialIngredientStatus,
      finalStatus: finalIngredientStatus,
      evidenceConsidered: ingredientEvidence,
      ...(effectiveIngredientTier !== undefined
        ? { selectedTier: effectiveIngredientTier }
        : {}),
      ...(ingredients.length > 0 ? { selectedValue: ingredients } : {}),
    }),
    buildCompletenessTrace({
      field: "additions",
      requirementLevel: requirements.additions,
      initialStatus: initialAdditionStatus,
      finalStatus: finalAdditionStatus,
      evidenceConsidered: additionEvidence,
      ...(additionSelectedTier !== undefined
        ? { selectedTier: additionSelectedTier }
        : {}),
      ...(additions.length > 0 ? { selectedValue: additions.map((a) => a.name) } : {}),
    }),
  ];

  return {
    name,
    categoryName: input.categoryName,
    description,
    ingredients,
    variants,
    productChoices,
    comboComponents: isCombo ? ingredients : [],
    additions,
    prices: variants
      .filter((v) => v.priceOre != null)
      .map((v) => ({ label: v.name, priceOre: v.priceOre! })),
    productFamily: family,
    isCombo,
    provenance: provenanceList,
    policyTrace: {
      constitution: "MenuConstitutionV1",
      productFamily: family,
      ingredientOrigin,
      menuAsVariant: "SUPERSEDED→MENU_IS_COMBO_NOT_VARIANT",
      drinksNoFoodExtras: family === "DRINK",
      categoryQualifiedProductName: qualified.trace,
    },
    completenessTraces,
  };
}

/**
 * Apply completeProductCard across an entire canonical menu (shared Create+QA).
 */
export function completeCanonicalMenuCards(input: {
  menu: CanonicalMenu;
  ingredientLikelihood?: IngredientLikelihoodPolicy | null;
  preserveLiveRichness?: boolean;
}): {
  menu: CanonicalMenu;
  traces: CompletedProductCard[];
} {
  const traces: CompletedProductCard[] = [];
  const categories = input.menu.categories.map((cat) => {
    const products = cat.products.map((p) => {
      const card = completeProductCard({
        product: p,
        categoryName: cat.name,
        ingredientLikelihood: input.ingredientLikelihood ?? null,
        ...(input.preserveLiveRichness != null
          ? { preserveLiveRichness: input.preserveLiveRichness }
          : {}),
      });
      traces.push(card);
      return {
        ...p,
        name: card.name,
        description: card.description || undefined,
        ingredients: card.ingredients.map((display) => ({
          display,
          origin:
            card.policyTrace.ingredientOrigin === "SOURCE"
              ? ("SOURCE" as const)
              : card.policyTrace.ingredientOrigin === "PEER_INFERENCE"
                ? ("DERIVED" as const)
                : ("SYSTEM_DEFAULT" as const),
        })),
        variants: p.variants.filter((v) => !isForbiddenMenuVariantName(v.name)),
        addOns: card.additions.map((a, i) => ({
          sourceId: `${p.sourceId}:add:${i}`,
          name: a.name,
          ...(a.priceOre != null ? { price: a.priceOre } : {}),
          origin: "DERIVED" as const,
        })),
        productChoices:
          card.productChoices.length > 0
            ? card.productChoices.map((pc, i) => ({
                sourceId: `${p.sourceId}:choice:${i}`,
                prompt: pc.prompt,
                options: pc.options.map((label, j) => ({
                  productSourceId: `${p.sourceId}:choice:${i}:opt:${j}`,
                  label,
                })),
              }))
            : p.productChoices,
        isCombo: card.isCombo,
      };
    });
    return { ...cat, products };
  });

  return {
    menu: { ...input.menu, categories },
    traces,
  };
}
