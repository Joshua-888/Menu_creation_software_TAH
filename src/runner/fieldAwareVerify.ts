/**
 * Field-aware read-back verification.
 *
 * Distinguishes representational differences (safe) from semantic mismatches.
 * Do NOT use one universal string comparator across all fields.
 */

export type FieldComparisonResultKind =
  | "EXACT_VALUE"
  | "REPRESENTATION_EQUIVALENT"
  | "SEMANTIC_EQUIVALENT"
  | "SEMANTIC_MISMATCH";

export type FieldComparisonMode =
  | "MENU_NUMBER_EXACT"
  | "NAME_CASE_WHITESPACE"
  | "CATEGORY_CANONICAL"
  | "PRICE_EXACT_MONEY"
  | "VARIANTS_STRUCTURED"
  | "INGREDIENTS_CANONICAL"
  | "INGREDIENT_DESCRIPTION_SEMANTIC"
  | "ADDITIONS_STRUCTURED"
  | "ADDITION_PRICES_EXACT"
  | "VISIBILITY_EXACT"
  | "PRODUCT_CHOICES_STRUCTURED";

export type FieldVerificationReport = {
  field: string;
  expected: unknown;
  actual: unknown;
  comparisonMode: FieldComparisonMode;
  normalizedExpected: unknown;
  normalizedActual: unknown;
  result: FieldComparisonResultKind;
};

export type ProductVerificationReport = {
  ok: boolean;
  fields: FieldVerificationReport[];
  failingFields: string[];
  representationEquivalentFields: string[];
  semanticMismatchFields: string[];
};

function unicodeNorm(s: string): string {
  return s.normalize("NFC");
}

function collapseWs(s: string): string {
  return unicodeNorm(s).replace(/\s+/g, " ").trim();
}

function stripTerminalPunct(s: string): string {
  return s.replace(/[.!…]+$/u, "").trim();
}

function normKeyDa(s: string): string {
  return collapseWs(stripTerminalPunct(s)).toLocaleLowerCase("da-DK");
}

/**
 * Split a list segment on the final Danish conjunction " og " only.
 * Does not naively split every "og" occurrence inside compound phrases
 * beyond the last conjunction (ingredient-list convention).
 */
export function splitFinalOgConjunction(part: string): string[] {
  const raw = collapseWs(part);
  if (!raw) return [];
  const lower = raw.toLocaleLowerCase("da-DK");
  const marker = " og ";
  const idx = lower.lastIndexOf(marker);
  if (idx === -1) return [raw];
  const left = raw.slice(0, idx).trim();
  const right = raw.slice(idx + marker.length).trim();
  if (!left || !right) return [raw];
  return [left, right];
}

/**
 * Parse an ingredient-list description into normalized food tokens.
 * Handles:
 * - "A, B, C og D"
 * - "A, B, C, D" (comma-only, title-cased)
 * - "A og B"
 * Preserves compound leftovers (e.g. "creme fraiche dressing").
 */
export function parseIngredientDescriptionTokens(description: string): string[] {
  const s = stripTerminalPunct(collapseWs(description));
  if (!s) return [];

  const commaParts = s
    .split(/\s*,\s*/)
    .map((p) => collapseWs(p))
    .filter(Boolean);

  const tokens: string[] = [];
  if (commaParts.length === 1) {
    tokens.push(...splitFinalOgConjunction(commaParts[0]!));
  } else {
    for (let i = 0; i < commaParts.length; i++) {
      const part = commaParts[i]!;
      if (i === commaParts.length - 1) {
        tokens.push(...splitFinalOgConjunction(part));
      } else {
        tokens.push(part);
      }
    }
  }

  return tokens.map(normKeyDa).filter(Boolean);
}

export function compareIngredientDescription(
  expected: string,
  actual: string,
): FieldVerificationReport {
  const expectedRaw = expected ?? "";
  const actualRaw = actual ?? "";
  const mode: FieldComparisonMode = "INGREDIENT_DESCRIPTION_SEMANTIC";

  if (expectedRaw === actualRaw) {
    return {
      field: "description",
      expected: expectedRaw,
      actual: actualRaw,
      comparisonMode: mode,
      normalizedExpected: parseIngredientDescriptionTokens(expectedRaw),
      normalizedActual: parseIngredientDescriptionTokens(actualRaw),
      result: "EXACT_VALUE",
    };
  }

  const ne = parseIngredientDescriptionTokens(expectedRaw);
  const na = parseIngredientDescriptionTokens(actualRaw);

  const sameSequence =
    ne.length === na.length && ne.every((t, i) => t === na[i]);
  const sameMultiset =
    ne.length === na.length &&
    [...ne].sort().every((t, i) => t === [...na].sort()[i]);

  if (sameSequence || sameMultiset) {
    // Case / "og" vs comma / capitalization — same tokens
    return {
      field: "description",
      expected: expectedRaw,
      actual: actualRaw,
      comparisonMode: mode,
      normalizedExpected: ne,
      normalizedActual: na,
      result: "REPRESENTATION_EQUIVALENT",
    };
  }

  return {
    field: "description",
    expected: expectedRaw,
    actual: actualRaw,
    comparisonMode: mode,
    normalizedExpected: ne,
    normalizedActual: na,
    result: "SEMANTIC_MISMATCH",
  };
}

