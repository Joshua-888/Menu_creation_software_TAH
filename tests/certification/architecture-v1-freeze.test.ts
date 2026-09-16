/**
 * Architecture V1 freeze smoke — marker + purity linkage.
 */
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_MATRIX_VERSION,
  CORE_PIPELINE_VERSION,
  MENU_PLATFORM_ARCHITECTURE_V1,
  MENU_PLATFORM_ARCHITECTURE_VERSION,
} from "../../src/architecture/menuPlatformArchitectureV1.js";
import { MENU_CONSTITUTION_VERSION } from "../../src/intelligence/constitution.js";
import { isConstitutionCompatiblePolicy } from "../../src/intelligence/constitution.js";

describe("MENU_PLATFORM_ARCHITECTURE_V1", () => {
  it("exposes frozen version markers", () => {
    expect(MENU_PLATFORM_ARCHITECTURE_VERSION).toBe(
      "MENU_PLATFORM_ARCHITECTURE_V1",
    );
    expect(MENU_PLATFORM_ARCHITECTURE_V1.constitutionVersion).toBe(
      MENU_CONSTITUTION_VERSION,
    );
    expect(CORE_PIPELINE_VERSION).toBe("MenuCorePipelineV1");
    expect(CAPABILITY_MATRIX_VERSION).toBe("TahCapabilityMatrixV1");
    expect(
      MENU_PLATFORM_ARCHITECTURE_V1.activeGlobalPolicies,
    ).toContain("CATEGORY_QUALIFIED_PRODUCT_NAME_V1");
  });

  it("keeps MENU_AS_VARIANT impossible to activate", () => {
    expect(isConstitutionCompatiblePolicy("MENU_AS_VARIANT")).toBe(false);
  });
});
