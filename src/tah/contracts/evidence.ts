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
    writeVariants: "UNCERTIFIED",
    writeIngredients: "UNCERTIFIED",
    writeAdditions: "UNCERTIFIED",
    setProductHidden: "UNCERTIFIED",
    setProductAvailable: "UNCERTIFIED",
  },
};

/** M2B certified READ capabilities after NEW WAY populated discovery. WRITE stays uncertified. */
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
    createCategory: "UNCERTIFIED",
    createProduct: "UNCERTIFIED",
    updateProduct: "UNCERTIFIED",
    /** M3E: Opdater on Veroni canary 18 — field preserve + remain Skjult/public-absent */
    updateExistingProductForm: "CERTIFIED",
    writeVariants: "UNCERTIFIED",
    writeIngredients: "UNCERTIFIED",
    writeAdditions: "UNCERTIFIED",
    setProductHidden: "UNCERTIFIED",
    setProductAvailable: "UNCERTIFIED",
  },
};

export function assertNoWriteCapabilitiesCertified(
  caps: AdapterCapabilities,
): void {
  for (const [name, status] of Object.entries(caps.write)) {
    if (name === "updateExistingProductForm") continue; // narrowly CERTIFIED after M3E
    if (status === "CERTIFIED") {
      throw new Error(
        `WRITE capability ${name} must not be CERTIFIED until Veroni canary round-trip succeeds`,
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
