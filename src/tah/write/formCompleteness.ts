/**
 * HUMAN_CONFIRMED: DYNAMIC_ROW_COMPLETENESS_REQUIRED
 *
 * Before Skab / Opdater, every instantiated dynamic row must be complete
 * or removed. Empty section ≠ blank instantiated row. Never invent row data.
 *
 * There is NO fixed default row count. A product may have any number of
 * variants / ingredients / additions. Expected collections come only from
 * the approved product-specific WritePlan.
 *
 * Variant names are OPEN-ENDED source data — no whitelist. The browser
 * adapter must not interpret or reject names; it only executes the WritePlan.
 *
 * MULTIPLE COMPLETE ROWS = VALID
 * ANY INCOMPLETE INSTANTIATED ROW = INVALID
 */

export type DynamicSection = "variants" | "ingredients" | "additions";

export type AdminFormRowSnapshot = {
  name: string;
  price?: string;
  databaseId?: string | null;
  /** True when row is a hidden blueprint/template — must be ignored. */
  isBlueprint: boolean;
  /** True when the row is an actual form control in a list (not template). */
  isInstantiated: boolean;
};

export type AdminFormCompletenessSnapshot = {
  menuNumber: string;
  name: string;
  description: string;
  basePrice: string;
  categoryIds: string[];
  variants: AdminFormRowSnapshot[];
  ingredients: AdminFormRowSnapshot[];
  additions: AdminFormRowSnapshot[];
  /** Native HTML5 validity — NOT sufficient for TAH dynamic-row readiness. */
  nativeCheckValidity: boolean | null;
};

/** Intended rows from an approved WritePlan (product-specific; not a global default). */
export type WritePlanVariantRow = { name: string; price: string };
export type WritePlanIngredientRow = { name: string };
export type WritePlanAdditionRow = { name: string; price: string };

export type WritePlanDynamicCollections = {
  variants: readonly WritePlanVariantRow[];
  ingredients: readonly WritePlanIngredientRow[];
  additions: readonly WritePlanAdditionRow[];
};

export type DynamicRowCounts = {
  variants: number;
  ingredients: number;
  additions: number;
};

export type FormCompletenessIssue = {
  code:
    | "INCOMPLETE_ADMIN_ROW"
    | "MISSING_REQUIRED_ADMIN_FIELD"
    | "UNEXPECTED_DYNAMIC_ROW"
    | "ADMIN_FORM_NOT_SUBMIT_READY";
  section?: DynamicSection | "scalars";
  rowIndex?: number;
  missingFields?: string[];
  detail?: string;
};

export type FormCompletenessResult = {
  status: "VALID" | "INCOMPLETE_ADMIN_ROW" | "ADMIN_FORM_NOT_SUBMIT_READY";
  submitReady: boolean;
  issues: FormCompletenessIssue[];
  instantiated: DynamicRowCounts;
  blueprintsIgnored: DynamicRowCounts;
  writePlanCounts: DynamicRowCounts | null;
};

function isBlank(v: string | undefined): boolean {
  return v === undefined || v.trim() === "";
}

function norm(v: string | undefined): string {
  return (v ?? "").trim();
}

export function countsFromWritePlan(
  plan: WritePlanDynamicCollections,
): DynamicRowCounts {
  return {
    variants: plan.variants.length,
    ingredients: plan.ingredients.length,
    additions: plan.additions.length,
  };
}

export function instantiatedRows(
  rows: AdminFormRowSnapshot[],
): AdminFormRowSnapshot[] {
  return rows.filter((r) => r.isInstantiated && !r.isBlueprint);
}

export function requiredFieldsForSection(section: DynamicSection): string[] {
  if (section === "ingredients") return ["name"];
  return ["name", "price"];
}

export function missingFieldsForRow(
  section: DynamicSection,
  row: AdminFormRowSnapshot,
): string[] {
  const missing: string[] = [];
  for (const field of requiredFieldsForSection(section)) {
    if (field === "name" && isBlank(row.name)) missing.push("name");
    if (field === "price" && isBlank(row.price)) missing.push("price");
  }
  return missing;
}

