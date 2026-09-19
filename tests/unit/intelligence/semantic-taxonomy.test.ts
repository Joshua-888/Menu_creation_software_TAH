/**
 * WP1 — Semantic Completeness taxonomy foundation.
 *
 * Verifies the additive type surface + unified `EntityClassifier` barrel exist
 * and behave identically to the existing predicates (behavioral parity, not
 * new behavior). No runtime logic is exercised here.
 */

import { describe, expect, it } from "vitest";
import {
  classifyPhrase,
  isInvalidProductNameEntity,
  isInvalidIngredientEntity,
  isInvalidAdditionEntity,
} from "../../../src/intelligence/semanticClassifier.js";
import { EntityClassifier } from "../../../src/intelligence/semanticClassifier.js";
import type {
  SemanticProvenanceTier,
  FieldRequirementLevel,
  FieldSufficiencyStatus,
  FieldCompletenessTrace,
} from "../../../src/intelligence/types.js";
import type { SemanticEntityType } from "../../../src/intelligence/types.js";

const ALL_ENTITY_TYPES: SemanticEntityType[] = [
  "PRODUCT_NAME",
  "CATEGORY",
  "INGREDIENT",
  "ADDITION",
  "VARIANT",
  "PRODUCT_CHOICE",
  "COMBO_COMPONENT",
  "COMBO_CONTEXT",
  "META_INSTRUCTION",
  "PRICE",
  "DESCRIPTION_TEXT",
  "UNKNOWN",
];

describe("WP1 semantic completeness taxonomy", () => {
  it("exposes the EntityClassifier barrel with the existing predicates", () => {
    expect(EntityClassifier.isInvalidProductName).toBe(isInvalidProductNameEntity);
    expect(EntityClassifier.isInvalidIngredient).toBe(isInvalidIngredientEntity);
    expect(EntityClassifier.isInvalidAddition).toBe(isInvalidAdditionEntity);
    expect(EntityClassifier.classifyPhrase).toBe(classifyPhrase);
  });

  it("EntityClassifier delegates with behavioral parity for all entity types", () => {
    for (const entityType of ALL_ENTITY_TYPES) {
      expect(EntityClassifier.isInvalidProductName(entityType)).toBe(
        isInvalidProductNameEntity(entityType),
      );
      expect(EntityClassifier.isInvalidIngredient(entityType)).toBe(
        isInvalidIngredientEntity(entityType),
      );
      expect(EntityClassifier.isInvalidAddition(entityType)).toBe(
        isInvalidAdditionEntity(entityType),
      );
    }
  });

  it("classifyPhrases matches classifyPhrase per phrase", () => {
    const phrases = ["Tomat", "Pizza", "99", "Vælg mellem", ""];
    const singular = phrases.map((p) => classifyPhrase(p));
    const batch = EntityClassifier.classifyPhrases(phrases);
    expect(batch).toEqual(singular);
  });

  it("FieldCompletenessTrace accepts the documented shape", () => {
    const tier: SemanticProvenanceTier = "EXACT_PRODUCT_FACT";
    const requirementLevel: FieldRequirementLevel = "EXPECTED";
    const status: FieldSufficiencyStatus = "SUFFICIENT";
    const trace: FieldCompletenessTrace = {
      field: "ingredients",
      requirementLevel,
      initialStatus: "INSUFFICIENT",
      evidenceConsidered: ["SOURCE", tier],
      selectedTier: tier,
      selectedValue: ["tomat", "ost"],
      rejectedCandidates: [
        { value: ["skinke"], tier: "PEER_FAMILY", reason: "lower_tier_evidence" },
      ],
      confidence: 0.9,
      finalStatus: status,
    };
    expect(trace.selectedTier).toBe("EXACT_PRODUCT_FACT");
    expect(trace.finalStatus).toBe("SUFFICIENT");
  });
});
