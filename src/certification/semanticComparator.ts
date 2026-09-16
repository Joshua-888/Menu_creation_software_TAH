/**
 * Semantic golden comparator — ignores generated IDs/timestamps.
 */

export type SemanticProduct = {
  name: string;
  category: string;
  menuNumber?: string;
  basePriceOre?: number;
  ingredients: string[];
  description?: string;
  variants: string[];
  additions: Array<{ name: string; priceOre?: number }>;
  isCombo?: boolean;
};

export type SemanticMenu = {
  products: SemanticProduct[];
};

export type SemanticMismatch = {
  product?: string;
  field: string;
  expected: unknown;
  actual: unknown;
};

export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function compareSemanticMenus(
  expected: SemanticMenu,
  actual: SemanticMenu,
  opts?: { requireExactIngredients?: boolean },
): {
  ok: boolean;
  mismatches: SemanticMismatch[];
  accountedExpected: number;
  accountedActual: number;
} {
  const mismatches: SemanticMismatch[] = [];
  const actualByName = new Map(
    actual.products.map((p) => [normalizeName(p.name), p]),
  );

  for (const exp of expected.products) {
    const act = actualByName.get(normalizeName(exp.name));
    if (!act) {
      mismatches.push({
        product: exp.name,
        field: "presence",
        expected: "present",
        actual: "missing",
      });
      continue;
    }
    if (normalizeName(exp.category) !== normalizeName(act.category)) {
      mismatches.push({
        product: exp.name,
        field: "category",
        expected: exp.category,
        actual: act.category,
      });
    }
    if (
      exp.menuNumber != null &&
      act.menuNumber != null &&
      String(exp.menuNumber) !== String(act.menuNumber)
    ) {
      mismatches.push({
        product: exp.name,
        field: "menuNumber",
        expected: exp.menuNumber,
        actual: act.menuNumber,
      });
    }
    if (
      exp.basePriceOre != null &&
      act.basePriceOre != null &&
      exp.basePriceOre !== act.basePriceOre
    ) {
      mismatches.push({
        product: exp.name,
        field: "basePriceOre",
        expected: exp.basePriceOre,
        actual: act.basePriceOre,
      });
    }
    if (opts?.requireExactIngredients) {
      const eIng = exp.ingredients.map(normalizeName).sort().join("|");
      const aIng = act.ingredients.map(normalizeName).sort().join("|");
      if (eIng !== aIng) {
        mismatches.push({
          product: exp.name,
          field: "ingredients",
          expected: exp.ingredients,
          actual: act.ingredients,
        });
      }
    } else if (exp.ingredients.length > 0 && act.ingredients.length === 0) {
      mismatches.push({
        product: exp.name,
        field: "ingredients",
        expected: `non-empty (≥${Math.min(2, exp.ingredients.length)})`,
        actual: [],
      });
    }
    const expVars = new Set(exp.variants.map(normalizeName));
    for (const v of act.variants) {
      if (/^menu/.test(normalizeName(v))) {
        mismatches.push({
          product: exp.name,
          field: "variants",
          expected: "no Menu variant",
          actual: v,
        });
      }
    }
    for (const ev of expVars) {
      if (ev === "menu" || ev === "menü") {
        mismatches.push({
          product: exp.name,
          field: "golden_variant",
          expected: "Menu must not be expected as variant",
          actual: ev,
        });
      }
    }
  }

  for (const act of actual.products) {
    if (
      !expected.products.some(
        (e) => normalizeName(e.name) === normalizeName(act.name),
      )
    ) {
      // Extra products are reported but not always failures for Menuer synth
      mismatches.push({
        product: act.name,
        field: "extra_product",
        expected: "in golden",
        actual: "present (informational)",
      });
    }
  }

  const hard = mismatches.filter(
    (m) =>
      m.field !== "extra_product" &&
      !(m.field === "presence" && /menu$/i.test(String(m.product))),
  );

  return {
    ok: hard.length === 0,
    mismatches,
    accountedExpected: expected.products.length,
    accountedActual: actual.products.length,
  };
}