function compareMenuNumber(
  expected: string,
  actual: string,
): FieldVerificationReport {
  const ne = collapseWs(expected);
  const na = collapseWs(actual);
  return {
    field: "menuNumber",
    expected,
    actual,
    comparisonMode: "MENU_NUMBER_EXACT",
    normalizedExpected: ne,
    normalizedActual: na,
    result: ne === na ? "EXACT_VALUE" : "SEMANTIC_MISMATCH",
  };
}

function compareName(expected: string, actual: string): FieldVerificationReport {
  const ne = normKeyDa(expected);
  const na = normKeyDa(actual);
  const exact = collapseWs(expected) === collapseWs(actual);
  return {
    field: "name",
    expected,
    actual,
    comparisonMode: "NAME_CASE_WHITESPACE",
    normalizedExpected: ne,
    normalizedActual: na,
    result:
      ne === na
        ? exact
          ? "EXACT_VALUE"
          : "REPRESENTATION_EQUIVALENT"
        : "SEMANTIC_MISMATCH",
  };
}

function compareCategories(
  expectedIds: readonly string[],
  actualIds: readonly string[],
): FieldVerificationReport {
  const ne = [...expectedIds].map((x) => collapseWs(x)).sort();
  const na = [...actualIds].map((x) => collapseWs(x)).sort();
  const same =
    ne.length === na.length && ne.every((t, i) => t === na[i]);
  return {
    field: "categories",
    expected: expectedIds,
    actual: actualIds,
    comparisonMode: "CATEGORY_CANONICAL",
    normalizedExpected: ne,
    normalizedActual: na,
    result: same ? "EXACT_VALUE" : "SEMANTIC_MISMATCH",
  };
}

function comparePrice(
  field: string,
  expectedOre: number,
  actualOre: number,
): FieldVerificationReport {
  return {
    field,
    expected: expectedOre,
    actual: actualOre,
    comparisonMode: "PRICE_EXACT_MONEY",
    normalizedExpected: expectedOre,
    normalizedActual: actualOre,
    result:
      expectedOre === actualOre ? "EXACT_VALUE" : "SEMANTIC_MISMATCH",
  };
}

function compareIngredients(
  expected: readonly string[],
  actual: readonly string[],
): FieldVerificationReport {
  const ne = expected.map(normKeyDa).filter(Boolean);
  const na = actual.map(normKeyDa).filter(Boolean);
  const same =
    ne.length === na.length &&
    [...ne].sort().every((t, i) => t === [...na].sort()[i]);
  const exactSeq =
    expected.length === actual.length &&
    expected.every((e, i) => e === actual[i]);
  return {
    field: "ingredients",
    expected,
    actual,
    comparisonMode: "INGREDIENTS_CANONICAL",
    normalizedExpected: ne,
    normalizedActual: na,
    result: same
      ? exactSeq
        ? "EXACT_VALUE"
        : "REPRESENTATION_EQUIVALENT"
      : "SEMANTIC_MISMATCH",
  };
}

function compareVariants(
  expected: readonly { name: string; surchargeOre: number }[],
  actual: readonly { name: string; priceOre: number }[],
): FieldVerificationReport[] {
  const reports: FieldVerificationReport[] = [];
  if (expected.length !== actual.length) {
    reports.push({
      field: "variantCount",
      expected: expected.length,
      actual: actual.length,
      comparisonMode: "VARIANTS_STRUCTURED",
      normalizedExpected: expected.length,
      normalizedActual: actual.length,
      result: "SEMANTIC_MISMATCH",
    });
    return reports;
  }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const a = actual[i]!;
    if (normKeyDa(e.name) !== normKeyDa(a.name)) {
      reports.push({
        field: `variantName${i}`,
        expected: e.name,
        actual: a.name,
        comparisonMode: "VARIANTS_STRUCTURED",
        normalizedExpected: normKeyDa(e.name),
        normalizedActual: normKeyDa(a.name),
        result: "SEMANTIC_MISMATCH",
      });
    }
    if (e.surchargeOre !== a.priceOre) {
      reports.push({
        field: `variantPrice${i}`,
        expected: e.surchargeOre,
        actual: a.priceOre,
        comparisonMode: "PRICE_EXACT_MONEY",
        normalizedExpected: e.surchargeOre,
        normalizedActual: a.priceOre,
        result: "SEMANTIC_MISMATCH",
      });
    }
  }
  if (reports.length === 0) {
    reports.push({
      field: "variants",
      expected,
      actual,
      comparisonMode: "VARIANTS_STRUCTURED",
      normalizedExpected: expected.map(
        (v) => `${normKeyDa(v.name)}:${v.surchargeOre}`,
      ),
      normalizedActual: actual.map((v) => `${normKeyDa(v.name)}:${v.priceOre}`),
      result: "EXACT_VALUE",
    });
  }
  return reports;
}

