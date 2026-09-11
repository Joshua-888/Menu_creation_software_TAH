/**
 * Typed CanonicalMenu transforms for price / variant / addition decisions.
 */

import type {
  CanonicalAddOn,
  CanonicalMenu,
  CanonicalProduct,
} from "../domain/schema/canonical.js";
import type { AdditionDefinition } from "./facts.js";
import { interpretAlmFamilieTotals } from "./priceSemantics.js";
import { applyProductChoiceSpec } from "./transforms.js";

export function applyPriceCorrection(input: {
  menu: CanonicalMenu;
  menuNumber: string;
  correctedBaseMinor: number;
}): { menu: CanonicalMenu; changed: boolean; note: string } {
  return {
    menu: mapProduct(input.menu, input.menuNumber, (p) => ({
      ...p,
      basePrice: input.correctedBaseMinor,
      basePriceOrigin: "HUMAN_CORRECTION" as const,
      evidence: p.evidence
        ? {
            ...p.evidence,
            rawText:
              `${p.evidence.rawText ?? ""} || [price-correction:${input.correctedBaseMinor}]`.slice(
                0,
                900,
              ),
          }
        : p.evidence,
    })),
    changed: true,
    note: `PRICE_CORRECTION → basePrice ${input.correctedBaseMinor}`,
  };
}

export function applyAlmFamilieSemantics(input: {
  menu: CanonicalMenu;
  menuNumber: string;
  almTotalKroner: number;
  familieTotalKroner: number;
}): { menu: CanonicalMenu; changed: boolean; note: string; blocked?: string } {
  const interp = interpretAlmFamilieTotals({
    almTotalKroner: input.almTotalKroner,
    familieTotalKroner: input.familieTotalKroner,
  });
  if (!interp.reconciled) {
    return {
      menu: input.menu,
      changed: false,
      note: "ARITHMETIC_MISMATCH",
      blocked: "ARITHMETIC_MISMATCH",
    };
  }
  return {
    menu: mapProduct(input.menu, input.menuNumber, (p) => ({
      ...p,
      basePrice: interp.basePriceMinor,
      basePriceOrigin: "DERIVED" as const,
      variants: [
        {
          sourceId: `${p.sourceId}::v-alm`,
          name: "Alm.",
          nameOrigin: "SOURCE" as const,
          surcharge: 0,
          surchargeOrigin: "DERIVED" as const,
          isBase: true,
          sourceTotalPrice: interp.basePriceMinor,
        },
        {
          sourceId: `${p.sourceId}::v-familie`,
          name: "Familie",
          nameOrigin: "SOURCE" as const,
          surcharge: interp.familieSurchargeMinor,
          surchargeOrigin: "DERIVED" as const,
          isBase: false,
          sourceTotalPrice:
            interp.basePriceMinor + interp.familieSurchargeMinor,
        },
      ],
    })),
    changed: true,
    note: `Alm/Familie → base ${interp.basePriceMinor}, Familie +${interp.familieSurchargeMinor}`,
  };
}

export function applyAdditionSetDecision(input: {
  menu: CanonicalMenu;
  menuNumber: string;
  additions: AdditionDefinition[];
}): { menu: CanonicalMenu; changed: boolean; note: string } {
  return {
    menu: mapProduct(input.menu, input.menuNumber, (p) => {
      const addOns: CanonicalAddOn[] = input.additions.map((a, idx) => ({
        sourceId: `${p.sourceId}::addon-learned-${idx}`,
        name: a.name,
        ...(a.priceMinor != null ? { price: a.priceMinor } : {}),
        origin:
          a.origin === "SOURCE"
            ? ("SOURCE" as const)
            : a.origin === "HUMAN_CORRECTION" ||
                a.origin === "HUMAN_PROVIDED_BUSINESS_FACT"
              ? ("HUMAN_CORRECTION" as const)
              : ("DERIVED" as const),
      }));
      return { ...p, addOns };
    }),
    changed: true,
    note: `ADDITION_SET → ${input.additions.map((a) => a.name).join(", ")}`,
  };
}

export function applyChoiceOptionDecision(input: {
  menu: CanonicalMenu;
  menuNumber: string;
  prompt: string;
  options: string[];
  required?: boolean;
  minSelections?: number;
  maxSelections?: number;
}): { menu: CanonicalMenu; changed: boolean; note: string } {
  const menu = applyProductChoiceSpec(input.menu, input.menuNumber, {
    prompt: input.prompt,
    required: input.required ?? true,
    minSelections: input.minSelections ?? 1,
    maxSelections: input.maxSelections ?? 1,
    options: input.options,
  });
  return {
    menu,
    changed: true,
    note: `PRODUCT_CHOICE_OPTIONS → ${input.options.join(", ")}`,
  };
}

/**
 * WritePlan money gate: required prices/additions must be resolved.
 */
export function assertMoneyFieldsResolvedForWrite(input: {
  products: Array<{
    sourceId: string;
    menuNumber?: string;
    basePrice?: number;
    addOns: Array<{ name: string; price?: number }>;
    requireAdditionPrices?: boolean;
  }>;
}): void {
  const errors: string[] = [];
  for (const p of input.products) {
    if (p.basePrice === undefined) {
      errors.push(`${p.sourceId}: missing basePrice`);
    }
    if (p.requireAdditionPrices !== false) {
      for (const a of p.addOns) {
        if (a.price === undefined) {
          errors.push(`${p.sourceId}: addition "${a.name}" missing price`);
        }
      }
    }
  }
  if (errors.length) {
    throw new Error(`WRITEPLAN_BLOCKED_UNRESOLVED_MONEY: ${errors.join("; ")}`);
  }
}

function mapProduct(
  menu: CanonicalMenu,
  menuNumber: string,
  fn: (p: CanonicalProduct) => CanonicalProduct,
): CanonicalMenu {
  return {
    ...menu,
    categories: menu.categories.map((c) => ({
      ...c,
      products: c.products.map((p) =>
        p.sourceMenuNumber === menuNumber ? fn(p) : p,
      ),
    })),
  };
}
