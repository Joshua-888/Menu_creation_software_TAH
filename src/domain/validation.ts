import type { ValidationCode } from "./errors.js";
import type {
  CanonicalMenu,
  CanonicalProduct,
  ValidationIssue,
  ValidationReport,
} from "./schema/canonical.js";
import type { SourceMenu } from "./schema/source.js";
import { aggregateStatus, type ValidationStatus } from "./status.js";

export function issue(
  code: ValidationCode,
  message: string,
  entityId: string,
  severity: ValidationStatus,
  field?: string,
): ValidationIssue {
  const out: ValidationIssue = {
    code,
    message,
    entityId,
    severity,
  };
  if (field !== undefined) {
    out.field = field;
  }
  return out;
}

export function buildValidationReport(
  menu: CanonicalMenu,
): ValidationReport {
  const productIssues = menu.categories.flatMap((c) =>
    c.products.flatMap((p) => p.issues),
  );
  const allIssues = [...menu.issues, ...productIssues];
  const products = menu.categories.flatMap((c) => c.products);

  return {
    status: menu.status,
    issues: allIssues,
    productCount: products.length,
    readyCount: products.filter((p) => p.status === "READY").length,
    reviewCount: products.filter((p) => p.status === "MANUAL_REVIEW_REQUIRED")
      .length,
    blockedCount: products.filter((p) => p.status === "BLOCKED").length,
    warningCount: products.filter((p) => p.status === "WARNING").length,
  };
}

export function validateSourceIds(menu: SourceMenu): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const category of menu.categories) {
    if (!category.sourceId) {
      issues.push(
        issue("MISSING_SOURCE_ID", "Category missing sourceId", "unknown", "BLOCKED", "sourceId"),
      );
    } else if (seen.has(category.sourceId)) {
      issues.push(
        issue(
          "DUPLICATE_SOURCE_ID",
          `Duplicate sourceId ${category.sourceId}`,
          category.sourceId,
          "BLOCKED",
          "sourceId",
        ),
      );
    } else {
      seen.add(category.sourceId);
    }

    for (const product of category.products) {
      if (!product.sourceId) {
        issues.push(
          issue(
            "MISSING_SOURCE_ID",
            "Product missing sourceId",
            category.sourceId,
            "BLOCKED",
            "sourceId",
          ),
        );
      } else if (seen.has(product.sourceId)) {
        issues.push(
          issue(
            "DUPLICATE_SOURCE_ID",
            `Duplicate sourceId ${product.sourceId}`,
            product.sourceId,
            "BLOCKED",
            "sourceId",
          ),
        );
      } else {
        seen.add(product.sourceId);
      }

      for (const choice of product.productChoices) {
        if (seen.has(choice.sourceId)) {
          issues.push(
            issue(
              "DUPLICATE_SOURCE_ID",
              `Duplicate choice sourceId ${choice.sourceId}`,
              choice.sourceId,
              "BLOCKED",
              "sourceId",
            ),
          );
        } else {
          seen.add(choice.sourceId);
        }
        for (const option of choice.options) {
          // Option target may be any product id; checked for existence later
          void option;
        }
      }
    }
  }

  return issues;
}

export function validateProductChoices(
  menu: SourceMenu,
  knownProductIds: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const category of menu.categories) {
    for (const product of category.products) {
      for (const choice of product.productChoices) {
        if (choice.options.length === 0) {
          issues.push(
            issue(
              "MALFORMED_PRODUCT_CHOICE",
              "Product choice has no options",
              product.sourceId,
              "MANUAL_REVIEW_REQUIRED",
              "productChoices",
            ),
          );
        }
        for (const option of choice.options) {
          if (!knownProductIds.has(option.productSourceId)) {
            issues.push(
              issue(
                "MALFORMED_PRODUCT_CHOICE",
                `Choice option references unknown productSourceId ${option.productSourceId}`,
                product.sourceId,
                "MANUAL_REVIEW_REQUIRED",
                "productChoices",
              ),
            );
          }
        }
      }
    }
  }
  return issues;
}

export function finalizeProductStatus(
  product: Omit<CanonicalProduct, "status"> & { status?: ValidationStatus },
): CanonicalProduct {
  const status = aggregateStatus(product.issues.map((i) => i.severity));
  return { ...product, status };
}
