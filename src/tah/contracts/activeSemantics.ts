/**
 * Active / edit persistence semantics — SCOPED reads + HUMAN_CONFIRMED write intent.
 */

export type ActiveReadSemantics =
  | "CHECKED_MEANS_AVAILABLE"
  | "CHECKED_MEANS_HIDDEN"
  | "EDIT_CHECKBOX_NOT_AUTHORITATIVE"
  | "MULTI_FIELD_VISIBILITY_RULE"
  | "UNKNOWN";

/**
 * Three separate observations — never collapse into one boolean from a DOM click.
 */
export type ActiveObservationLayer =
  | "EDIT_CONTROL_STATE"
  | "PERSISTED_PRODUCT_STATE"
  | "STOREFRONT_VISIBILITY";

/**
 * HUMAN_CONFIRMED intended meaning of the Aktiv? control (write intent).
 * Distinct from whether a particular product's rendered checkbox matches list/storefront.
 */
export const ACTIVE_INTENDED_MAPPING = {
  evidence: "HUMAN_CONFIRMED" as const,
  value: "CHECKED_MEANS_AVAILABLE" as const,
  checkedMeans: "AVAILABLE" as const,
  uncheckedMeans: "HIDDEN" as const,
  notes:
    "For existing products: checked Aktiv? = intended VISIBLE/AVAILABLE; unchecked = intended HIDDEN. Persistence still requires Opdater.",
};

/**
 * HUMAN_CONFIRMED: changing any edit-form field (including #active) does not persist
 * until Opdater is submitted. Applies to all edited product fields.
 */
export const EDIT_PERSIST_REQUIRES_OPDATER = {
  evidence: "HUMAN_CONFIRMED" as const,
  value: "ALL_EDIT_FIELDS_REQUIRE_OPDATER_SUBMIT" as const,
  persistBoundary: "Opdater" as const,
  createPersistBoundary: "Skab" as const,
  fields: [
    "menu_number",
    "name",
    "description",
    "price",
    "variants",
    "ingredients",
    "additions",
    "categories",
    "image",
    "active",
  ] as const,
  lifecycle: [
    "PRE_UPDATE",
    "FORM_MODIFIED",
    "UPDATE_SUBMITTED",
    "WRITTEN",
    "READ_BACK",
    "VERIFIED",
  ] as const,
  notes: [
    "Before Opdater: NO persisted change should be assumed",
    "After Opdater: a persisted mutation may have occurred and MUST be verified",
    "FORM/DRAFT state ≠ PERSISTED ADMIN state ≠ STOREFRONT state",
    "createProduct (Skab) does NOT certify updateProduct (Opdater)",
  ],
};

/**
 * HUMAN_CONFIRMED: every instantiated dynamic admin row must be complete
 * before Skab or Opdater. Empty section ≠ blank row. Never invent data.
 */
export const DYNAMIC_ROW_COMPLETENESS_REQUIRED = {
  evidence: "HUMAN_CONFIRMED" as const,
  value: "DYNAMIC_ROW_COMPLETENESS_REQUIRED" as const,
  applyBefore: ["Skab", "Opdater"] as const,
  sections: ["variants", "ingredients", "additions"] as const,
  notes: [
    "Green + adds a real editable row; red X removes it",
    "Empty section (header only) is allowed; blank instantiated rows block submit",
    "Ignore hidden #blueprint-* template markup",
    "No fixed/default row limit — a product may have any number of complete variants/ingredients/additions",
    "MULTIPLE COMPLETE ROWS = VALID; ANY INCOMPLETE INSTANTIATED ROW = INVALID",
    "Variant names are open-ended source data — no whitelist; adapter executes WritePlan only",
    "Expected collections come only from the approved product-specific WritePlan (not a hardcoded count of 1)",
    "Actual intended rows must equal WritePlan rows; do not remove valid populated rows merely because there are multiple",
    "form.checkValidity() true ≠ TAH dynamic-row submit-ready",
    "Never invent ingredients/variants/additions to pass validation",
  ],
};

