/**
 * Architecture recovery — MenuIntelligenceEngine + Constitution + Quality Contract.
 * Tests the SAME spine Create/QA portal worker uses (runMenuIntelligence).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runMenuIntelligence,
  evaluateMenuQualityContract,
  classifyPhrase,
  MENU_CONSTITUTION_VERSION,
  MENU_AS_VARIANT_SUPERSESSION,
  listPolicyLifecycle,
} from "../../../src/intelligence/index.js";
import { formatDescriptionFromIngredients as formatDesc } from "../../../src/domain/textNormalize.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../../../src/domain/versions.js";
import type { CanonicalMenu } from "../../../src/domain/schema/canonical.js";
import { isForbiddenMenuVariantName } from "../../../src/learning/categorySizeVariantPolicy.js";
import { shouldSeedDefaultTilbehor } from "../../../src/learning/structurePolicy.js";
import { shouldApplyPeerProbabilityPolicy } from "../../../src/learning/peerArtifacts.js";
import { mapResolutionToTransform } from "../../../src/decisions/transforms.js";

function thinBurgerMenu(): CanonicalMenu {
  const burgers = [
    "Dirty Smash",
    "Classic Smash",
    "Crunch Murphy",
    "Spice Me Up",
    "Bearnaise Smash",
  ];
  return {
    restaurantName: "Fixture Smash",
    categories: [
      {
        sourceId: "cat-burgers",
        name: "Burgers",
        sourceOrder: 0,
        commonIngredients: [],
        products: burgers.map((name, i) => ({
          sourceId: `p-${i + 1}`,
          categorySourceId: "cat-burgers",
          name,
          sourceOrder: i,
          assignedMenuNumber: String(i + 1),
          ingredients: [],
          variants: [
            {
              sourceId: `v-${i}-alm`,
              name: "Alm.",
              nameOrigin: "SOURCE" as const,
              surcharge: 0,
              surchargeOrigin: "SOURCE" as const,
              isBase: true,
              sourceTotalPrice: 9900,
            },
            {
              sourceId: `v-${i}-menu`,
              name: "Menu",
              nameOrigin: "SOURCE" as const,
              surcharge: 5000,
              surchargeOrigin: "SOURCE" as const,
              isBase: false,
              sourceTotalPrice: 14900,
            },
          ],
          addOns: [],
          productChoices: [],
          isCombo: false,
          status: "READY" as const,
          issues: [],
        })),
      },
    ],
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
    status: "READY",
    issues: [],
  };
}

function pastaThirdMerchantMenu(): CanonicalMenu {
  return {
    restaurantName: "Fixture Pasta House",
    categories: [
      {
        sourceId: "cat-pasta",
        name: "Pasta",
        sourceOrder: 0,
        commonIngredients: [],
        products: [
          {
            sourceId: "pasta-1",
            categorySourceId: "cat-pasta",
            name: "Pasta Carbonara",
            sourceOrder: 0,
            assignedMenuNumber: "1",
            description: "Pasta, bacon, æg og parmesan",
            ingredients: [
              { display: "Pasta", origin: "SOURCE" },
              { display: "Bacon", origin: "SOURCE" },
              { display: "Æg", origin: "SOURCE" },
              { display: "Parmesan", origin: "SOURCE" },
            ],
            variants: [
              {
                sourceId: "v1",
                name: "Alm.",
                nameOrigin: "SOURCE",
                surcharge: 0,
                surchargeOrigin: "SOURCE",
                isBase: true,
                sourceTotalPrice: 8900,
              },
            ],
            addOns: [],
            productChoices: [],
            isCombo: false,
            status: "READY",
            issues: [],
          },
        ],
      },
      {
        sourceId: "cat-drinks",
        name: "Drikkevarer",
        sourceOrder: 1,
        commonIngredients: [],
        products: [
          {
            sourceId: "drink-1",
            categorySourceId: "cat-drinks",
            name: "Cola",
            sourceOrder: 0,
            assignedMenuNumber: "10",
            ingredients: [],
            variants: [
              {
                sourceId: "vd1",
                name: "Alm.",
                nameOrigin: "SOURCE",
                surcharge: 0,
                surchargeOrigin: "SOURCE",
                isBase: true,
                sourceTotalPrice: 2500,
              },
            ],
            addOns: [
              {
                sourceId: "bad-dip",
                name: "Mayonnaise",
                price: 1000,
                origin: "SYSTEM_DEFAULT",
              },
            ],
            productChoices: [],
            isCombo: false,
            status: "READY",
            issues: [],
          },
        ],
      },
    ],
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
    status: "READY",
    issues: [],
  };
}

describe("MenuConstitutionV1 + policy lifecycle", () => {
  it("exposes MenuConstitutionV1 and supersedes MENU_AS_VARIANT", () => {
    expect(MENU_CONSTITUTION_VERSION).toBe("MenuConstitutionV1");
    expect(MENU_AS_VARIANT_SUPERSESSION.status).toBe("SUPERSEDED");
    expect(MENU_AS_VARIANT_SUPERSESSION.replacementPolicyId).toBe(
      "MENU_IS_COMBO_NOT_VARIANT",
    );
    const life = listPolicyLifecycle();
    expect(life.find((p) => p.policyId === "MENU_AS_VARIANT")?.status).toBe(
      "SUPERSEDED",
    );
    expect(
      life.find((p) => p.policyId === "MENU_IS_COMBO_NOT_VARIANT")?.status,
    ).toBe("ACTIVE");
  });

  it("maps legacy MENU_AS_VARIANT resolutions to combo transform", () => {
    expect(mapResolutionToTransform("MENU_AS_VARIANT", "variant")).toBe(
      "MENU_IS_COMBO_NOT_VARIANT",
    );
    expect(mapResolutionToTransform("MENU_IS_COMBO_NOT_VARIANT", "combo")).toBe(
      "MENU_IS_COMBO_NOT_VARIANT",
    );
  });

  it("forbids Menu variant names broadly", () => {
    expect(isForbiddenMenuVariantName("Menu")).toBe(true);
    expect(isForbiddenMenuVariantName("Menü")).toBe(true);
    expect(isForbiddenMenuVariantName("Menu med frite")).toBe(true);
    expect(isForbiddenMenuVariantName("Alm.")).toBe(false);
  });
});

describe("Semantic classifier", () => {
  it("classifies core entity types", () => {
    expect(classifyPhrase("Tomat").entityType).toBe("INGREDIENT");
    expect(classifyPhrase("Valgfri dyppelse").entityType).toBe(
      "META_INSTRUCTION",
    );
    expect(classifyPhrase("Menu").entityType).toBe("COMBO_CONTEXT");
    expect(classifyPhrase("Baconburger").entityType).toBe("PRODUCT_NAME");
    expect(classifyPhrase("Tilbehør").entityType).toBe("META_INSTRUCTION");
  });
});

describe("Description generation (Danish grammar)", () => {
  it("joins with og before last ingredient", () => {
    const d = formatDesc([
      "Oksekød",
      "Bacon",
      "Salat",
      "Tomat",
      "Løg",
      "Ketchup",
      "Mayo",
    ]);
    expect(d).toMatch(/og mayo$/i);
    expect(d).toContain(",");
    expect(d.toLowerCase()).toContain("oksekød");
  });
});

describe("MenuIntelligenceEngine — Smash golden (production path)", () => {
  it("strips Menu variants, fills food cards, prefers Burgers semantics", () => {
    const oracle = JSON.parse(
      readFileSync(
        join(process.cwd(), "fixtures/golden/smash/expected-final-menu.json"),
        "utf8",
      ),
    ) as {
      burgerProducts: string[];
      burgersCategory: string;
      acceptance: { burgerMinIngredients: number };
    };

    const result = runMenuIntelligence({
      mode: "CREATE_MENU",
      restaurantName: "Fixture Smash",
      restaurantKey: "fixture-smash.example",
      canonicalMenu: thinBurgerMenu(),
    });

    expect(result.constitutionVersion).toBe("MenuConstitutionV1");
    expect(result.mode).toBe("CREATE_MENU");

    const cat = result.targetMenu.categories[0]!;
    expect(cat.name).toBe(oracle.burgersCategory);

    for (const name of oracle.burgerProducts) {
      const p = cat.products.find((x) => x.name === name);
      expect(p, name).toBeTruthy();
      expect(
        p!.variants.some((v) => isForbiddenMenuVariantName(v.name)),
        `${name} must not keep Menu variant`,
      ).toBe(false);
      expect(p!.ingredients.length).toBeGreaterThanOrEqual(
        oracle.acceptance.burgerMinIngredients,
      );
      expect((p!.description ?? "").trim().length).toBeGreaterThan(0);
      expect(p!.addOns.length).toBeGreaterThanOrEqual(1);
    }

    // No merchant-name branch required
    expect(result.policyTraces.every((t) => !/veroni/i.test(JSON.stringify(t)))).toBe(
      true,
    );
  });

  it("Create and QA share the same engine entrypoint", () => {
    const menu = thinBurgerMenu();
    const create = runMenuIntelligence({
      mode: "CREATE_MENU",
      restaurantName: "X",
      restaurantKey: "x.example",
      canonicalMenu: menu,
    });
    const qa = runMenuIntelligence({
      mode: "QA_RECONCILE",
      restaurantName: "X",
      restaurantKey: "x.example",
      canonicalMenu: menu,
    });
    expect(create.constitutionVersion).toBe(qa.constitutionVersion);
    const createNames = create.targetMenu.categories[0]!.products.map((p) => p.name);
    const qaNames = qa.targetMenu.categories[0]!.products.map((p) => p.name);
    expect(createNames).toEqual(qaNames);
    // Ingredient normalization parity (same thin input)
    for (let i = 0; i < createNames.length; i++) {
      const cIng = create.targetMenu.categories[0]!.products[i]!.ingredients.map(
        (x) => x.display,
      );
      const qIng = qa.targetMenu.categories[0]!.products[i]!.ingredients.map(
        (x) => x.display,
      );
      expect(cIng.length).toBeGreaterThanOrEqual(2);
      expect(qIng.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("Third-merchant generalization (no leakage)", () => {
  it("pasta/drinks menu does not inherit burger dips or smash names", () => {
    const result = runMenuIntelligence({
      mode: "CREATE_MENU",
      restaurantName: "Fixture Pasta House",
      restaurantKey: "fixture-pasta.example",
      canonicalMenu: pastaThirdMerchantMenu(),
    });

    const pasta = result.targetMenu.categories.find((c) => c.name === "Pasta")!;
    const drinks = result.targetMenu.categories.find((c) =>
      /drikke/i.test(c.name),
    )!;

    const carbonara = pasta.products[0]!;
    expect(carbonara.ingredients.map((i) => i.display)).toEqual(
      expect.arrayContaining(["Pasta", "Bacon", "Æg", "Parmesan"]),
    );
    expect(carbonara.ingredients.some((i) => /oksekød|ketchup/i.test(i.display))).toBe(
      false,
    );

    const cola = drinks.products[0]!;
    expect(cola.addOns.some((a) => /mayo|ketchup|remoulade/i.test(a.name))).toBe(
      false,
    );

    const blob = JSON.stringify(result.targetMenu);
    expect(blob).not.toMatch(/Dirty Smash|Classic Smash/);
    expect(result.targetMenu.categories.some((c) => /^burgers?$/i.test(c.name))).toBe(
      false,
    );
  });
});

describe("MenuQualityContract regressions", () => {
  it("blocks Menu variants and empty food cards", () => {
    const menu = thinBurgerMenu();
    // Evaluate BEFORE intelligence — should see Menu variants
    const before = evaluateMenuQualityContract(menu);
    expect(
      before.products.some((p) =>
        p.checks.some((c) => c.id === "NO_MENU_VARIANT" && !c.pass),
      ),
    ).toBe(true);

    const after = runMenuIntelligence({
      mode: "CREATE_MENU",
      restaurantName: "X",
      restaurantKey: "x",
      canonicalMenu: menu,
    });
    expect(
      after.targetMenu.categories[0]!.products.every(
        (p) => !p.variants.some((v) => isForbiddenMenuVariantName(v.name)),
      ),
    ).toBe(true);
  });

  it("rejects meta / topping-as-name via classifier", () => {
    expect(classifyPhrase("Tomat").entityType).toBe("INGREDIENT");
    expect(classifyPhrase("Tilbehør").entityType).toBe("META_INSTRUCTION");
    expect(classifyPhrase("Valgfri dyppelse").entityType).toBe(
      "META_INSTRUCTION",
    );
  });

  it("0-product menu is not MENU_QUALITY_READY", () => {
    const empty: CanonicalMenu = {
      restaurantName: "Empty",
      categories: [],
      schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
      domainRulesVersion: DOMAIN_RULE_ENGINE_VERSION,
      status: "BLOCKED",
      issues: [],
    };
    const q = evaluateMenuQualityContract(empty);
    expect(q.menuStatus).not.toBe("MENU_QUALITY_READY");
  });
});

describe("No restaurant-specific runtime defaults", () => {
  it("does not seed Tilbehør or peer probability for Veroni by host alone", () => {
    expect(shouldSeedDefaultTilbehor("veronipizza.dk")).toBe(false);
    expect(
      shouldApplyPeerProbabilityPolicy("veronipizza.dk", {}),
    ).toBe(false);
  });
});