function compareAdditions(
  expected: readonly { name: string; priceOre: number }[],
  actual: readonly { name: string; priceOre: number }[],
): FieldVerificationReport[] {
  const reports: FieldVerificationReport[] = [];
  if (expected.length !== actual.length) {
    reports.push({
      field: "additionCount",
      expected: expected.length,
      actual: actual.length,
      comparisonMode: "ADDITIONS_STRUCTURED",
      normalizedExpected: expected.length,
      normalizedActual: actual.length,
      result: "SEMANTIC_MISMATCH",
    });
    return reports;
  }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const a = actual[i]!;
    if (normKeyDa(e.name) !== normKeyDa(a.name)) {
      reports.push({
        field: `additionName${i}`,
        expected: e.name,
        actual: a.name,
        comparisonMode: "ADDITIONS_STRUCTURED",
        normalizedExpected: normKeyDa(e.name),
        normalizedActual: normKeyDa(a.name),
        result: "SEMANTIC_MISMATCH",
      });
    }
    if (e.priceOre !== a.priceOre) {
      reports.push({
        field: `additionPrice${i}`,
        expected: e.priceOre,
        actual: a.priceOre,
        comparisonMode: "ADDITION_PRICES_EXACT",
        normalizedExpected: e.priceOre,
        normalizedActual: a.priceOre,
        result: "SEMANTIC_MISMATCH",
      });
    }
  }
  if (reports.length === 0) {
    reports.push({
      field: "additions",
      expected,
      actual,
      comparisonMode: "ADDITIONS_STRUCTURED",
      normalizedExpected: expected.map(
        (a) => `${normKeyDa(a.name)}:${a.priceOre}`,
      ),
      normalizedActual: actual.map((a) => `${normKeyDa(a.name)}:${a.priceOre}`),
      result: "EXACT_VALUE",
    });
  }
  return reports;
}

function compareVisibility(
  intendedHidden: boolean,
  listStatus: string,
): FieldVerificationReport {
  const actualHidden = collapseWs(listStatus).toLocaleLowerCase("da-DK") === "skjult";
  const ok = intendedHidden ? actualHidden : !actualHidden;
  return {
    field: "visibility",
    expected: intendedHidden ? "Skjult" : "not Skjult",
    actual: listStatus,
    comparisonMode: "VISIBILITY_EXACT",
    normalizedExpected: intendedHidden,
    normalizedActual: actualHidden,
    result: ok ? "EXACT_VALUE" : "SEMANTIC_MISMATCH",
  };
}

export type VerifyProductInput = {
  expected: {
    menuNumber: string;
    name: string;
    description: string;
    basePriceOre: number;
    categoryIds: readonly string[];
    variants: readonly { name: string; surchargeOre: number }[];
    ingredients: readonly string[];
    additions: readonly { name: string; priceOre: number }[];
    intendedHidden: boolean;
  };
  actual: {
    menuNumber: string;
    name: string;
    description: string;
    basePriceOre: number;
    categoryIds: readonly string[];
    variants: readonly { name: string; priceOre: number }[];
    ingredients: readonly { name: string }[] | readonly string[];
    additions: readonly { name: string; priceOre: number }[];
    listStatus: string;
  };
};

function ingredientNames(
  ings: readonly { name: string }[] | readonly string[],
): string[] {
  return ings.map((i) => (typeof i === "string" ? i : i.name));
}

/**
 * Full field-aware product verification with auditable per-field reports.
 */
export function verifyProductFields(
  input: VerifyProductInput,
): ProductVerificationReport {
  const { expected, actual } = input;
  const fields: FieldVerificationReport[] = [
    compareMenuNumber(expected.menuNumber, actual.menuNumber),
    compareName(expected.name, actual.name),
    compareIngredientDescription(expected.description, actual.description),
    comparePrice("basePrice", expected.basePriceOre, actual.basePriceOre),
    compareCategories(expected.categoryIds, actual.categoryIds),
    ...compareVariants(expected.variants, actual.variants),
    compareIngredients(expected.ingredients, ingredientNames(actual.ingredients)),
    ...compareAdditions(expected.additions, actual.additions),
    compareVisibility(expected.intendedHidden, actual.listStatus),
  ];

  const failingFields = fields
    .filter((f) => f.result === "SEMANTIC_MISMATCH")
    .map((f) => f.field);
  const representationEquivalentFields = fields
    .filter((f) => f.result === "REPRESENTATION_EQUIVALENT")
    .map((f) => f.field);
  const semanticMismatchFields = failingFields;

  return {
    ok: failingFields.length === 0,
    fields,
    failingFields,
    representationEquivalentFields,
    semanticMismatchFields,
  };
}

/**
 * Backward-compatible diff list: only SEMANTIC_MISMATCH fields.
 * Representation-equivalent fields do NOT appear (not a failed product).
 */
export function fieldAwareDiffNames(report: ProductVerificationReport): string[] {
  return [...report.failingFields];
}
