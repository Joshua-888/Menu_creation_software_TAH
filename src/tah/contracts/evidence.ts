export type ContractEvidenceLevel =
  | "OBSERVED"
  | "TESTED"
  | "INFERRED"
  | "UNKNOWN";

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
    writeVariants: CapabilityStatus;
    writeIngredients: CapabilityStatus;
    writeAdditions: CapabilityStatus;
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
    writeVariants: "UNCERTIFIED",
    writeIngredients: "UNCERTIFIED",
    writeAdditions: "UNCERTIFIED",
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
    writeVariants: "UNCERTIFIED",
    writeIngredients: "UNCERTIFIED",
    writeAdditions: "UNCERTIFIED",
  },
};

export function assertNoWriteCapabilitiesCertified(
  caps: AdapterCapabilities,
): void {
  for (const [name, status] of Object.entries(caps.write)) {
    if (status === "CERTIFIED") {
      throw new Error(`WRITE capability ${name} must not be CERTIFIED before M3`);
    }
  }
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
