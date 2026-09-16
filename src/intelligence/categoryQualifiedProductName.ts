/**
 * CATEGORY_QUALIFIED_PRODUCT_NAME_V1
 *
 * GLOBAL SEMANTIC_RULE: product names must stay understandable on kitchen
 * receipts printed without category context.
 *
 * Underspecified filling-only names in qualifying families get:
 *   "<Product type> m. <existing name>"
 *
 * Already self-describing names are preserved. Idempotent.
 */

export const CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID =
  "CATEGORY_QUALIFIED_PRODUCT_NAME_V1" as const;

export const CATEGORY_QUALIFIED_PRODUCT_NAME_SCOPE = "GLOBAL" as const;

/** Semantic families that qualify for receipt-safe name completion. */
export type ReceiptNamingFamily =
  | "SALAD"
  | "PITA"
  | "DURUM"
  | "ROLL"
  | "PIZZA_SANDWICH"
  | "SANDWICH"
  | "BAGEL";

export type CategoryQualifiedNameTrace = {
  policyId: typeof CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID;
  scope: typeof CATEGORY_QUALIFIED_PRODUCT_NAME_SCOPE;
  originalName: string;
  category: string;
  family: ReceiptNamingFamily | null;
  finalName: string;
  changed: boolean;
  reason:
    | "PRODUCT_NAME_NOT_RECEIPT_SAFE_WITHOUT_CATEGORY"
    | "ALREADY_RECEIPT_SAFE"
    | "CATEGORY_FAMILY_NOT_APPLICABLE"
    | "EMPTY_NAME";
};

const FAMILY_PREFIX: Record<ReceiptNamingFamily, string> = {
  SALAD: "Salat",
  PITA: "Pita",
  DURUM: "Durum",
  ROLL: "Rulle",
  PIZZA_SANDWICH: "Pizza Sandwich",
  SANDWICH: "Sandwich",
  BAGEL: "Bagel",
};

/** Normalized category aliases → family (order matters for overlapping tokens). */
const CATEGORY_ALIAS_RULES: Array<{
  family: ReceiptNamingFamily;
  match: RegExp;
}> = [
  {
    family: "PIZZA_SANDWICH",
    match: /^pizza[\s-]*sandwich(es)?$/i,
  },
  {
    family: "DURUM",
    match: /^(d[uü]rum|durumrulle|durum\s*rulle)s?$/i,
  },
  {
    family: "PITA",
    match: /^(pita|pitabr[øo]d|pita\s*br[øo]d)s?$/i,
  },
  {
    family: "SALAD",
    match: /^(salat|salater)$/i,
  },
  {
    family: "BAGEL",
    match: /^bagels?$/i,
  },
  {
    family: "SANDWICH",
    match: /^sandwich(es)?$/i,
  },
  {
    // Explicit Rulle only — after Durumrulle ruled out above
    family: "ROLL",
    match: /^ruller?$/i,
  },
];

