/**
 * Display-text hygiene for menu labels and ingredients.
 * Learned operator rules: capitalize first letter; strip OCR price bleed;
 * never leave ingredient lists in the product name.
 */

import {
  getLearnedOcrIngredientFixes,
  type OcrIngredientFix,
} from "./learnedTextFixes.js";
import {
  cleanDishDisplayName,
  dishNameHasIngredientDump,
  isInvalidFoodComponent,
  looksLikeToppingAsProductName,
  polishDescriptionText,
  sanitizeIngredientList,
  splitGluedFoodToken,
} from "./menuCardQuality.js";

const BASE_OCR_INGREDIENT_FIXES: OcrIngredientFix[] = [
  [/\blog\b/gi, "løg"],
  [/\bkodsovs\b/gi, "kødsovs"],
  [/\bkoodstrimler\b/gi, "kødstrimler"],
  [/\bkodstrimler\b/gi, "kødstrimler"],
  [/\b0g\b/gi, "og"],
  [/\bpolse\b/gi, "pølse"],
  [/\brodløg\b/gi, "rødløg"],
  [/\baiche\b/gi, ""],
  [/\bt\s*ahin\b/gi, "tahin"],
];

export type LabelQualitySeverity = "PASS" | "REPAIR" | "REVIEW" | "BLOCK";

export type LabelRepair = {
  field: "name" | "description" | "ingredient";
  from: string;
  to: string;
  reason: string;
};

export type LabelQualityAssessment = {
  severity: LabelQualitySeverity;
  reasons: string[];
  repairs: LabelRepair[];
  /** Values after deterministic auto-repair (may still need REVIEW). */
  repaired: {
    name: string;
    description: string;
    ingredients: string[];
  };
};

export type LabelQualityInput = {
  name: string;
  description?: string;
  ingredients?: readonly string[];
};

/** Strip trailing price fragments like "dressing 95" or "salat 180". */
export function stripTrailingPriceNoise(text: string): string {
  return text
    .replace(/\s+\d{2,4}\s*,?\s*$/g, "")
    .replace(/\s+\d{2,4}\s*(kr\.?)?\s*$/gi, "")
    .trim();
}

/** Operator rule: first letter capital (Salat, not salat). */
export function capitalizeFirstLetter(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return t.charAt(0).toLocaleUpperCase("da-DK") + t.slice(1);
}

function allOcrFixes(): OcrIngredientFix[] {
  return [...BASE_OCR_INGREDIENT_FIXES, ...getLearnedOcrIngredientFixes()];
}

export function formatIngredientDisplay(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) return "";
  s = s.replace(/^[-–—•]\s*/, "");
  s = s.replace(/\bogæg\b/gi, "og æg").replace(/\bogost\b/gi, "og ost");
  // Prefer first part if still glued after known fixes — callers should use
  // sanitizeIngredientList / splitGluedFoodToken for full expansion.
  const split = splitGluedFoodToken(s);
  if (split.length === 1) s = split[0]!;
  else return split.map((p) => formatIngredientDisplay(p)).filter(Boolean).join(", ");
  s = stripTrailingPriceNoise(s);
  // Drop dangling conjunctions left by OCR splits
  s = s.replace(/\s+og$/i, "").trim();
  for (const [re, to] of allOcrFixes()) {
    s = s.replace(re, to);
  }
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  return capitalizeFirstLetter(s);
}

/**
 * True when a "name" looks like a toppings list rather than a dish title.
 * Used to block writing OCR ingredient soup into the product name field.
 */
export function looksLikeIngredientListName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (n.length > 60 && /,/.test(n)) return true;
  if (/^\d+\.\s/.test(n)) return true; // "25. rejer, ..."
  if (/,.*,/.test(n) && /\b(tomat|ost|salat|dressing|skinke)\b/i.test(n)) {
    return true;
  }
  if (/^(og|tomat,)/i.test(n)) return true;
  return false;
}

/** OCR wrecks like "I15,", "II5,", lone "og". */
export function looksLikeGarbageName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (/^og$/i.test(n)) return true;
  if (/^[Il1]{1,3}\d+,?\s*$/i.test(n)) return true; // I15, II5,
  if (/^[\W\d_]+$/.test(n)) return true;
  if (n.length <= 2 && !/^[A-Za-zÆØÅæøå]+$/.test(n)) return true;
  const words = n.split(/\s+/).filter(Boolean);
  const lowercaseConsonantNoise = words.some(
    (word) =>
      word.length >= 3 &&
      word === word.toLocaleLowerCase("da-DK") &&
      /^[bcdfghjklmnpqrstvwxz]+$/i.test(word),
  );
  if (words.length > 1 && lowercaseConsonantNoise) return true;
  return false;
}

export function formatProductName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return s;
  return capitalizeFirstLetter(s.replace(/,+\s*$/g, "").trim());
}

/**
 * Professional Danish description from the FINAL normalized ingredient list.
 * Example: "Oksekød, bacon, salat, tomat, løg, ketchup og mayo"
 */
