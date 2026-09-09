import { describe, expect, it } from "vitest";
import { kronerToOre } from "../../src/domain/money.js";
import { priceVariants } from "../../src/domain/pricing.js";
import { selectBaseVariant } from "../../src/domain/variants.js";
import { variant } from "./helpers.js";

describe("selectBaseVariant", () => {
  it("matches Alm aliases after punctuation normalization", () => {
    const variants = [
      variant("v1", "Alm."),
      variant("v2", "Familie", { totalKroner: 180 }),
    ];
    variants[0]!.sourceTotalPrice = kronerToOre(100);
    const result = selectBaseVariant("p1", variants);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.variantSourceId).toBe("v1");
    }
  });

  it("matches Almindelig / Standard / Normal / Regular", () => {
    for (const name of ["Alm", "Almindelig", "Standard", "Normal", "Regular"]) {
      const result = selectBaseVariant("p1", [
        variant("base", name, { totalKroner: 90 }),
        variant("big", "Familie", { totalKroner: 150 }),
      ]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.variantSourceId).toBe("base");
    }
  });

  it("uses Lille as base in Lille/Mellem/Stor hierarchy", () => {
    const result = selectBaseVariant("p1", [
      variant("s", "Stor", { totalKroner: 120 }),
      variant("l", "Lille", { totalKroner: 80 }),
      variant("m", "Mellem", { totalKroner: 100 }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.variantSourceId).toBe("l");
  });

  it("flags ambiguous unknown hierarchies", () => {
    const result = selectBaseVariant("p1", [
      variant("a", "Deep", { totalKroner: 110 }),
      variant("b", "Family", { totalKroner: 170 }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("AMBIGUOUS_BASE_VARIANT");
    }
  });
});

describe("priceVariants", () => {
  it("computes surcharges from source totals product-specifically", () => {
    const variants = [
      variant("alm", "Alm.", { totalKroner: 90 }),
      variant("deep", "Deep", { totalKroner: 110 }),
      variant("fam", "Family", { totalKroner: 170 }),
    ];
    const priced = priceVariants("marg", variants, "alm");
    expect(priced.basePrice).toBe(kronerToOre(90));
    expect(priced.variants.find((v) => v.sourceId === "deep")?.surcharge).toBe(
      kronerToOre(20),
    );
    expect(priced.variants.find((v) => v.sourceId === "fam")?.surcharge).toBe(
      kronerToOre(80),
    );
  });

  it("uses explicit surcharge without subtracting base", () => {
    const variants = [
      variant("alm", "Alm.", { totalKroner: 100 }),
      variant("fam", "Familie", { explicitSurchargeKroner: 80 }),
    ];
    const priced = priceVariants("p1", variants, "alm");
    expect(priced.variants.find((v) => v.sourceId === "fam")?.surcharge).toBe(
      kronerToOre(80),
    );
  });

  it("raises SOURCE_PRICE_CONFLICT when total and explicit disagree", () => {
    const variants = [
      variant("alm", "Alm.", { totalKroner: 100 }),
      {
        ...variant("fam", "Familie", { totalKroner: 200, explicitSurchargeKroner: 80 }),
      },
    ];
    const priced = priceVariants("p1", variants, "alm");
    expect(
      priced.issues.some((i) => i.code === "SOURCE_PRICE_CONFLICT"),
    ).toBe(true);
  });

  it("injects Alm. system default when no variants", () => {
    const priced = priceVariants("p1", [], "p1::system-default-alm", {
      injectedDefaultAlm: true,
    });
    expect(priced.variants).toHaveLength(1);
    expect(priced.variants[0]?.name).toBe("Alm.");
    expect(priced.variants[0]?.surcharge).toBe(0);
    expect(priced.variants[0]?.nameOrigin).toBe("SYSTEM_DEFAULT");
  });
});
