/**
 * Typed CanonicalMenu transforms driven by decision resolutions.
 * AI must not mutate CanonicalMenu arbitrarily — only these transforms.
 */

import type {
  CanonicalMenu,
  CanonicalProduct,
  CanonicalProductChoice,
} from "../domain/schema/canonical.js";
import {
  choiceOptionSourceId,
  VERONI_VAELG_SELV_OPTIONS,
} from "./choiceLanguage.js";

export type DecisionTransformKind =
  | "MENU_AS_VARIANT" // SUPERSEDED — maps to no-op strip; use MENU_IS_COMBO_NOT_VARIANT
  | "MENU_IS_COMBO_NOT_VARIANT"
  | "PRODUCT_CHOICE"
  | "INGREDIENT"
  | "CATEGORY_MAPPING"
  | "NOOP";

export type ProductChoiceSpec = {
  prompt: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: string[];
};

export function mapResolutionToTransform(
  resolution: string,
  optionId: string,
): DecisionTransformKind {
  const id = optionId.toLowerCase();
  const res = resolution.toLowerCase();
  if (
    res.includes("menu_is_combo") ||
    res.includes("combo_not_variant") ||
    id === "combo" ||
    id === "menuer"
  ) {
    return "MENU_IS_COMBO_NOT_VARIANT";
  }
  // Legacy resolutions — superseded; never re-activate Menu-as-variant behavior
  if (id === "variant" || res.includes("menu_as_variant") || res.includes("priced variant")) {
    return "MENU_IS_COMBO_NOT_VARIANT";
  }
  if (id === "product-choice" || res.includes("product_choice")) {
    return "PRODUCT_CHOICE";
  }
  if (id === "ingredient" || res.includes("ingredient")) {
    return "INGREDIENT";
  }
  if (id.includes("pasta") || id.includes("map") || res.includes("category")) {
    return "CATEGORY_MAPPING";
  }
  return "NOOP";
}

/**
 * Apply a resolution structurally. Does NOT invent Menu contents / prices.
 */
export function applyDecisionTransform(input: {
  menu: CanonicalMenu;
  menuNumber: string;
  kind: DecisionTransformKind;
  optionId: string;
  choiceSpec?: ProductChoiceSpec;
}): {
  menu: CanonicalMenu;
  changed: boolean;
  note: string;
} {
  const products = input.menu.categories.flatMap((c) =>
    c.products.map((p) => ({ cat: c, p })),
  );
  const hit = products.find((x) => x.p.sourceMenuNumber === input.menuNumber);
  if (!hit) {
    return { menu: input.menu, changed: false, note: "product not found" };
  }

  switch (input.kind) {
    case "MENU_AS_VARIANT":
    case "MENU_IS_COMBO_NOT_VARIANT":
      return {
        menu: input.menu,
        changed: false,
        note: "MENU_IS_COMBO_NOT_VARIANT (MenuConstitutionV1): Menu is combo/Menuer — never a variant; contents not invented",
      };
    case "PRODUCT_CHOICE": {
      if (input.choiceSpec) {
        return {
          menu: applyProductChoiceSpec(
            input.menu,
            input.menuNumber,
            input.choiceSpec,
          ),
          changed: true,
          note: `PRODUCT_CHOICE: ${input.choiceSpec.prompt} → [${input.choiceSpec.options.join(", ")}]`,
        };
      }
      return {
        menu: annotateProduct(input.menu, input.menuNumber, {
          decisionAnnotation: "PRODUCT_CHOICE",
          optionId: input.optionId,
        }),
        changed: true,
        note: "PRODUCT_CHOICE annotated on product",
      };
    }
    case "INGREDIENT":
      return {
        menu: annotateProduct(input.menu, input.menuNumber, {
          decisionAnnotation: "INGREDIENT",
          optionId: input.optionId,
        }),
        changed: true,
        note: "INGREDIENT: treat slash/eller text as ingredients (annotation)",
      };
    case "CATEGORY_MAPPING":
      return {
        menu: input.menu,
        changed: false,
        note: "CATEGORY_MAPPING recorded for planning layer; createCategory still capability-gated",
      };
    default:
      return { menu: input.menu, changed: false, note: "NOOP" };
  }
}

