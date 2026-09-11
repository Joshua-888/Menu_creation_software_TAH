export type ContractEvidenceLevel =
  | "OBSERVED"
  | "TESTED"
  | "INFERRED"
  | "UNKNOWN"
  | "HUMAN_CONFIRMED";

export type CapabilityStatus = "UNCERTIFIED" | "CERTIFIED" | "UNAVAILABLE";

export type VariantPriceSemantics =
  | "SURCHARGE"
  | "ABSOLUTE_TOTAL"
  | "UNKNOWN";

export type BasePriceSemantics =
  | "DEFAULT_BASE_PRODUCT_PRICE"
  | "MINIMUM_PRICE"
  | "DISPLAY_ONLY"
  | "UNKNOWN";

export type ContractElementEvidence<T = unknown> = {
  value: T;
  evidence: ContractEvidenceLevel;
  notes?: string;
};

export type AdapterCapabilities = {
  read: {
    contractProbe: CapabilityStatus;
    listCategories: CapabilityStatus;
    listProducts: CapabilityStatus;
    readProduct: CapabilityStatus;
    readVariants: CapabilityStatus;
    readIngredients: CapabilityStatus;
    readAdditions: CapabilityStatus;
  };
  write: {
    createCategory: CapabilityStatus;
    createProduct: CapabilityStatus;
    updateProduct: CapabilityStatus;
    /**
     * Narrow: Opdater submit + exact business-field read-back on synthetic canary.
     * Does NOT certify visibility transitions or full updateProduct API.
     */
    updateExistingProductForm: CapabilityStatus;
    updateProductDescription: CapabilityStatus;
    updateScalarProductField: CapabilityStatus;
    /** Hidden create via Skab + unchecked Aktiv? (not visibility Opdater transition). */
    createHiddenProduct: CapabilityStatus;
    writeDefaultVariant: CapabilityStatus;
    writeNonZeroVariants: CapabilityStatus;
    writeMultipleVariants: CapabilityStatus;
    assignExistingCategory: CapabilityStatus;
    writeVariants: CapabilityStatus;
    writeIngredients: CapabilityStatus;
    writeAdditions: CapabilityStatus;
    /**
     * Persist product as non-visible via edit #active + Opdater round-trip.
     * UNCERTIFIED until HUMAN-CONFIRMED Opdater workflow is live-TESTED on canary.
     */
    setProductHidden: CapabilityStatus;
    /**
     * Persist product as customer-visible via edit #active + Opdater round-trip.
     * UNCERTIFIED until same full storefront verification path succeeds.
     */
    setProductAvailable: CapabilityStatus;
  };
};

export const DEFAULT_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  read: {
    contractProbe: "UNCERTIFIED",
    listCategories: "UNCERTIFIED",
    listProducts: "UNCERTIFIED",
    readProduct: "UNCERTIFIED",
    readVariants: "UNCERTIFIED",
    readIngredients: "UNCERTIFIED",
    readAdditions: "UNCERTIFIED",
  },
  write: {
    createCategory: "UNCERTIFIED",
    createProduct: "UNCERTIFIED",
    updateProduct: "UNCERTIFIED",
    updateExistingProductForm: "UNCERTIFIED",
    updateProductDescription: "UNCERTIFIED",
    updateScalarProductField: "UNCERTIFIED",
    createHiddenProduct: "UNCERTIFIED",
    writeDefaultVariant: "UNCERTIFIED",
    writeNonZeroVariants: "UNCERTIFIED",
    writeMultipleVariants: "UNCERTIFIED",
    assignExistingCategory: "UNCERTIFIED",
    writeVariants: "UNCERTIFIED",
    writeIngredients: "UNCERTIFIED",
    writeAdditions: "UNCERTIFIED",
    setProductHidden: "UNCERTIFIED",
    setProductAvailable: "UNCERTIFIED",
  },
};

/** M2B certified READ + M3H update + M3 create (filled after live cert). */
export const M2B_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  read: {
    contractProbe: "CERTIFIED",
    listCategories: "CERTIFIED",
    listProducts: "CERTIFIED",
    readProduct: "CERTIFIED",
    readVariants: "CERTIFIED",
    readIngredients: "CERTIFIED",
    readAdditions: "CERTIFIED",
  },
  write: {
    /** M6.7 Veroni canary __TAH_CANARY_CATEGORY_M67__ — POST /admin/categories + list read-back */
    createCategory: "CERTIFIED",
    createProduct: "CERTIFIED",
    updateProduct: "UNCERTIFIED",
    /** M3H Veroni canary 18: Opdater + POST /admin/menu/18 + description read-back */
    updateExistingProductForm: "CERTIFIED",
    updateProductDescription: "CERTIFIED",
    updateScalarProductField: "CERTIFIED",
    /** M3 create: hidden Skab canaries 19/20 on Veroni */
    createHiddenProduct: "CERTIFIED",
    writeDefaultVariant: "CERTIFIED",
    writeNonZeroVariants: "CERTIFIED",
    writeMultipleVariants: "CERTIFIED",
    assignExistingCategory: "CERTIFIED",
    writeVariants: "UNCERTIFIED",
    writeIngredients: "CERTIFIED",
    writeAdditions: "CERTIFIED",
    setProductHidden: "UNCERTIFIED",
    setProductAvailable: "UNCERTIFIED",
  },
};

