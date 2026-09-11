export type DestinationCategory = {
  databaseId: string;
  name: string;
};

export type CategoryMapOutcome =
  | "EXACT_MATCH"
  | "SAFE_MAPPED_MATCH"
  | "MISSING_DESTINATION_CATEGORY"
  | "AMBIGUOUS_MATCH"
  | "SOURCE_STRUCTURE_PLACEHOLDER";

export type CategoryMappingResult = {
  sourceCategoryId: string;
  sourceCategoryName: string;
  outcome: CategoryMapOutcome;
  destinationCategoryId?: string;
  destinationCategoryName?: string;
  reason: string;
};

export type ProductCategoryMappingResult = {
  menuNumber: string;
  productName: string;
  sourceCategoryName: string;
  outcome:
    | "EXACT_MATCH"
    | "SAFE_MAPPED_MATCH"
    | "MANUAL_REVIEW_REQUIRED"
    | "MISSING_DESTINATION_CATEGORY";
  destinationCategoryId?: string;
  destinationCategoryName?: string;
  reason: string;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Source-layout placeholders must never become destination createCategory blockers. */
export function isSourceStructurePlaceholder(name: string): boolean {
  return /^unlabelled[_-]/i.test(name.trim());
}

/**
 * Read-only category mapping. Never creates categories.
 */
export function mapSourceCategoriesToDestination(
  sourceCategories: Array<{ sourceId: string; name: string }>,
  destinationCategories: DestinationCategory[],
): CategoryMappingResult[] {
  return sourceCategories.map((src) => {
    if (isSourceStructurePlaceholder(src.name)) {
      return {
        sourceCategoryId: src.sourceId,
        sourceCategoryName: src.name,
        outcome: "SOURCE_STRUCTURE_PLACEHOLDER" as const,
        reason:
          "source structure placeholder only — not a destination category; map products individually",
      };
    }

    const exact = destinationCategories.filter(
      (d) => norm(d.name) === norm(src.name),
    );
    if (exact.length === 1) {
      return {
        sourceCategoryId: src.sourceId,
        sourceCategoryName: src.name,
        outcome: "EXACT_MATCH" as const,
        destinationCategoryId: exact[0]!.databaseId,
        destinationCategoryName: exact[0]!.name,
        reason: "exact normalized name match",
      };
    }
    if (exact.length > 1) {
      return {
        sourceCategoryId: src.sourceId,
        sourceCategoryName: src.name,
        outcome: "AMBIGUOUS_MATCH" as const,
        reason: `multiple exact matches: ${exact.map((e) => e.databaseId).join(",")}`,
      };
    }

    // Safe mapped: destination contains source or vice versa uniquely
    const soft = destinationCategories.filter((d) => {
      const a = norm(d.name);
      const b = norm(src.name);
      return a.includes(b) || b.includes(a);
    });
    if (soft.length === 1 && norm(src.name).length >= 4) {
      return {
        sourceCategoryId: src.sourceId,
        sourceCategoryName: src.name,
        outcome: "SAFE_MAPPED_MATCH" as const,
        destinationCategoryId: soft[0]!.databaseId,
        destinationCategoryName: soft[0]!.name,
        reason: "unique containment match",
      };
    }
    if (soft.length > 1) {
      return {
        sourceCategoryId: src.sourceId,
        sourceCategoryName: src.name,
        outcome: "AMBIGUOUS_MATCH" as const,
        reason: `multiple soft matches: ${soft.map((s) => s.name).join(",")}`,
      };
    }

    return {
      sourceCategoryId: src.sourceId,
      sourceCategoryName: src.name,
      outcome: "MISSING_DESTINATION_CATEGORY" as const,
      reason: "no destination category match; createCategory UNCERTIFIED",
    };
  });
}

/**
 * Product-level destination mapping for source-structure placeholders (36–38).
 */
export function mapProductToDestinationCategory(
  product: { menuNumber: string; name: string; sourceCategoryName: string },
  destinationCategories: DestinationCategory[],
  opts?: {
    /** Operator-approved exact-product destination overrides (M6.5+). */
    humanApprovedByMenuNumber?: Record<
      string,
      { destinationCategoryId: string; destinationCategoryName: string }
    >;
  },
): ProductCategoryMappingResult {
  const n = product.menuNumber;
  const name = product.name;
  const approved = opts?.humanApprovedByMenuNumber?.[n];
  if (approved) {
    return {
      menuNumber: n,
      productName: name,
      sourceCategoryName: product.sourceCategoryName,
      outcome: "SAFE_MAPPED_MATCH",
      destinationCategoryId: approved.destinationCategoryId,
      destinationCategoryName: approved.destinationCategoryName,
      reason: `HUMAN_APPROVED_DESTINATION_CATEGORY → ${approved.destinationCategoryName}`,
    };
  }

  if (n === "36" || n === "37") {
    const durum = destinationCategories.filter((d) =>
      /durum|pitabr[øo]d/i.test(d.name),
    );
    if (durum.length === 1) {
      return {
        menuNumber: n,
        productName: name,
        sourceCategoryName: product.sourceCategoryName,
        outcome: "SAFE_MAPPED_MATCH",
        destinationCategoryId: durum[0]!.databaseId,
        destinationCategoryName: durum[0]!.name,
        reason: `name evidence → ${durum[0]!.name}`,
      };
    }
    if (durum.length > 1) {
      return {
        menuNumber: n,
        productName: name,
        sourceCategoryName: product.sourceCategoryName,
        outcome: "MANUAL_REVIEW_REQUIRED",
        reason: `multiple Durum/Pitabrød destination matches: ${durum.map((d) => d.name).join(", ")}`,
      };
    }
    return {
      menuNumber: n,
      productName: name,
      sourceCategoryName: product.sourceCategoryName,
      outcome: "MISSING_DESTINATION_CATEGORY",
      reason: "expected Durum & Pitabrød destination category not found",
    };
  }

  if (n === "38") {
    // Do not force same category as 36–37 solely from unlabeled block
    const garlic = destinationCategories.filter((d) =>
      /hvidl[øo]g|(^|[^a-z])tilbeh[øo]r/i.test(d.name),
    );
    if (garlic.length === 1) {
      return {
        menuNumber: n,
        productName: name,
        sourceCategoryName: product.sourceCategoryName,
        outcome: "SAFE_MAPPED_MATCH",
        destinationCategoryId: garlic[0]!.databaseId,
        destinationCategoryName: garlic[0]!.name,
        reason: `unique soft destination match for hvidløgsbrød → ${garlic[0]!.name}`,
      };
    }
    return {
      menuNumber: n,
      productName: name,
      sourceCategoryName: product.sourceCategoryName,
      outcome: "MANUAL_REVIEW_REQUIRED",
      reason:
        "Product 38 (hvidløgsbrød) destination ambiguous — do not invent category from UNLABELLED_PAGE5_36_38",
    };
  }

  return {
    menuNumber: n,
    productName: name,
    sourceCategoryName: product.sourceCategoryName,
    outcome: "MANUAL_REVIEW_REQUIRED",
    reason: "no product-level mapping rule",
  };
}
