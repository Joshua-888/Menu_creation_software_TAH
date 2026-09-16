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
} from "../domain/grillCardFill.js";
import {
  formatDescriptionFromIngredients,
  formatProductName,
} from "../domain/textNormalize.js";
import {
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
import { inferProductFamily, isFoodFamily } from "./peerCohorts.js";
import { applyCategoryQualifiedProductName } from "./categoryQualifiedProductName.js";
import type {
  CompletedProductCard,
  FieldProvenance,
  ProductFamily,
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
  for (const token of sanitizeIngredientList(raw)) {
    // Combo placeholder / meta never count as food ingredients
    if (/^menu\s*:/i.test(token) || /^(tilbehør|menu|valgfri)/i.test(token.trim())) {
      continue;
    }
    const cls = classifyPhrase(token, { layoutRole: "ingredient_line" });
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
    /pizza|calzone|ufo|indbagt|bambino/i.test(name) ||
    /pizza|calzone|ufo|indbagt/i.test(input.categoryName)
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
    if (/calzone|indbagt/i.test(name) || input.family === "CALZONE") {
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

  const sourceIngredients = input.product.ingredients.map((i) => i.display);
  const filtered = filterValidIngredients(sourceIngredients, name);

  let ingredients = filtered.list;
  let ingredientOrigin: FieldProvenance["origin"] = "SOURCE";
  let description =
    (input.product.description ?? "").trim() ||
    DanishDescription(ingredients);

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

  const needsFill =
    isFoodFamily(family) &&
    burgerLike &&
    (ingredients.length < 2 ||
      grillIngredientsInsufficient(ingredients, name) ||
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
    if (resolved.ingredients.length >= 2) {
      if (
        input.preserveLiveRichness &&
        ingredients.length >= resolved.ingredients.length &&
        !grillIngredientsInsufficient(ingredients, name)
      ) {
        // QA never-worse: keep richer live card
      } else {
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
  } else if (
    isFoodFamily(family) &&
    family !== "COMBO_MENU" &&
    ingredients.length < 2
  ) {
    const prior = inferDomainIngredientsFromName({
      name,
      categoryName: input.categoryName,
      family,
    });
    if (prior.length >= 2) {
      ingredients = sanitizeIngredientList(prior);
      ingredientOrigin = "DOMAIN_PRIOR";
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
    if (isFoodFamily(family) && family !== "COMBO_MENU") {
      description = DanishDescription(ingredients);
      provenanceList.push(
        provenance("description", description, "DERIVED", 0.9, {
          reason: "generated_from_final_ingredients",
        }),
      );
    }
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

  // Burger ekstra / grill dips via shared helpers (not merchant-specific)
  if (family === "DRINK") {
    additions = [];
  } else if (burgerLike) {
    const dipCtx = {
      name,
      categoryName: input.categoryName,
      description,
      variants,
    };
    const dipWanted = productWantsGrillDips(dipCtx);
    const asPriced = additions.map((a) => ({
      name: a.name,
      priceOre: a.priceOre ?? 1000,
    }));
    if (dipWanted) {
      additions = preferGrillDipAdditions(asPriced, dipCtx).map((a) => ({
        name: a.name,
        priceOre: a.priceOre,
      }));
    } else if (additions.length === 0) {
      additions = preferBurgerEkstraAdditions([], dipCtx).map((a) => ({
        name: a.name,
        priceOre: a.priceOre,
        priceProvenance: provenance(
          "addition.price",
          String(a.priceOre),
          "DOMAIN_PRIOR",
          0.55,
          { reason: "burger_ekstra_fallback" },
        ),
      }));
    }
  }

  additions = sanitizeAdditionList(
    additions.map((a) => ({
      name: a.name,
      priceOre: a.priceOre ?? 0,
    })),
    name,
    input.categoryName,
  ).map((a) => ({
    name: a.name,
    priceOre: a.priceOre,
  }));

  const isCombo =
    input.product.isCombo ||
    family === "COMBO_MENU" ||
    /\bmenu\b/i.test(name);

  return {
    name,
    categoryName: input.categoryName,
    description,
    ingredients,
    variants,
    productChoices: (input.product.productChoices ?? []).map((pc) => ({
      prompt: pc.prompt,
      options: pc.options.map((o) => o.label ?? o.productSourceId),
    })),
    comboComponents: isCombo ? [] : [],
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