/**
 * HUMAN_CONFIRMED visibility mutation via Aktiv? + Opdater.
 */
export const ACTIVE_CHECKBOX_PERSIST_REQUIRES_OPDATER = {
  evidence: "HUMAN_CONFIRMED" as const,
  value: "CHECKBOX_CHANGE_REQUIRES_OPDATER_SUBMIT" as const,
  layers: [
    "EDIT_CONTROL_STATE",
    "PERSISTED_PRODUCT_STATE",
    "STOREFRONT_VISIBILITY",
  ] as const satisfies readonly ActiveObservationLayer[],
  workflow: [
    "OPEN_PRODUCT_EDIT",
    "READ_CURRENT_PERSISTED_STATE",
    "CHANGE_ACTIVE_CHECKBOX",
    "CONFIRM_DOM_CHECKBOX",
    "INSPECT_PAYLOAD_WITHOUT_SUBMIT",
    "EXPLICIT_APPROVED_OPDATER_SUBMIT",
    "WAIT_FOR_SAVE",
    "READ_ADMIN_STATE_BACK",
    "READ_ADMIN_LIST_STATUS",
    "INSPECT_STOREFRONT",
    "VERIFIED",
  ] as const,
  notes: [
    "#active is an editable form control only until Opdater is clicked",
    "Temporary DOM #active.checked is NOT persisted product state",
    "Temporary DOM #active.checked is NOT storefront visibility",
    "Intended mapping: checked=AVAILABLE, unchecked=HIDDEN (HUMAN_CONFIRMED)",
    "Do not certify setProductHidden / setProductAvailable until this round-trip is TESTED on synthetic canary data",
  ],
};

export type SemanticScopeKind =
  | "GLOBAL_CONTRACT_FINGERPRINT"
  | "HOST"
  | "DEPLOYMENT"
  | "UNSCOPED";

export type ScopedSemanticEvidence<T> = {
  value: T;
  evidence: "OBSERVED" | "TESTED" | "INFERRED" | "UNKNOWN" | "HUMAN_CONFIRMED";
  scope: {
    kind: SemanticScopeKind;
    /** e.g. host name or fingerprint hash — never a restaurant business hack alone */
    id: string;
  };
  notes?: string;
};

/** NEW WAY M2C evidence — scoped to that host observation, not global. */
export const NEW_WAY_ACTIVE_READ_SEMANTICS: ScopedSemanticEvidence<ActiveReadSemantics> =
  {
    value: "CHECKED_MEANS_AVAILABLE",
    evidence: "TESTED",
    scope: { kind: "HOST", id: "newwaypizzaringsted.dk" },
    notes:
      "M2C: #active checked matched list Tilgængelig on sampled NEW WAY products. Aligns with HUMAN_CONFIRMED intended mapping. Persist still requires Opdater.",
  };

/**
 * Veroni M3D product 18: server-rendered edit #active checked while list=Skjult
 * and public absent. Intended write mapping remains checked=AVAILABLE
 * (HUMAN_CONFIRMED), but this product's rendered checkbox is NOT authoritative
 * for persisted/storefront visibility — likely rendering/state inconsistency.
 * Do not invert the checkbox boolean by hostname.
 */
export const VERONI_ACTIVE_READ_SEMANTICS: ScopedSemanticEvidence<ActiveReadSemantics> =
  {
    value: "EDIT_CHECKBOX_NOT_AUTHORITATIVE",
    evidence: "OBSERVED",
    scope: { kind: "HOST", id: "veronipizza.dk" },
    notes:
      "Product 18: list Skjult + public absent vs edit #active server-checked + show '- Aktiv'. Prefer list/storefront for visibility. Intended Aktiv? mapping is still checked=AVAILABLE / unchecked=HIDDEN (HUMAN_CONFIRMED), but current render appears inconsistent until Opdater round-trip proves otherwise. No hostname invert hack.",
  };

