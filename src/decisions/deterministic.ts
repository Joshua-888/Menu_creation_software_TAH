/**
 * Deterministic auto-resolution for strong source evidence.
 * Does not invent business facts (e.g. Veroni five fillings) — only structure
 * and source-enumerated options.
 */

import { classifyChoiceLanguageStrength } from "./choiceLanguage.js";
import type { DecisionCase, DecisionOutcome } from "./types.js";

export function tryDeterministicResolve(
  decisionCase: DecisionCase,
): DecisionOutcome | null {
  const { strength, markers, enumeratedOptions } =
    classifyChoiceLanguageStrength(decisionCase.sourceText);
  const type = String(decisionCase.decisionType);

  // MENU structure: BASE + Menu prices present — keep Menu as priced variant,
  // do not invent combo contents.
  if (
    type === "MENU_PRICE_OPTION_SEMANTICS" &&
    decisionCase.contextFeatures.priceStructure === "BASE_MENU"
  ) {
    const opt =
      decisionCase.availableOptions.find((o) => o.id === "variant") ??
      decisionCase.availableOptions[0];
    if (!opt) return null;
    return outcome(decisionCase, {
      status: "AUTO_RESOLVED_DETERMINISTIC",
      resolution: "MENU_AS_VARIANT",
      optionId: opt.id,
      method: "DETERMINISTIC",
      explanation:
        "DETERMINISTIC: BASE+Menu structure kept as priced Menu variant; contents not invented",
    });
  }

  // Explicit Pasta heading / create-pasta option — semantic only
  if (
    type === "DESTINATION_CATEGORY" &&
    (decisionCase.recommendedOptionId === "create-pasta" ||
      /pasta/i.test(decisionCase.sourceText) ||
      /pasta/i.test(decisionCase.productName) ||
      /pasta/i.test(decisionCase.currentCanonicalInterpretation))
  ) {
    const opt =
      decisionCase.availableOptions.find((o) => o.id === "create-pasta") ??
      decisionCase.availableOptions.find((o) => /pasta/i.test(o.id));
    if (opt) {
      return outcome(decisionCase, {
        status: "AUTO_RESOLVED_DETERMINISTIC",
        resolution: "CREATE_OR_MAP_CATEGORY_PASTA",
        optionId: opt.id,
        method: "DETERMINISTIC",
        explanation:
          "DETERMINISTIC: explicit source Pasta heading → semantic category Pasta (createCategory still capability-gated)",
      });
    }
  }

  if (type !== "PRODUCT_CHOICE") return null;

  // VALGFRIT / VAELG_SELV without an explicit source option list must NOT invent
  // options — restaurant BUSINESS_FACT / ACTIVE policy supplies the set.
  if (
    (markers.includes("VALGFRIT") || markers.includes("VAELG_SELV")) &&
    !markers.includes("VAELG_MELLEM") &&
    !markers.includes("ELLER")
  ) {
    return null;
  }

  // VERY STRONG: vælg mellem / eller with enumerated options from source
  if (
    strength === "VERY_STRONG" &&
    (markers.includes("VAELG_MELLEM") || markers.includes("ELLER")) &&
    enumeratedOptions.length >= 2
  ) {
    const opt =
      decisionCase.availableOptions.find((o) => o.id === "product-choice") ??
      decisionCase.availableOptions[0];
    if (!opt) return null;
    return outcome(decisionCase, {
      status: "AUTO_RESOLVED_DETERMINISTIC",
      resolution: "PRODUCT_CHOICE",
      optionId: opt.id,
      method: "DETERMINISTIC",
      explanation: `DETERMINISTIC: ${markers.join("+")} with source options [${enumeratedOptions.join(", ")}]`,
    });
  }

  // Slash-only: never deterministic
  if (strength === "WEAK" && markers.includes("SLASH") && !markers.includes("ELLER")) {
    return null;
  }

  return null;
}

function outcome(
  decisionCase: DecisionCase,
  partial: Omit<DecisionOutcome, "decisionCaseId" | "policyId" | "policyVersion" | "precedentIds" | "gate" | "reasoner" | "policyMatches">,
): DecisionOutcome {
  return {
    decisionCaseId: decisionCase.decisionCaseId,
    policyId: null,
    policyVersion: null,
    precedentIds: [],
    gate: {
      verdict: "AUTO_APPROVE",
      reasonCodes: ["DETERMINISTIC_SOURCE_EVIDENCE"],
      riskClass: decisionCase.riskClass,
    },
    reasoner: null,
    policyMatches: [],
    ...partial,
  };
}
