import type { CanonicalMenu, CanonicalProduct, ValidationReport } from "../domain/schema/canonical.js";
import type { SourceAccounting } from "../extraction/pdf/types.js";
import type { CategoryMappingResult } from "../planning/categoryMapping.js";

export type HumanReviewItem = {
  sourceId: string;
  menuNumber: string;
  name: string;
  category: string;
  field: string;
  extractedValue: unknown;
  sourceEvidence?: unknown;
  reasonCode: string;
  recommendedInterpretation?: string;
  status: string;
};

/**
 * Concise human-review artifact — ONLY items needing attention.
 */
export function buildHumanReviewReport(input: {
  canonical: CanonicalMenu;
  validation: ValidationReport;
  accounting?: SourceAccounting;
  categoryMappings?: CategoryMappingResult[];
}): {
  generatedAt: string;
  items: HumanReviewItem[];
  counts: {
    productsNeedingReview: number;
    validationIssues: number;
    categoryIssues: number;
  };
} {
  const items: HumanReviewItem[] = [];

  for (const category of input.canonical.categories) {
    for (const product of category.products) {
      if (product.status === "READY") continue;
      const issueList =
        product.issues.length > 0
          ? product.issues
          : [
              {
                code: product.status,
                message: product.status,
                entityId: product.sourceId,
                severity: product.status,
              },
            ];
      for (const issue of issueList) {
        items.push(
          reviewFromProduct(product, category.name, issue.code, issue.message),
        );
      }
    }
  }

  for (const issue of input.validation.issues) {
    if (issue.severity === "READY" || issue.severity === "WARNING") continue;
    items.push({
      sourceId: issue.entityId,
      menuNumber: "",
      name: "",
      category: "",
      field: issue.field ?? "menu",
      extractedValue: null,
      reasonCode: issue.code,
      recommendedInterpretation: issue.message,
      status: issue.severity,
    });
  }

  let categoryIssues = 0;
  for (const m of input.categoryMappings ?? []) {
    if (m.outcome === "SOURCE_STRUCTURE_PLACEHOLDER") {
      // Placeholder is not a destination createCategory issue
      continue;
    }
    if (
      m.outcome === "MISSING_DESTINATION_CATEGORY" ||
      m.outcome === "AMBIGUOUS_MATCH"
    ) {
      categoryIssues += 1;
      items.push({
        sourceId: m.sourceCategoryId,
        menuNumber: "",
        name: m.sourceCategoryName,
        category: m.sourceCategoryName,
        field: "category",
        extractedValue: m.sourceCategoryName,
        reasonCode: m.outcome,
        recommendedInterpretation: m.reason,
        status: "MANUAL_REVIEW_REQUIRED",
      });
    }
  }

  for (const e of input.accounting?.entries ?? []) {
    if (
      e.disposition === "MANUAL_REVIEW_REQUIRED" ||
      e.disposition === "BLOCKED"
    ) {
      if (
        items.some(
          (i) => i.sourceId === e.sourceId && i.reasonCode === e.disposition,
        )
      ) {
        continue;
      }
      items.push({
        sourceId: e.sourceId ?? e.candidateId,
        menuNumber: e.menuNumber ?? "",
        name: e.name ?? "",
        category: "",
        field: "extraction",
        extractedValue: e.detectedItem,
        sourceEvidence: {
          location: e.sourceLocation,
          pageNumber: e.pageNumber,
        },
        reasonCode: e.disposition,
        recommendedInterpretation: e.reason,
        status: e.disposition,
      });
    }
  }

  const productIds = new Set(
    items.filter((i) => i.menuNumber || i.name).map((i) => i.sourceId),
  );

  return {
    generatedAt: new Date().toISOString(),
    items,
    counts: {
      productsNeedingReview: productIds.size,
      validationIssues: input.validation.issues.length,
      categoryIssues,
    },
  };
}

function reviewFromProduct(
  product: CanonicalProduct,
  category: string,
  reasonCode: string,
  message: string,
): HumanReviewItem {
  return {
    sourceId: product.sourceId,
    menuNumber: product.assignedMenuNumber ?? product.sourceMenuNumber ?? "",
    name: product.name,
    category,
    field: "product",
    extractedValue: {
      name: product.name,
      menuNumber: product.assignedMenuNumber ?? product.sourceMenuNumber,
      basePrice: product.basePrice,
      variants: product.variants.map((v) => ({
        name: v.name,
        surcharge: v.surcharge,
      })),
    },
    ...(product.evidence ? { sourceEvidence: product.evidence } : {}),
    reasonCode,
    recommendedInterpretation: message,
    status: product.status,
  };
}
