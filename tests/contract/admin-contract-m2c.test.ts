import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADMIN_CONTRACT_V1,
  assertNoWriteCapabilitiesCertified,
  finalVariantPriceOre,
  isMilestone3WriteReady,
  parseAdminPriceToOre,
} from "../../src/tah/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = JSON.parse(
  readFileSync(
    join(root, "fixtures/admin-contracts/v1/m2c-semantics-evidence.json"),
    "utf8",
  ),
) as {
  m2bCommit: string;
  nonDefaultVariantProofs: Array<{
    product: string;
    adminBaseKr: number;
    cases: Array<{
      variant: string;
      adminVariantKr: number;
      publicFinalKr: number;
      equation: string;
    }>;
    cartMutated: boolean;
  }>;
  liveReadProduct: {
    products: Array<{
      databaseId: string;
      menuNumber: string;
      pass: boolean;
    }>;
  };
};

describe("M2C non-default variant surcharge proof", () => {
  it("certifies SURCHARGE using observed public finals for Deep/Fam", () => {
    expect(ADMIN_CONTRACT_V1.semantics.variantPriceSemantics.value).toBe(
      "SURCHARGE",
    );
    expect(ADMIN_CONTRACT_V1.semantics.variantPriceSemantics.evidence).toBe(
      "TESTED",
    );
    expect(evidence.m2bCommit).toBe("11c83cf");

    for (const product of evidence.nonDefaultVariantProofs) {
      expect(product.cartMutated).toBe(false);
      for (const c of product.cases) {
        expect(c.adminVariantKr).toBeGreaterThan(0);
        expect(product.adminBaseKr + c.adminVariantKr).toBe(c.publicFinalKr);
        const baseOre = parseAdminPriceToOre(String(product.adminBaseKr))!;
        const varOre = parseAdminPriceToOre(String(c.adminVariantKr))!;
        expect(finalVariantPriceOre(baseOre, varOre, "SURCHARGE")).toBe(
          c.publicFinalKr * 100,
        );
        // Absolute would NOT match public final for non-zero variants
        expect(finalVariantPriceOre(baseOre, varOre, "ABSOLUTE_TOTAL")).not.toBe(
          c.publicFinalKr * 100,
        );
      }
    }
  });

  it("records live readProduct PASS including alphanumeric menu number", () => {
    expect(evidence.liveReadProduct.products.every((p) => p.pass)).toBe(true);
    const alpha = evidence.liveReadProduct.products.find(
      (p) => p.menuNumber === "45A",
    );
    expect(alpha?.databaseId).toBe("4");
    expect(alpha?.menuNumber).toBe("45A");
  });

  it("keeps WRITE uncertified while M3 readiness semantics gate passes", () => {
    assertNoWriteCapabilitiesCertified(ADMIN_CONTRACT_V1.capabilities);
    expect(
      isMilestone3WriteReady({
        variantPriceSemantics:
          ADMIN_CONTRACT_V1.semantics.variantPriceSemantics.value,
        capabilities: ADMIN_CONTRACT_V1.capabilities,
      }),
    ).toBe(true);
    expect(ADMIN_CONTRACT_V1.capabilities.write.createProduct).toBe(
      "UNCERTIFIED",
    );
  });

  it("defines addition prices as customer-paid additional amounts", () => {
    expect(ADMIN_CONTRACT_V1.semantics.additionPriceSemantics.value).toBe(
      "ABSOLUTE_ADDON_PRICE",
    );
    expect(ADMIN_CONTRACT_V1.semantics.additionPriceSemantics.notes).toMatch(
      /additional amount/i,
    );
  });
});