export function resolveActiveReadSemantics(input: {
  host?: string;
  fingerprint?: string;
}): ScopedSemanticEvidence<ActiveReadSemantics> {
  const host = input.host?.toLowerCase();
  if (host === "newwaypizzaringsted.dk") return NEW_WAY_ACTIVE_READ_SEMANTICS;
  if (host === "veronipizza.dk") return VERONI_ACTIVE_READ_SEMANTICS;
  return {
    value: "UNKNOWN",
    evidence: "UNKNOWN",
    scope: {
      kind: input.fingerprint ? "GLOBAL_CONTRACT_FINGERPRINT" : "UNSCOPED",
      id: input.fingerprint ?? "none",
    },
    notes: "No scoped active-state certification for this admin instance",
  };
}

/** Intended availability from form checkbox (HUMAN_CONFIRMED write intent). */
export function intendedAvailabilityFromActiveCheckbox(
  checked: boolean | null,
): "AVAILABLE" | "HIDDEN" | "UNKNOWN" {
  if (checked === true) return "AVAILABLE";
  if (checked === false) return "HIDDEN";
  return "UNKNOWN";
}

/**
 * Map list status text to availability when known; never invent.
 */
export function mapListStatusText(
  statusText: string | null | undefined,
): "AVAILABLE" | "HIDDEN" | "UNKNOWN" {
  if (!statusText) return "UNKNOWN";
  const t = statusText.trim().toLowerCase();
  if (t === "tilgængelig") return "AVAILABLE";
  if (t === "skjult") return "HIDDEN";
  return "UNKNOWN";
}

/**
 * Interpret product active for callers.
 * Prefer list status / storefront for customer availability when checkbox is
 * not authoritative (e.g. Veroni product 18).
 *
 * `activeCheckbox` is FORM/DRAFT (EDIT_CONTROL_STATE) only.
 */
export function interpretActiveState(input: {
  host?: string;
  activeCheckbox: boolean | null;
  listStatusText?: string | null;
}): {
  activeCheckbox: boolean | null;
  listAvailability: "AVAILABLE" | "HIDDEN" | "UNKNOWN";
  intendedFromCheckbox: "AVAILABLE" | "HIDDEN" | "UNKNOWN";
  /** Availability interpretation — null when unknown/unsafe */
  customerAvailable: boolean | null;
  semantics: ScopedSemanticEvidence<ActiveReadSemantics>;
  editControlStateOnly: true;
} {
  const semantics = resolveActiveReadSemantics(
    input.host ? { host: input.host } : {},
  );
  const listAvailability = mapListStatusText(input.listStatusText);
  const intendedFromCheckbox = intendedAvailabilityFromActiveCheckbox(
    input.activeCheckbox,
  );
  let customerAvailable: boolean | null = null;

  if (
    semantics.value === "CHECKED_MEANS_AVAILABLE" &&
    semantics.evidence === "TESTED"
  ) {
    customerAvailable = input.activeCheckbox;
  } else if (
    semantics.value === "CHECKED_MEANS_HIDDEN" &&
    (semantics.evidence === "TESTED" || semantics.evidence === "OBSERVED")
  ) {
    customerAvailable =
      input.activeCheckbox === null
        ? null
        : input.activeCheckbox === true
          ? false
          : true;
  } else if (listAvailability === "HIDDEN") {
    customerAvailable = false;
  } else if (listAvailability === "AVAILABLE") {
    customerAvailable = true;
  }

  return {
    activeCheckbox: input.activeCheckbox,
    listAvailability,
    intendedFromCheckbox,
    customerAvailable,
    semantics,
    editControlStateOnly: true,
  };
}

/** Required steps before setProductHidden / setProductAvailable may be CERTIFIED. */
export const VISIBILITY_WRITE_CERTIFICATION_CHECKLIST =
  ACTIVE_CHECKBOX_PERSIST_REQUIRES_OPDATER.workflow;

export function isVisibilityWriteRoundTripComplete(
  stepsCompleted: readonly string[],
): boolean {
  return VISIBILITY_WRITE_CERTIFICATION_CHECKLIST.every((step) =>
    stepsCompleted.includes(step),
  );
}

/** Form/draft modification alone never equals a persisted write. */
export function formModifiedCountsAsWritten(): false {
  return false;
}