/** Broad / dangerous writes that must stay UNCERTIFIED until dedicated cert. */
const BROAD_WRITE_CAPS_MUST_STAY_UNCERTIFIED = [
  "updateProduct",
  "setProductHidden",
  "setProductAvailable",
] as const;

/**
 * After M3H/M6.7, narrow createCategory + create/update Opdater caps may be CERTIFIED.
 * Broad full-update/visibility writes must remain UNCERTIFIED.
 */
export function assertNoWriteCapabilitiesCertified(
  caps: AdapterCapabilities,
): void {
  for (const name of BROAD_WRITE_CAPS_MUST_STAY_UNCERTIFIED) {
    if (caps.write[name] === "CERTIFIED") {
      throw new Error(
        `WRITE capability ${name} must not be CERTIFIED until dedicated canary certification succeeds`,
      );
    }
  }
}

/**
 * Visibility mutation capabilities stay UNCERTIFIED until Opdater round-trip
 * is TESTED. Checkbox-only DOM changes must never be treated as certified writes.
 */
export function assertVisibilityWriteCapabilitiesUncertified(
  caps: AdapterCapabilities,
): void {
  if (caps.write.setProductHidden === "CERTIFIED") {
    throw new Error(
      "setProductHidden must not be CERTIFIED until Opdater persist + storefront round-trip is TESTED",
    );
  }
  if (caps.write.setProductAvailable === "CERTIFIED") {
    throw new Error(
      "setProductAvailable must not be CERTIFIED until Opdater persist + storefront round-trip is TESTED",
    );
  }
}

/**
 * createProduct certification does NOT imply updateProduct.
 * Skab ≠ Opdater persistence boundaries.
 */
export function assertUpdateProductSeparatelyUncertified(
  caps: AdapterCapabilities,
): void {
  if (caps.write.updateProduct === "CERTIFIED") {
    throw new Error(
      "updateProduct must stay UNCERTIFIED until synthetic canary Opdater round-trip is TESTED",
    );
  }
}

/**
 * Gate for certifying visibility writes. Requires explicit Opdater submit in
 * the completed checklist — checkbox DOM mutation alone is never enough.
 */
export function mayCertifyVisibilityWrite(input: {
  capabilities: AdapterCapabilities;
  stepsCompleted: readonly string[];
  syntheticCanary: boolean;
  approvedOpdaterSubmit: boolean;
}): boolean {
  if (!input.syntheticCanary) return false;
  if (!input.approvedOpdaterSubmit) return false;
  if (
    !input.stepsCompleted.includes("EXPLICIT_APPROVED_OPDATER_SUBMIT") ||
    !input.stepsCompleted.includes("INSPECT_STOREFRONT") ||
    !input.stepsCompleted.includes("VERIFIED")
  ) {
    return false;
  }
  return (
    input.capabilities.write.setProductHidden !== "CERTIFIED" &&
    input.capabilities.write.setProductAvailable !== "CERTIFIED"
  );
}

/** Visibility write cannot be VERIFIED from form state alone. */
export function visibilityWriteVerifiedFromFormOnly(): false {
  return false;
}

export function isMilestone3WriteReady(input: {
  variantPriceSemantics: VariantPriceSemantics;
  capabilities: AdapterCapabilities;
}): boolean {
  if (input.variantPriceSemantics === "UNKNOWN") return false;
  if (input.capabilities.read.readProduct !== "CERTIFIED") return false;
  if (input.capabilities.read.readVariants !== "CERTIFIED") return false;
  return true;
}

/**
 * Live canary execution readiness: read-ready PLUS inactive create default
 * PLUS known active-state semantics for the target host/fingerprint.
 * M3 Veroni fails: #active defaults checked AND active semantics UNKNOWN.
 */
export function isMilestone3CanaryExecutable(input: {
  variantPriceSemantics: VariantPriceSemantics;
  capabilities: AdapterCapabilities;
  activeDefaultChecked: boolean | null;
  /** Host-scoped active read semantics; must not be UNKNOWN for writes */
  activeReadSemantics?: string | null;
}): boolean {
  if (!isMilestone3WriteReady(input)) return false;
  if (input.activeDefaultChecked !== false) return false;
  if (
    input.activeReadSemantics !== undefined &&
    input.activeReadSemantics !== "CHECKED_MEANS_AVAILABLE" &&
    input.activeReadSemantics !== "CHECKED_MEANS_HIDDEN"
  ) {
    return false;
  }
  return true;
}
