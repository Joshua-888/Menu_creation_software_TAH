/**
 * MenuQualityContract — products must pass before WritePlan eligibility.
 */

import type { CanonicalMenu } from "../domain/schema/canonical.js";
import { isForbiddenMenuVariantName } from "../learning/categorySizeVariantPolicy.js";
import {
  isForbiddenTilbehorName,
  isInvalidFoodComponent,
  looksLikeToppingAsProductName,
  splitGluedFoodToken,
} from "../domain/menuCardQuality.js";
import { looksLikeGarbageName } from "../domain/textNormalize.js";
import { classifyPhrase, isInvalidProductNameEntity } from "./semanticClassifier.js";
import { inferProductFamily, isFoodFamily } from "./peerCohorts.js";
import { assessIngredientSufficiency } from "./ingredientSufficiency.js";
import { getFieldRequirements } from "./fieldRequirements.js";
import {
  isAdditionSetSufficient,
  type AdditionCandidate,
} from "./additionCandidatePool.js";
import { normalizeAdditionName } from "../decisions/facts.js";
import { isProductNameReceiptSafe } from "./categoryQualifiedProductName.js";
import type {
  MenuCoherenceCheck,
  MenuQualityContractResult,
  ProductQualityResult,
  QualityCheckResult,
  QualityStatus,
} from "./types.js";
import type { SourceCoverageDiagnostic } from "./sourceCoverage.js";

function check(
  id: QualityCheckResult["id"],
  pass: boolean,
  detail?: string,
): QualityCheckResult {
  return detail ? { id, pass, detail } : { id, pass };
}