/** Completeness only — any number of complete rows may pass. */
export function validateDynamicRowsComplete(
  section: DynamicSection,
  rows: AdminFormRowSnapshot[],
): FormCompletenessIssue[] {
  const issues: FormCompletenessIssue[] = [];
  instantiatedRows(rows).forEach((row, rowIndex) => {
    const missing = missingFieldsForRow(section, row);
    if (missing.length > 0) {
      issues.push({
        code: "INCOMPLETE_ADMIN_ROW",
        section,
        rowIndex,
        missingFields: missing,
      });
    }
  });
  return issues;
}

/**
 * WritePlan is source of truth: actual instantiated rows must match plan
 * length and intended content. Multiple complete rows are valid when planned.
 */
export function validateDynamicSectionAgainstWritePlan(
  section: DynamicSection,
  rows: AdminFormRowSnapshot[],
  planRows: readonly { name: string; price?: string }[],
): FormCompletenessIssue[] {
  const issues: FormCompletenessIssue[] = [
    ...validateDynamicRowsComplete(section, rows),
  ];
  const live = instantiatedRows(rows);

  if (live.length !== planRows.length) {
    issues.push({
      code: "UNEXPECTED_DYNAMIC_ROW",
      section,
      detail: `WritePlan has ${planRows.length} ${section} row(s); form has ${live.length} instantiated`,
    });
  }

  const n = Math.min(live.length, planRows.length);
  for (let i = 0; i < n; i++) {
    const actual = live[i]!;
    const expected = planRows[i]!;
    const mismatches: string[] = [];
    if (norm(actual.name) !== norm(expected.name)) {
      mismatches.push(
        `name want "${expected.name}" got "${actual.name}"`,
      );
    }
    if (
      section !== "ingredients" &&
      expected.price !== undefined &&
      norm(actual.price) !== norm(expected.price)
    ) {
      mismatches.push(
        `price want "${expected.price}" got "${actual.price ?? ""}"`,
      );
    }
    if (mismatches.length > 0) {
      issues.push({
        code: "UNEXPECTED_DYNAMIC_ROW",
        section,
        rowIndex: i,
        detail: mismatches.join("; "),
      });
    }
  }

  return issues;
}

export function validateScalarFields(
  snap: AdminFormCompletenessSnapshot,
): FormCompletenessIssue[] {
  const issues: FormCompletenessIssue[] = [];
  const required: Array<{ field: string; value: string }> = [
    { field: "menuNumber", value: snap.menuNumber },
    { field: "name", value: snap.name },
    { field: "description", value: snap.description },
    { field: "basePrice", value: snap.basePrice },
  ];
  for (const { field, value } of required) {
    if (isBlank(value)) {
      issues.push({
        code: "MISSING_REQUIRED_ADMIN_FIELD",
        section: "scalars",
        missingFields: [field],
      });
    }
  }
  if (snap.categoryIds.length === 0) {
    issues.push({
      code: "MISSING_REQUIRED_ADMIN_FIELD",
      section: "scalars",
      missingFields: ["categories"],
      detail: "at least one category must be selected",
    });
  }
  return issues;
}

function sectionCounts(snap: AdminFormCompletenessSnapshot): {
  instantiated: DynamicRowCounts;
  blueprintsIgnored: DynamicRowCounts;
} {
  const count = (rows: AdminFormRowSnapshot[]) => ({
    live: instantiatedRows(rows).length,
    blueprints: rows.filter((r) => r.isBlueprint).length,
  });
  const v = count(snap.variants);
  const i = count(snap.ingredients);
  const a = count(snap.additions);
  return {
    instantiated: {
      variants: v.live,
      ingredients: i.live,
      additions: a.live,
    },
    blueprintsIgnored: {
      variants: v.blueprints,
      ingredients: i.blueprints,
      additions: a.blueprints,
    },
  };
}