export function formatDescriptionFromIngredients(
  ingredients: readonly string[],
): string {
  const parts = ingredients
    .map((i) => formatIngredientDisplay(i))
    .filter(Boolean)
    .map((p, idx) =>
      idx === 0 ? p : p.charAt(0).toLocaleLowerCase("da-DK") + p.slice(1),
    );
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} og ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} og ${parts[parts.length - 1]}`;
}

function ingredientStillPriceHeavy(raw: string, formatted: string): boolean {
  if (/\d{2,4}/.test(formatted)) return true;
  // Strip removed a trailing price but left almost nothing useful
  if (/\d{2,4}/.test(raw) && formatted.length < 2) return true;
  return false;
}

/**
 * Assess label quality: auto-repair safe hygiene; REVIEW/BLOCK when the
 * product name is still OCR garbage or an ingredient dump.
 */
export function assessLabelQuality(
  input: LabelQualityInput,
): LabelQualityAssessment {
  const reasons: string[] = [];
  const repairs: LabelRepair[] = [];
  const rawName = (input.name ?? "").trim();
  const rawDesc = (input.description ?? "").trim();
  const rawIngredients = [...(input.ingredients ?? [])];

  const repairedIngredients = sanitizeIngredientList(rawIngredients, rawName);
  for (const ing of rawIngredients) {
    const expanded = splitGluedFoodToken(ing);
    if (expanded.length > 1) {
      repairs.push({
        field: "ingredient",
        from: ing,
        to: expanded.join(", "),
        reason: "split_glued_ingredients",
      });
    } else if (isInvalidFoodComponent(ing, rawName)) {
      repairs.push({
        field: "ingredient",
        from: ing,
        to: "",
        reason: "dropped_invalid_food_component",
      });
    }
  }
  for (const ing of rawIngredients) {
    if (/^\d{2,4}$/.test(ing.trim()) || /\d{2,4}/.test(ing)) {
      const formatted = formatIngredientDisplay(ing);
      if (ingredientStillPriceHeavy(ing, formatted)) {
        reasons.push(`ingredient_still_numeric:${formatted || ing}`);
      }
    }
  }

  let repairedName = formatProductName(rawName);
  if (dishNameHasIngredientDump(repairedName) || dishNameHasIngredientDump(rawName)) {
    const cleaned = cleanDishDisplayName(rawName);
    if (cleaned.name && cleaned.name !== repairedName) {
      repairs.push({
        field: "name",
        from: rawName,
        to: cleaned.name,
        reason: "stripped_ingredient_dump_from_name",
      });
      repairedName = cleaned.name;
    }
  } else if (repairedName !== rawName && rawName) {
    repairs.push({
      field: "name",
      from: rawName,
      to: repairedName,
      reason: "name_hygiene",
    });
  }

  let repairedDescription = rawDesc
    ? polishDescriptionText(
        formatProductName(stripTrailingPriceNoise(rawDesc)),
        repairedName,
      )
    : "";
  if (
    !repairedDescription &&
    repairedIngredients.length > 0 &&
    (looksLikeIngredientListName(rawName) || looksLikeGarbageName(rawName))
  ) {
    repairedDescription = formatDescriptionFromIngredients(repairedIngredients);
    repairs.push({
      field: "description",
      from: rawDesc,
      to: repairedDescription,
      reason: "moved_ingredient_list_to_description",
    });
  } else if (repairedDescription !== rawDesc && rawDesc) {
    repairs.push({
      field: "description",
      from: rawDesc,
      to: repairedDescription,
      reason: "description_hygiene",
    });
  }

  if (!repairedName || looksLikeGarbageName(repairedName)) {
    reasons.push("garbage_product_name");
  }
  if (looksLikeIngredientListName(repairedName || rawName)) {
    reasons.push("name_looks_like_ingredient_list");
  }
  if (looksLikeToppingAsProductName(repairedName || rawName)) {
    reasons.push("name_looks_like_topping");
  }
  if (dishNameHasIngredientDump(repairedName)) {
    reasons.push("name_still_has_ingredient_dump");
  }
  if (
    repairedName &&
    repairedIngredients.length >= 3 &&
    repairedName.toLowerCase() ===
      formatDescriptionFromIngredients(repairedIngredients).toLowerCase()
  ) {
    reasons.push("name_equals_ingredient_dump");
  }
  if (rawIngredients.some((i) => isInvalidFoodComponent(i, repairedName))) {
    // Auto-dropped in repaired; mark repair path unless still present
    if (repairedIngredients.some((i) => isInvalidFoodComponent(i, repairedName))) {
      reasons.push("invalid_ingredient_tokens");
    }
  }

  const blocking = reasons.some(
    (r) =>
      r === "garbage_product_name" ||
      r === "name_looks_like_ingredient_list" ||
      r === "name_looks_like_topping" ||
      r === "name_equals_ingredient_dump" ||
      r === "name_still_has_ingredient_dump" ||
      r === "invalid_ingredient_tokens",
  );
  const numericIssues = reasons.some((r) =>
    r.startsWith("ingredient_still_numeric"),
  );

  let severity: LabelQualitySeverity;
  if (!repairedName && blocking) {
    severity = "BLOCK";
  } else if (blocking) {
    severity = "REVIEW";
  } else if (numericIssues) {
    severity = "REVIEW";
  } else if (repairs.length > 0) {
    severity = "REPAIR";
  } else {
    severity = "PASS";
  }

  return {
    severity,
    reasons,
    repairs,
    repaired: {
      name: repairedName,
      description: repairedDescription,
      ingredients: repairedIngredients,
    },
  };
}

/** True when write must not proceed without human correction. */
export function labelQualityBlocksWrite(
  assessment: LabelQualityAssessment,
): boolean {
  return (
    assessment.severity === "REVIEW" || assessment.severity === "BLOCK"
  );
}

export function formatLabelQualityFailure(
  assessment: LabelQualityAssessment,
): string {
  return `LABEL_QUALITY_${assessment.severity}: ${assessment.reasons.join(",") || "unspecified"}`;
}