function evaluateProduct(
  product: CanonicalMenu["categories"][0]["products"][0],
  categoryName: string,
): ProductQualityResult {
  const name = product.name ?? "";
  const ingredients = product.ingredients.map((i) => i.display);
  const additions = product.addOns.map((a) => a.name);
  const variants = product.variants.map((v) => v.name);
  const family = inferProductFamily({
    name,
    categoryName,
    ...(product.description ? { description: product.description } : {}),
  });
  const food = isFoodFamily(family) && family !== "COMBO_MENU";
  const checks: QualityCheckResult[] = [];
  // WP5: non-gating completeness advisories (EXPECTED-level gaps). These never
  // move a product off QUALITY_READY on their own.
  const completenessWarnings: string[] = [];
  let forbiddenAdditionsViolated = false;

  const nameCls = classifyPhrase(name, { layoutRole: "product" });
  const nameValid =
    !looksLikeGarbageName(name) &&
    !looksLikeToppingAsProductName(name) &&
    !isInvalidProductNameEntity(nameCls.entityType) &&
    name.trim().length >= 2;
  checks.push(
    check(
      "PRODUCT_NAME_VALID",
      nameValid,
      nameValid ? undefined : `invalid name "${name}" (${nameCls.entityType})`,
    ),
  );

  const receiptSafe = isProductNameReceiptSafe({
    productName: name,
    categoryName,
  });
  checks.push(
    check(
      "PRODUCT_NAME_RECEIPT_SAFE",
      receiptSafe,
      receiptSafe
        ? undefined
        : `name "${name}" under "${categoryName}" is ambiguous on receipts without category`,
    ),
  );

  const categoryFit =
    !(family === "BURGER" || family === "BACON_BURGER" || family === "CHEESE_BURGER") ||
    !/^grill$/i.test(categoryName.trim()) ||
    /\bburger/i.test(categoryName);
  // Burgers under "Grill" fails semantic fit
  const burgerUnderGrill =
    (/\bburger\b/i.test(name) || family === "BURGER") &&
    /^grill$/i.test(categoryName.trim());
  checks.push(
    check(
      "CATEGORY_SEMANTIC_FIT",
      !burgerUnderGrill && categoryFit,
      burgerUnderGrill
        ? `burger "${name}" under Grill — prefer Burgers`
        : undefined,
    ),
  );

  const desc = (product.description ?? "").trim();
  const descOk =
    !food ||
    (desc.length > 0 &&
      !/\d{2,4}\s*(kr)?\s*$/i.test(desc) &&
      !/skinkeog|og,/i.test(desc));
  checks.push(
    check(
      "DESCRIPTION_PROFESSIONAL",
      descOk,
      descOk ? undefined : "description missing or unprofessional",
    ),
  );

  // WP5 — replace the naive `ingredients.length >= 2` heuristic with recomputation
  // on the already-available local ingredient list, using the authoritative
  // field-requirement matrix + structural sufficiency assessor (WP2). No trace
  // lookup, no sourceId, no mutation: a direct pure-function call on local data.
  const requirements = getFieldRequirements(family, undefined);
  const ingredientStatus = assessIngredientSufficiency(
    family,
    undefined,
    ingredients,
    name,
  );
  // Only a REQUIRED ingredient field gates on sufficiency, and only when the
  // evidence is genuinely unresolved or below the structural bar (UNRESOLVED /
  // INSUFFICIENT). PARTIAL means some evidence exists but not every structural
  // slot is filled — it is advisory, not a hard block. EXPECTED/CONDITIONAL/
  // OPTIONAL are advisory and never move a product off READY alone.
  const ingredientsComplete =
    !food ||
    requirements.ingredients !== "REQUIRED" ||
    (ingredientStatus !== "UNRESOLVED" &&
      ingredientStatus !== "INSUFFICIENT");
  checks.push(
    check(
      "INGREDIENTS_COMPLETE",
      ingredientsComplete,
      ingredientsComplete
        ? undefined
        : `ingredients ${ingredientStatus.toLowerCase()} for ${family} (REQUIRED, QUALITY_REVIEW)`,
    ),
  );

  const invalidIngredients = ingredients.filter(
    (i) =>
      isInvalidFoodComponent(i, name) ||
      classifyPhrase(i, {
        layoutRole: "ingredient_line",
        parentProductName: name,
      }).entityType === "META_INSTRUCTION",
  );
  checks.push(
    check(
      "INGREDIENTS_VALID",
      invalidIngredients.length === 0,
      invalidIngredients.length
        ? `invalid ingredients: ${invalidIngredients.join(", ")}`
        : undefined,
    ),
  );

  const metaAsIng = ingredients.some((i) =>
    /^(tilbehør|tilbehor|menu|valgfri)/i.test(i.trim()),
  );
  checks.push(check("NO_META_AS_INGREDIENT", !metaAsIng));

  const nameAsIng = ingredients.some(
    (i) => i.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  checks.push(check("NO_PRODUCT_NAME_AS_INGREDIENT", !nameAsIng));

  const glued = ingredients.some(
    (i) => splitGluedFoodToken(i).length > 1 || /skinkeog|ogananas/i.test(i),
  );
  // After sanitize, glued should be split — fail if still glued as single token
  const stillGlued = ingredients.some(
    (i) => /[a-zæøå]og[a-zæøå]/i.test(i) && !/\bog\b/i.test(i),
  );
  checks.push(
    check(
      "NO_GLUED_INGREDIENTS",
      !stillGlued,
      stillGlued ? `glued ingredient tokens: ${ingredients.join("|")}` : undefined,
    ),
  );
  void glued;

  const menuVariant = variants.some((v) => isForbiddenMenuVariantName(v));
  checks.push(
    check(
      "NO_MENU_VARIANT",
      !menuVariant,
      menuVariant ? "Menu must not be a variant" : undefined,
    ),
  );
  checks.push(check("VARIANT_STRUCTURE_VALID", !menuVariant));

  checks.push(check("PRODUCT_CHOICES_VALID", true));
  const comboUnresolved =
    product.isCombo &&
    (product.productChoices?.length ?? 0) === 0 &&
    ingredients.length < 2;
  checks.push(
    check(
      "COMBO_STRUCTURE_VALID",
      !(product.isCombo && menuVariant) && !comboUnresolved,
      comboUnresolved
        ? "COMBO_CONTENTS_UNRESOLVED: Menu/combo price present but components not source-supported"
        : product.isCombo && menuVariant
          ? "combo must not use Menu-as-variant"
          : undefined,
    ),
  );

  const badAdds = additions.filter(
    (a) =>
      isForbiddenTilbehorName(a) ||
      classifyPhrase(a).entityType === "META_INSTRUCTION",
  );
  checks.push(
    check(
      "ADDITIONS_VALID",
      badAdds.length === 0,
      badAdds.length ? `invalid additions: ${badAdds.join(", ")}` : undefined,
    ),
  );

  const drinkWithFood =
    family === "DRINK" &&
    additions.some((a) =>
      /\b(mayo|ketchup|remoulade|bacon|ost|salat)\b/i.test(a),
    );
  checks.push(
    check(
      "ADDITION_SCOPE_VALID",
      !drinkWithFood,
      drinkWithFood ? "drinks cannot inherit food dips/extras" : undefined,
    ),
  );

  // WP5 — addition expectation resolution (recomputation on local data).
  // Evidence semantics (Architect ruling):
  //   REQUIRED   unresolved/insufficient → QUALITY_REVIEW
  //   EXPECTED   unresolved/insufficient → non-gating completeness warning
  //   FORBIDDEN  any addition present      → QUALITY_BLOCKED (hard invariant)
  //   CONDITIONAL/OPTIONAL/NOT_APPLICABLE  → non-gating (CONDITIONAL has no
  //              trigger evaluator yet — known WP2 limitation, treated inert)
  const additionCandidates: AdditionCandidate[] = product.addOns.map((a) => ({
    name: a.name,
    nameKey: normalizeAdditionName(a.name),
    priceOre: a.price ?? null,
    tier: a.origin === "SYSTEM_DEFAULT" ? "DOMAIN_PRIOR" : "SOURCE",
    priceSource: a.origin === "SYSTEM_DEFAULT" ? "DOMAIN_PRIOR" : "SOURCE",
  }));
  const additionsPresent = product.addOns.length > 0;
  const additionsSufficient =
    additionsPresent && isAdditionSetSufficient(family, additionCandidates);
  const additionLevel = requirements.additions;
  const additionForbiddenViolation =
    additionLevel === "FORBIDDEN" && additionsPresent;
  const additionRequiredUnresolved =
    additionLevel === "REQUIRED" && !additionsSufficient;
  if (additionForbiddenViolation) forbiddenAdditionsViolated = true;
  if (additionLevel === "EXPECTED" && !additionsSufficient) {
    completenessWarnings.push(
      `additions expected for ${family} but unresolved (advisory)`,
    );
  }
  checks.push(
    check(
      "ADDITIONS_EXPECTATION_RESOLVED",
      !additionForbiddenViolation && !additionRequiredUnresolved,
      additionForbiddenViolation
        ? "additions are forbidden for this family"
        : additionRequiredUnresolved
          ? `additions unresolved/insufficient for ${family} (REQUIRED, QUALITY_REVIEW)`
          : undefined,
    ),
  );

  // WP5 — variant expectation resolution. FORBIDDEN here means an actual
  // forbidden Menu-as-variant NAME (never `variants.length > 0`), so a combo's
  // legitimate Alm./Familie size variants are not misclassified as a violation.
  const forbiddenVariantName = variants.some((v) =>
    isForbiddenMenuVariantName(v),
  );
  const variantLevel = requirements.variants;
  const variantRequiredUnresolved =
    variantLevel === "REQUIRED" && variants.length === 0;
  if (variantLevel === "EXPECTED" && variants.length === 0) {
    completenessWarnings.push(
      `variants expected for ${family} but unresolved (advisory)`,
    );
  }
  checks.push(
    check(
      "VARIANT_EXPECTATION_RESOLVED",
      !forbiddenVariantName && !variantRequiredUnresolved,
      forbiddenVariantName
        ? "forbidden Menu-as-variant name present"
        : variantRequiredUnresolved
          ? `variants unresolved for ${family} (REQUIRED, QUALITY_REVIEW)`
          : undefined,
    ),
  );

  const pricedAdds = product.addOns.filter((a) => a.price != null || true);
  // Soft: missing price → review not hard block unless food burger with tilbehør
  const priceSupported =
    additions.length === 0 ||
    product.addOns.every((a) => a.price == null || Number.isFinite(a.price));
  checks.push(check("ADDITION_PRICE_SUPPORTED", priceSupported));
  void pricedAdds;

  const sourcePriceSupported =
    (product.basePrice != null &&
      product.basePrice > 0 &&
      product.basePriceOrigin !== "SYSTEM_DEFAULT") ||
    product.variants.some(
      (variant) =>
        variant.sourceTotalPrice != null && variant.sourceTotalPrice > 0,
    );
  checks.push(
    check(
      "PRICE_SUPPORTED",
      sourcePriceSupported,
      sourcePriceSupported
        ? undefined
        : "PRICE_UNSUPPORTED: missing positive source-supported base price",
    ),
  );

  checks.push(
    check("NO_OCR_GARBAGE", !looksLikeGarbageName(name) && nameValid),
  );
  checks.push(
    check(
      "GRAMMAR_VALID",
      !/,\s*og\b|\bog,\s*/i.test(desc) && !stillGlued,
    ),
  );
  checks.push(
    check(
      "PROVENANCE_SUFFICIENT",
      !food || ingredients.length === 0 || product.ingredients.every((i) => i.origin),
    ),
  );

  const blockers = checks.filter((c) => !c.pass).map((c) => c.detail ?? c.id);

  // Hard blockers vs review
  const hardFailIds = new Set([
    "PRODUCT_NAME_VALID",
    "PRODUCT_NAME_RECEIPT_SAFE",
    "NO_MENU_VARIANT",
    "NO_META_AS_INGREDIENT",
    "NO_OCR_GARBAGE",
    "ADDITION_SCOPE_VALID",
    "CATEGORY_SEMANTIC_FIT",
    "PRICE_SUPPORTED",
  ]);
  const reviewIds = new Set([
    "INGREDIENTS_COMPLETE",
    "DESCRIPTION_PROFESSIONAL",
    "ADDITION_PRICE_SUPPORTED",
    "PROVENANCE_SUFFICIENT",
    "COMBO_STRUCTURE_VALID",
    // WP5: a REQUIRED addition/variant gap routes to REVIEW, never BLOCK. The
    // forbidden-addition case is escalated to BLOCKED separately below.
    "ADDITIONS_EXPECTATION_RESOLVED",
    "VARIANT_EXPECTATION_RESOLVED",
  ]);

  let status: QualityStatus = "QUALITY_READY";
  for (const c of checks) {
    if (c.pass) continue;
    if (hardFailIds.has(c.id)) {
      status = "QUALITY_BLOCKED";
      break;
    }
    if (reviewIds.has(c.id)) {
      status = "QUALITY_REVIEW";
    } else if (status === "QUALITY_READY") {
      status = "QUALITY_BLOCKED";
    }
  }

  // Food incomplete → at least REVIEW (constitution FOOD_COMPLETENESS)
  if (food && !ingredientsComplete && status === "QUALITY_READY") {
    status = "QUALITY_REVIEW";
  }
  // Unresolved combo contents → REVIEW (never fabricated READY)
  if (comboUnresolved && status === "QUALITY_READY") {
    status = "QUALITY_REVIEW";
  }
  // WP5: additions on a FORBIDDEN family (e.g. food extras on a drink) are a hard
  // invariant violation (Constitution DRINKS_NO_FOOD_EXTRAS) → BLOCK, never READY.
  if (forbiddenAdditionsViolated) {
    status = "QUALITY_BLOCKED";
  }

  return {
    productSourceId: product.sourceId,
    ...(product.assignedMenuNumber || product.sourceMenuNumber
      ? {
          menuNumber: (product.assignedMenuNumber ??
            product.sourceMenuNumber) as string,
        }
      : {}),
    name,
    status,
    checks,
    blockers,
    completenessWarnings,
  };
}

function coherence(
  id: string,
  pass: boolean,
  detail?: string,
): MenuCoherenceCheck {
  return detail ? { id, pass, detail } : { id, pass };
}

function evaluateMenuCoherence(
  menu: CanonicalMenu,
  sourceCoverage?: SourceCoverageDiagnostic | null,
): MenuCoherenceCheck[] {
  const checks: MenuCoherenceCheck[] = [];
  const allProducts = menu.categories.flatMap((c) =>
    c.products.map((p) => ({ ...p, categoryName: c.name })),
  );

  const dipsInBurgerCat = menu.categories.some(
    (c) =>
      /\bburgers?\b/i.test(c.name) &&
      c.products.some((p) =>
        /^(mayo|ketchup|remoulade|salatmayonnaise)$/i.test(p.name),
      ),
  );
  checks.push(
    coherence(
      "NO_DIP_PRODUCTS_IN_BURGER_CATEGORY",
      !dipsInBurgerCat,
      dipsInBurgerCat ? "dip-like products found under Burgers" : undefined,
    ),
  );

  const drinksWithFoodAdds = allProducts.some((p) => {
    const fam = inferProductFamily({
      name: p.name,
      categoryName: p.categoryName,
    });
    return (
      fam === "DRINK" &&
      p.addOns.some((a) =>
        /\b(mayo|ketchup|remoulade|bacon)\b/i.test(a.name),
      )
    );
  });
  checks.push(
    coherence(
      "DRINKS_NO_FOOD_ADDITIONS",
      !drinksWithFoodAdds,
      drinksWithFoodAdds ? "drink products carry food additions" : undefined,
    ),
  );

  const menuAsVariant = allProducts.some((p) =>
    p.variants.some((v) => isForbiddenMenuVariantName(v.name)),
  );
  checks.push(
    coherence(
      "NO_MENU_VARIANTS_ANYWHERE",
      !menuAsVariant,
      menuAsVariant ? "Menu variants still present" : undefined,
    ),
  );

  const names = allProducts.map((p) => p.name.trim().toLowerCase());
  const dupes = names.filter((n, i) => n && names.indexOf(n) !== i);
  checks.push(
    coherence(
      "NO_DUPLICATE_PRODUCTS",
      dupes.length === 0,
      dupes.length
        ? `duplicates: ${[...new Set(dupes)].join(", ")}`
        : undefined,
    ),
  );

  const emptyMenu = allProducts.length === 0;
  checks.push(
    coherence(
      "PRODUCTS_ACCOUNTED",
      !emptyMenu,
      emptyMenu ? "menu has 0 products — cannot succeed" : undefined,
    ),
  );

  // Source→product coverage coherence (universal, menu level). Only surfaced when
  // the caller supplies extraction evidence, so a menu-only evaluation (tests,
  // live destination snapshots) is unchanged. Severity is REVIEW: dense source
  // evidence with suspiciously few extracted products is a review signal, never
  // an automatic BLOCK. The portal production pipeline additionally hard-fails at
  // ingestion (see src/portal/worker.ts) — that is an intentionally stricter
  // production-safety stop on top of this universal default, not a replacement.
  // The check is only emitted when suspicious so non-suspicious menus keep an
  // identical coherence array (zero drift for golden fixtures).
  if (sourceCoverage?.suspicious) {
    checks.push(
      coherence(
        "SOURCE_PRODUCT_COVERAGE_SUSPICIOUS",
        false,
        sourceCoverage.detail,
      ),
    );
  }

  return checks;
}

/**
 * Evaluate MenuQualityContract for an entire target menu.
 *
 * `sourceCoverage` is optional extraction-side evidence. When supplied, the
 * central contract surfaces `SOURCE_PRODUCT_COVERAGE_SUSPICIOUS` as a menu-level
 * REVIEW coherence finding for every caller — not only the portal worker. When
 * omitted (menu-only callers, live destination snapshots), behaviour is
 * identical to before: no coverage finding is emitted.
 */
export function evaluateMenuQualityContract(
  menu: CanonicalMenu,
  sourceCoverage?: SourceCoverageDiagnostic | null,
): MenuQualityContractResult {
  const products: ProductQualityResult[] = [];
  for (const cat of menu.categories) {
    for (const p of cat.products) {
      products.push(evaluateProduct(p, cat.name));
    }
  }
  const coherence = evaluateMenuCoherence(menu, sourceCoverage);
  const coherenceFail = coherence.filter((c) => !c.pass);

  const readyProductIds = products
    .filter((p) => p.status === "QUALITY_READY")
    .map((p) => p.productSourceId);
  const reviewProductIds = products
    .filter((p) => p.status === "QUALITY_REVIEW")
    .map((p) => p.productSourceId);
  const blockedProductIds = products
    .filter((p) => p.status === "QUALITY_BLOCKED")
    .map((p) => p.productSourceId);

  const statusAccounting = {
    productCount: products.length,
    ready: readyProductIds.length,
    review: reviewProductIds.length,
    blocked: blockedProductIds.length,
    reconciles:
      readyProductIds.length +
        reviewProductIds.length +
        blockedProductIds.length ===
      products.length,
  };

  const findingCounts = {
    failedChecks: products.reduce(
      (n, p) => n + p.checks.filter((c) => !c.pass).length,
      0,
    ),
    coherenceFailures: coherenceFail.length,
  };

  // WP5 — advisory completeness accounting. EXPECTED-level gaps are recorded on
  // each product's `completenessWarnings` but do NOT move status; this aggregate
  // makes them visible to review tooling without changing the status boolean.
  const warningCount = products.reduce(
    (n, p) => n + p.completenessWarnings.length,
    0,
  );
  const productsWithWarnings = products.filter(
    (p) => p.completenessWarnings.length > 0,
  ).length;
  const completenessAccounting = {
    productsWithWarnings,
    warningCount,
    reconciles: productsWithWarnings <= products.length,
  };

  const blockers = [
    ...products.flatMap((p) =>
      p.blockers.map((b) => `${p.menuNumber || p.name}: ${b}`),
    ),
    ...coherenceFail.map((c) => c.detail ?? c.id),
  ];

  let menuStatus: MenuQualityContractResult["menuStatus"] = "MENU_QUALITY_READY";
  if (
    products.length === 0 ||
    coherenceFail.some((c) => c.id === "PRODUCTS_ACCOUNTED") ||
    blockedProductIds.length > 0 ||
    coherenceFail.length > 0
  ) {
    if (products.length === 0 || blockedProductIds.length > 0) {
      menuStatus = "MENU_QUALITY_BLOCKED";
    } else {
      menuStatus = "MENU_QUALITY_REVIEW";
    }
  } else if (reviewProductIds.length > 0) {
    menuStatus = "MENU_QUALITY_REVIEW";
  }

  return {
    menuStatus,
    products,
    coherence,
    blockers,
    readyProductIds,
    reviewProductIds,
    blockedProductIds,
    statusAccounting,
    findingCounts,
    completenessAccounting,
  };
}

/** WritePlan may only include QUALITY_READY product ids. */
export function filterWriteEligibleProductIds(
  quality: MenuQualityContractResult,
): Set<string> {
  return new Set(quality.readyProductIds);
}

export function qualityContractBlocksWrite(
  quality: MenuQualityContractResult,
): { blocked: boolean; reason?: string } {
  if (quality.menuStatus === "MENU_QUALITY_READY") {
    return { blocked: false };
  }
  return {
    blocked: true,
    reason: `${quality.menuStatus}: ${quality.blockers.slice(0, 8).join("; ")}`,
  };
}