/** Veroni operator-authoritative Vælg selv filling choice. */
export function veroniVaelgSelvChoiceSpec(): ProductChoiceSpec {
  return {
    prompt: "Vælg selv",
    required: true,
    minSelections: 1,
    maxSelections: 1,
    options: [...VERONI_VAELG_SELV_OPTIONS],
  };
}

export function applyProductChoiceSpec(
  menu: CanonicalMenu,
  menuNumber: string,
  spec: ProductChoiceSpec,
): CanonicalMenu {
  const promptSlug = spec.prompt
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return {
    ...menu,
    categories: menu.categories.map((c) => ({
      ...c,
      products: c.products.map((p) => {
        if (p.sourceMenuNumber !== menuNumber) return p;
        const choice: CanonicalProductChoice = {
          sourceId: `${p.sourceId}::choice-${promptSlug || "vaelg"}`,
          prompt: spec.prompt,
          required: spec.required,
          minSelections: spec.minSelections,
          maxSelections: spec.maxSelections,
          options: spec.options.map((label) => ({
            productSourceId: choiceOptionSourceId(label),
            label,
          })),
        };
        // Replace prior ambiguous / choose / valg* / pending PRODUCT_CHOICE stubs
        const kept = p.productChoices.filter(
          (ch) =>
            !/valgfrit|ambiguous|pending|v[æa]lg|product_choice/i.test(
              ch.prompt,
            ) &&
            !/choice-ambiguous|choice-pending/i.test(ch.sourceId) &&
            ch.sourceId !== choice.sourceId,
        );
        const issues = (p.issues ?? []).filter(
          (i) => i.code !== "MISSING_SOURCE_SUPPORTED_INGREDIENTS",
        );
        // Choice options are the source-supported alternatives — clear that issue
        const stillManual = issues.some(
          (i) => i.severity === "MANUAL_REVIEW_REQUIRED",
        );
        const stillBlocked = issues.some((i) => i.severity === "BLOCKED");
        const status = stillBlocked
          ? ("BLOCKED" as const)
          : stillManual
            ? ("MANUAL_REVIEW_REQUIRED" as const)
            : ("READY" as const);
        return {
          ...p,
          productChoices: [...kept, choice],
          issues,
          status,
          evidence: p.evidence
            ? {
                ...p.evidence,
                rawText:
                  `${p.evidence.rawText ?? ""} || [decision:PRODUCT_CHOICE:${promptSlug}]`.slice(
                    0,
                    900,
                  ),
              }
            : p.evidence,
        } as CanonicalProduct;
      }),
    })),
  };
}

function annotateProduct(
  menu: CanonicalMenu,
  menuNumber: string,
  ann: { decisionAnnotation: string; optionId: string },
): CanonicalMenu {
  return {
    ...menu,
    categories: menu.categories.map((c) => ({
      ...c,
      products: c.products.map((p) =>
        p.sourceMenuNumber === menuNumber
          ? ({
              ...p,
              evidence: p.evidence
                ? {
                    ...p.evidence,
                    rawText: `${p.evidence.rawText ?? ""} || [decision:${ann.decisionAnnotation}:${ann.optionId}]`.slice(
                      0,
                      900,
                    ),
                  }
                : p.evidence,
            } as CanonicalProduct)
          : p,
      ),
    })),
  };
}

/**
 * WritePlan may only consume resolved decision states.
 */
export function assertDecisionsResolvedForWrite(input: {
  cases: Array<{ status: string; decisionCaseId: string }>;
}): void {
  const blocked = input.cases.filter((c) =>
    [
      "UNRESOLVED",
      "HUMAN_REVIEW_REQUIRED",
      "POLICY_CONFLICT",
      "BLOCKED",
    ].includes(c.status),
  );
  if (blocked.length) {
    throw new Error(
      `WRITEPLAN_BLOCKED_UNRESOLVED_DECISIONS: ${blocked.map((b) => `${b.decisionCaseId}=${b.status}`).join(", ")}`,
    );
  }
}