function finalizeResult(
  issues: FormCompletenessIssue[],
  snap: AdminFormCompletenessSnapshot,
  writePlanCounts: DynamicRowCounts | null,
): FormCompletenessResult {
  const { instantiated, blueprintsIgnored } = sectionCounts(snap);
  const submitReady = issues.length === 0;
  const hasIncomplete = issues.some((x) => x.code === "INCOMPLETE_ADMIN_ROW");
  const status: FormCompletenessResult["status"] = submitReady
    ? "VALID"
    : hasIncomplete
      ? "INCOMPLETE_ADMIN_ROW"
      : "ADMIN_FORM_NOT_SUBMIT_READY";

  if (
    !submitReady &&
    !issues.some((x) => x.code === "ADMIN_FORM_NOT_SUBMIT_READY")
  ) {
    issues.push({
      code: "ADMIN_FORM_NOT_SUBMIT_READY",
      detail: "form failed pre-submit completeness checks",
    });
  }

  return {
    status,
    submitReady,
    issues,
    instantiated,
    blueprintsIgnored,
    writePlanCounts,
  };
}

/**
 * Completeness-only gate: every instantiated row must be complete.
 * Does not enforce row counts — any number of complete rows is allowed.
 * Use for diagnostics / when WritePlan is not yet applied.
 */
export function validateInstantiatedRowsComplete(
  snap: AdminFormCompletenessSnapshot,
  options?: { requireScalars?: boolean },
): FormCompletenessResult {
  const requireScalars = options?.requireScalars !== false;
  const issues: FormCompletenessIssue[] = [
    ...(requireScalars ? validateScalarFields(snap) : []),
    ...validateDynamicRowsComplete("variants", snap.variants),
    ...validateDynamicRowsComplete("ingredients", snap.ingredients),
    ...validateDynamicRowsComplete("additions", snap.additions),
  ];
  return finalizeResult(issues, snap, null);
}

/**
 * Deterministic pre-submit validation against the approved WritePlan.
 * Expected collections are product-specific — never a hardcoded default of 1.
 */
export function validateAdminFormBeforeSubmit(
  snap: AdminFormCompletenessSnapshot,
  writePlan: WritePlanDynamicCollections,
): FormCompletenessResult {
  const issues: FormCompletenessIssue[] = [
    ...validateScalarFields(snap),
    ...validateDynamicSectionAgainstWritePlan(
      "variants",
      snap.variants,
      writePlan.variants,
    ),
    ...validateDynamicSectionAgainstWritePlan(
      "ingredients",
      snap.ingredients,
      writePlan.ingredients,
    ),
    ...validateDynamicSectionAgainstWritePlan(
      "additions",
      snap.additions,
      writePlan.additions,
    ),
  ];
  return finalizeResult(issues, snap, countsFromWritePlan(writePlan));
}

/**
 * Incomplete instantiated rows that are not represented in the WritePlan
 * should be removed via red X — never filled with invented data.
 * Incomplete rows that ARE in the WritePlan should be populated, not removed.
 */
export function unintendedBlankRows(
  snap: AdminFormCompletenessSnapshot,
  writePlan: WritePlanDynamicCollections,
): Array<{ section: DynamicSection; rowIndex: number }> {
  const out: Array<{ section: DynamicSection; rowIndex: number }> = [];
  const check = (
    section: DynamicSection,
    rows: AdminFormRowSnapshot[],
    planLen: number,
  ) => {
    instantiatedRows(rows).forEach((row, rowIndex) => {
      const missing = missingFieldsForRow(section, row);
      if (missing.length > 0 && rowIndex >= planLen) {
        out.push({ section, rowIndex });
      }
    });
  };
  check("variants", snap.variants, writePlan.variants.length);
  check("ingredients", snap.ingredients, writePlan.ingredients.length);
  check("additions", snap.additions, writePlan.additions.length);
  return out;
}

/** @deprecated Use validateDynamicSectionAgainstWritePlan — kept name for callers. */
export function validateDynamicSection(
  section: DynamicSection,
  rows: AdminFormRowSnapshot[],
  writePlanRows: readonly { name: string; price?: string }[],
): FormCompletenessIssue[] {
  return validateDynamicSectionAgainstWritePlan(section, rows, writePlanRows);
}
