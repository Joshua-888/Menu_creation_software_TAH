import type { MoneyMinor } from "./money.js";
import type { ValueOrigin } from "./provenance.js";
import type { ValidationIssue } from "./schema/canonical.js";
import type { SourceVariant } from "./schema/source.js";

export type PricedVariant = {
  sourceId: string;
  name: string;
  nameOrigin: ValueOrigin;
  surcharge: MoneyMinor;
  surchargeOrigin: ValueOrigin;
  isBase: boolean;
  sourceTotalPrice?: MoneyMinor;
  sourceExplicitSurcharge?: MoneyMinor;
};

export type PricingResult = {
  basePrice: MoneyMinor | undefined;
  basePriceOrigin: ValueOrigin | undefined;
  variants: PricedVariant[];
  issues: ValidationIssue[];
};

function optionalFields(
  total: MoneyMinor | undefined,
  explicit: MoneyMinor | undefined,
): Pick<PricedVariant, "sourceTotalPrice" | "sourceExplicitSurcharge"> {
  const out: Pick<
    PricedVariant,
    "sourceTotalPrice" | "sourceExplicitSurcharge"
  > = {};
  if (total !== undefined) {
    out.sourceTotalPrice = total;
  }
  if (explicit !== undefined) {
    out.sourceExplicitSurcharge = explicit;
  }
  return out;
}

/**
 * Compute base price and per-variant surcharges for one product.
 * Never mutates input variants.
 */
export function priceVariants(
  productSourceId: string,
  variants: readonly SourceVariant[],
  baseVariantSourceId: string,
  options?: { injectedDefaultAlm?: boolean },
): PricingResult {
  const issues: ValidationIssue[] = [];

  if (options?.injectedDefaultAlm || variants.length === 0) {
    return {
      basePrice: 0,
      basePriceOrigin: "SYSTEM_DEFAULT",
      variants: [
        {
          sourceId: baseVariantSourceId,
          name: "Alm.",
          nameOrigin: "SYSTEM_DEFAULT",
          surcharge: 0,
          surchargeOrigin: "SYSTEM_DEFAULT",
          isBase: true,
        },
      ],
      issues,
    };
  }

  const base = variants.find((v) => v.sourceId === baseVariantSourceId);
  if (!base) {
    issues.push({
      code: "INVALID_BASE_VARIANT",
      message: "Selected base variant not found on product",
      entityId: productSourceId,
      field: "variants",
      severity: "BLOCKED",
    });
    return {
      basePrice: undefined,
      basePriceOrigin: undefined,
      variants: [],
      issues,
    };
  }

  let basePrice: MoneyMinor | undefined;
  let basePriceOrigin: ValueOrigin | undefined;

  if (base.sourceTotalPrice !== undefined) {
    basePrice = base.sourceTotalPrice;
    // Preserve an explicit provenance tag (e.g. DERIVED for a group-inherited
    // price) instead of always claiming a direct SOURCE read.
    basePriceOrigin = base.priceOrigin ?? "SOURCE";
  } else if (base.sourceExplicitSurcharge !== undefined) {
    // Explicit surcharge on base without total: treat base total as 0+surcharge only if surcharge is 0
    if (base.sourceExplicitSurcharge === 0) {
      basePrice = 0;
      basePriceOrigin = "DERIVED";
    } else {
      issues.push({
        code: "MISSING_BASE_PRICE",
        message:
          "Base variant has explicit surcharge but no source total price",
        entityId: productSourceId,
        field: "basePrice",
        severity: "MANUAL_REVIEW_REQUIRED",
      });
    }
  } else {
    issues.push({
      code: "MISSING_BASE_PRICE",
      message: "Base variant has no source total price",
      entityId: productSourceId,
      field: "basePrice",
      severity: "MANUAL_REVIEW_REQUIRED",
    });
  }

  const priced: PricedVariant[] = [];

  for (const variant of variants) {
    const isBase = variant.sourceId === baseVariantSourceId;
    const total = variant.sourceTotalPrice;
    const explicit = variant.sourceExplicitSurcharge;

    if (basePrice !== undefined && total !== undefined && explicit !== undefined) {
      if (basePrice + explicit !== total) {
        issues.push({
          code: "SOURCE_PRICE_CONFLICT",
          message: `basePrice (${basePrice}) + explicitSurcharge (${explicit}) !== sourceTotalPrice (${total})`,
          entityId: productSourceId,
          field: `variants.${variant.sourceId}`,
          severity: "MANUAL_REVIEW_REQUIRED",
        });
      }
    }

    let surcharge: MoneyMinor = 0;
    let surchargeOrigin: ValueOrigin = "DERIVED";

    if (isBase) {
      surcharge = 0;
      surchargeOrigin =
        explicit !== undefined && total === undefined ? "SOURCE" : "DERIVED";
      if (explicit !== undefined && explicit !== 0 && total === undefined) {
        // already flagged missing base price path above
      }
    } else if (explicit !== undefined && total === undefined) {
      surcharge = explicit;
      surchargeOrigin = "SOURCE";
    } else if (explicit !== undefined && total !== undefined) {
      // Prefer validating conflict; still use explicit if consistent, else still record explicit but issue raised
      surcharge = explicit;
      surchargeOrigin = "SOURCE";
    } else if (total !== undefined && basePrice !== undefined) {
      surcharge = total - basePrice;
      surchargeOrigin = "DERIVED";
    } else if (total !== undefined && basePrice === undefined) {
      issues.push({
        code: "INVALID_VARIANT_SURCHARGE",
        message: "Cannot derive surcharge without base price",
        entityId: productSourceId,
        field: `variants.${variant.sourceId}`,
        severity: "MANUAL_REVIEW_REQUIRED",
      });
      surcharge = 0;
      surchargeOrigin = "DERIVED";
    } else {
      issues.push({
        code: "MALFORMED_PRICE",
        message: "Variant has neither total nor explicit surcharge",
        entityId: productSourceId,
        field: `variants.${variant.sourceId}`,
        severity: "MANUAL_REVIEW_REQUIRED",
      });
    }

    if (surcharge < 0) {
      issues.push({
        code: "UNEXPECTED_NEGATIVE_SURCHARGE",
        message: `Negative surcharge ${surcharge} for variant ${variant.name}`,
        entityId: productSourceId,
        field: `variants.${variant.sourceId}`,
        severity: "MANUAL_REVIEW_REQUIRED",
      });
    }

    if (
      basePrice !== undefined &&
      total !== undefined &&
      explicit === undefined &&
      basePrice + surcharge !== total
    ) {
      issues.push({
        code: "INVALID_VARIANT_SURCHARGE",
        message: `basePrice + surcharge !== sourceTotalPrice for ${variant.name}`,
        entityId: productSourceId,
        field: `variants.${variant.sourceId}`,
        severity: "BLOCKED",
      });
    }

    priced.push({
      sourceId: variant.sourceId,
      name: variant.name,
      nameOrigin: "SOURCE",
      surcharge,
      surchargeOrigin,
      isBase,
      ...optionalFields(total, explicit),
    });
  }

  return { basePrice, basePriceOrigin, variants: priced, issues };
}
