# Verification Architecture V1

Code: `src/runner/fieldAwareVerify.ts`, `compareProductFieldAware` in `executor.ts`

## Purpose

Decide whether destination equals intended TargetMenu/WritePlan payload **without** false failures on presentation-only differences, and **without** hiding factual errors.

## Comparison result kinds

| Kind | Meaning |
|------|---------|
| `EXACT_VALUE` | Normalized values equal under field policy |
| `REPRESENTATION_EQUIVALENT` | Presentation-only difference; **PASS** |
| `SEMANTIC_MISMATCH` | Factual difference; **FAIL** |

Representation normalization must **never** remove factual differences (missing ingredient, different protein/sauce, wrong price/choice/addition).

## Field policies

| Field | Policy |
|-------|--------|
| menu number | exact normalized identity |
| name | exact expected semantic / receipt-safe identity |
| category | exact intended category |
| money / base price | exact money (øre) |
| variants | structured equality |
| ingredients | canonical ingredient equality |
| description | ingredient-description semantic (`INGREDIENT_DESCRIPTION_SEMANTIC`) — e.g. “og” vs commas, casing |
| ProductChoices | structured equality when present |
| combo components | structured equality |
| additions | structured equality |
| addition prices | exact money |
| visibility | Skjult vs not-Skjult (`VISIBILITY_EXACT`) |

## Evidence

- BELLA-010: TargetMenu `"…ketchup og mayo"` vs stored `"…Ketchup, Mayo"` → REPRESENTATION_EQUIVALENT (adapter `description_hygiene`), not fail.
- Tests: `tests/unit/field-aware-verify.test.ts`

## Menu-level verification

After per-product PASS:

- expected/actual product counts
- missing / unexpected / duplicates = 0
- TargetMenu equality PASS
- receipt-safe name check menu-wide where applicable
