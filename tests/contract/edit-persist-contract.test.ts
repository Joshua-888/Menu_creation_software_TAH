import { describe, expect, it } from "vitest";
import {
  ADMIN_CONTRACT_V1,
  ACTIVE_INTENDED_MAPPING,
  EDIT_PERSIST_REQUIRES_OPDATER,
  assertEditPathRequiresOpdater,
  assertUpdateProductSeparatelyUncertified,
  assertVerificationPath,
  canTransition,
  formModifiedCountsAsWritten,
  intendedAvailabilityFromActiveCheckbox,
  persistBoundaryForAction,
  transitionWriteState,
  visibilityWriteVerifiedFromFormOnly,
} from "../../src/tah/index.js";

describe("HUMAN_CONFIRMED edit/persist contract", () => {
  it("maps intended Aktiv? checked=AVAILABLE and unchecked=HIDDEN", () => {
    expect(ACTIVE_INTENDED_MAPPING.value).toBe("CHECKED_MEANS_AVAILABLE");
    expect(ACTIVE_INTENDED_MAPPING.checkedMeans).toBe("AVAILABLE");
    expect(ACTIVE_INTENDED_MAPPING.uncheckedMeans).toBe("HIDDEN");
    expect(intendedAvailabilityFromActiveCheckbox(true)).toBe("AVAILABLE");
    expect(intendedAvailabilityFromActiveCheckbox(false)).toBe("HIDDEN");
    expect(ADMIN_CONTRACT_V1.semantics.activeIntendedMapping.evidence).toBe(
      "HUMAN_CONFIRMED",
    );
  });

  it("requires Opdater for all edit fields and Skab for create", () => {
    expect(EDIT_PERSIST_REQUIRES_OPDATER.persistBoundary).toBe("Opdater");
    expect(EDIT_PERSIST_REQUIRES_OPDATER.createPersistBoundary).toBe("Skab");
    expect(EDIT_PERSIST_REQUIRES_OPDATER.fields).toContain("active");
    expect(EDIT_PERSIST_REQUIRES_OPDATER.fields).toContain("name");
    expect(persistBoundaryForAction("CREATE_PRODUCT")).toBe("Skab");
    expect(persistBoundaryForAction("UPDATE_PRODUCT")).toBe("Opdater");
    expect(
      ADMIN_CONTRACT_V1.semantics.editPersistRequiresOpdater.evidence,
    ).toBe("HUMAN_CONFIRMED");
  });

  it("does not count form modification as WRITTEN", () => {
    expect(formModifiedCountsAsWritten()).toBe(false);
    expect(canTransition("FORM_MODIFIED", "WRITTEN")).toBe(false);
    expect(canTransition("FORM_MODIFIED", "UPDATE_SUBMITTED")).toBe(true);
    expect(canTransition("UPDATE_SUBMITTED", "WRITTEN")).toBe(true);
    expect(() =>
      assertEditPathRequiresOpdater([
        "PRE_UPDATE",
        "FORM_MODIFIED",
        "WRITTEN",
      ]),
    ).toThrow(/Opdater|UPDATE_SUBMITTED/);
    expect(() =>
      assertEditPathRequiresOpdater([
        "PRE_UPDATE",
        "FORM_MODIFIED",
        "UPDATE_SUBMITTED",
        "WRITTEN",
        "READ_BACK",
        "VERIFIED",
      ]),
    ).not.toThrow();
  });

  it("keeps updateProduct separately uncertified from createProduct", () => {
    expect(ADMIN_CONTRACT_V1.capabilities.write.createProduct).toBe(
      "UNCERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.updateProduct).toBe(
      "UNCERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.updateExistingProductForm).toBe(
      "CERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.setProductHidden).toBe(
      "UNCERTIFIED",
    );
    expect(() =>
      assertUpdateProductSeparatelyUncertified(ADMIN_CONTRACT_V1.capabilities),
    ).not.toThrow();
  });

  it("cannot VERIFIED visibility from form-only state", () => {
    expect(visibilityWriteVerifiedFromFormOnly()).toBe(false);
    expect(() =>
      assertVerificationPath(["FORM_MODIFIED", "VERIFIED"]),
    ).toThrow();
  });

  it("allows create PENDING_WRITE path without edit PRE_UPDATE", () => {
    expect(transitionWriteState("PENDING_WRITE", "WRITTEN")).toBe("WRITTEN");
    expect(canTransition("PRE_UPDATE", "FORM_MODIFIED")).toBe(true);
  });
});