function collapseWs(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

function normKey(s: string): string {
  return collapseWs(s).toLocaleLowerCase("da-DK");
}

/**
 * Resolve receipt-naming family from category semantics (not merchant strings).
 */
export function resolveReceiptNamingFamily(
  categoryName: string,
): ReceiptNamingFamily | null {
  const cat = collapseWs(categoryName);
  if (!cat) return null;
  for (const rule of CATEGORY_ALIAS_RULES) {
    if (rule.match.test(cat)) return rule.family;
  }
  return null;
}

export function receiptSafePrefix(
  family: ReceiptNamingFamily,
): string {
  return FAMILY_PREFIX[family];
}

/**
 * True when the product name already carries enough product-type context
 * for the given family (self-describing / already qualified).
 */
export function nameAlreadyReceiptSafe(
  productName: string,
  family: ReceiptNamingFamily,
): boolean {
  const name = collapseWs(productName);
  if (!name) return false;
  const key = normKey(name);
  const prefix = FAMILY_PREFIX[family];
  const prefixKey = normKey(prefix);

  // Already system- or source-qualified with m./med
  const qualifiedRe = new RegExp(
    `^${escapeRe(prefixKey)}\\s+(m\\.|med)\\s+.+`,
    "i",
  );
  if (qualifiedRe.test(key)) return true;

  // Compact forms: "Pita Kebab", "Pitabrød …", "Chicken Bagel"
  switch (family) {
    case "SALAD":
      return /\bsalat\b/i.test(name);
    case "PITA":
      return /\bpita\b/i.test(name) || /\bpitabr/i.test(name);
    case "DURUM":
      return /\bd[uü]rum\b/i.test(name);
    case "ROLL":
      return /\brulle\b/i.test(name);
    case "PIZZA_SANDWICH":
      return /pizza\s*-?\s*sandwich/i.test(name);
    case "SANDWICH":
      // Pizza Sandwich is a different family; plain sandwich token is enough
      return /\bsandwich\b/i.test(name);
    case "BAGEL":
      return /\bbagel\b/i.test(name);
    default:
      return false;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply CATEGORY_QUALIFIED_PRODUCT_NAME_V1.
 * Idempotent: applyPolicy(applyPolicy(x)) === applyPolicy(x).
 */
export function applyCategoryQualifiedProductName(input: {
  productName: string;
  categoryName: string;
}): {
  name: string;
  trace: CategoryQualifiedNameTrace;
} {
  const originalName = collapseWs(input.productName);
  const category = collapseWs(input.categoryName);
  const family = resolveReceiptNamingFamily(category);

  const baseTrace = {
    policyId: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
    scope: CATEGORY_QUALIFIED_PRODUCT_NAME_SCOPE,
    originalName,
    category,
    family,
  } as const;

  if (!originalName) {
    return {
      name: originalName,
      trace: {
        ...baseTrace,
        finalName: originalName,
        changed: false,
        reason: "EMPTY_NAME",
      },
    };
  }

  if (!family) {
    return {
      name: originalName,
      trace: {
        ...baseTrace,
        finalName: originalName,
        changed: false,
        reason: "CATEGORY_FAMILY_NOT_APPLICABLE",
      },
    };
  }

  if (nameAlreadyReceiptSafe(originalName, family)) {
    return {
      name: originalName,
      trace: {
        ...baseTrace,
        finalName: originalName,
        changed: false,
        reason: "ALREADY_RECEIPT_SAFE",
      },
    };
  }

  const prefix = receiptSafePrefix(family);
  const finalName = `${prefix} m. ${originalName}`;
  return {
    name: finalName,
    trace: {
      ...baseTrace,
      finalName,
      changed: true,
      reason: "PRODUCT_NAME_NOT_RECEIPT_SAFE_WITHOUT_CATEGORY",
    },
  };
}

/**
 * Quality helper: for qualifying families, is the name receipt-safe
 * without category context?
 */
export function isProductNameReceiptSafe(input: {
  productName: string;
  categoryName: string;
}): boolean {
  const family = resolveReceiptNamingFamily(input.categoryName);
  if (!family) return true; // check does not apply
  const name = collapseWs(input.productName);
  if (!name) return false;
  return nameAlreadyReceiptSafe(name, family);
}

export function listCategoryAliasesForFamily(
  family: ReceiptNamingFamily,
): string[] {
  switch (family) {
    case "SALAD":
      return ["Salat", "Salater"];
    case "PITA":
      return ["Pita", "Pitabrød", "Pita Brød"];
    case "DURUM":
      return ["Durum", "Durumrulle", "Durum Rulle"];
    case "ROLL":
      return ["Rulle", "Ruller"];
    case "PIZZA_SANDWICH":
      return ["Pizza Sandwich", "Pizzasandwich", "Pizza-Sandwich"];
    case "SANDWICH":
      return ["Sandwich", "Sandwiches"];
    case "BAGEL":
      return ["Bagel", "Bagels"];
    default:
      return [];
  }
}

export const RECEIPT_NAMING_FAMILIES: readonly ReceiptNamingFamily[] = [
  "SALAD",
  "PITA",
  "DURUM",
  "ROLL",
  "PIZZA_SANDWICH",
  "SANDWICH",
  "BAGEL",
] as const;
