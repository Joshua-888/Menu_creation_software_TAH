# Quality Contract Registry V1

Code: `src/intelligence/qualityContract.ts`, `sourceCoverage.ts`  
Only `QUALITY_READY` products enter executable CREATE/UPDATE.

## Statuses

| Status | Meaning |
|--------|---------|
| QUALITY_READY | Safe to write |
| QUALITY_REVIEW | Needs operator; never auto-write |
| QUALITY_BLOCKED | Must not write |

Menu roll-up: `MENU_QUALITY_READY` / review / blocked accounting → READY / REVIEW / BLOCK counts.

## Checks

| Check | Prevents | Level | Typical effect | Tests |
|-------|----------|-------|----------------|-------|
| `PRODUCT_NAME_VALID` | Garbage / ingredient-only names READY | product | BLOCK/REVIEW | quality-contract, label-quality |
| `PRODUCT_NAME_RECEIPT_SAFE` | Ambiguous receipt names (Pita/Durum/…) | product | REVIEW until qualified | naming policy tests |
| `CATEGORY_SEMANTIC_FIT` | Wrong family/category placement | product | REVIEW/BLOCK | quality-contract |
| `DESCRIPTION_PROFESSIONAL` | OCR garbage / price leaks in description | product | REVIEW | quality-contract |
| `NO_PRODUCT_NAME_AS_INGREDIENT` | Name mirrored as fake ingredient | product | BLOCK | quality-contract |
| `NO_MENU_VARIANT` | Menu-as-variant | product | BLOCK | constitution + quality |
| `NO_MENU_VARIANTS_ANYWHERE` | Menu variants elsewhere on card | product/menu | BLOCK | quality-contract |
| `COMBO_STRUCTURE_VALID` | Combo price without components silently READY | product | REVIEW (`COMBO_CONTENTS_UNRESOLVED`) | quality-contract |
| `ADDITION_SCOPE_VALID` | Non-food / meta additions | product | BLOCK/REVIEW | quality-contract |
| `ADDITION_PRICE_SUPPORTED` | Unsupported addition prices | product | REVIEW/BLOCK | quality-contract |
| `PRICE_SUPPORTED` / unresolved 0 | Unsupported 0 / missing price | product | BLOCK | BELLA-003 |
| `PROVENANCE_SUFFICIENT` | Invented fields without provenance | product | REVIEW | quality-contract |
| `SOURCE_PRODUCT_COVERAGE_SUSPICIOUS` | Sparse extraction vs dense evidence (e.g. 12→1) | menu | fail-closed / REVIEW | source-coverage, BELLA-001 |
| `INGREDIENT` validity (via FOOD_COMPLETENESS) | Empty food cards | product | REVIEW | constitution |
| `PRODUCT_CHOICES_VALID` (explain path) | Malformed choices | product | REVIEW | domain validation |

## Write eligibility

```text
evaluateMenuQualityContract(TargetMenu)
→ only QUALITY_READY products in WritePlan executable ops
→ review=0 is NOT permission to publish (BELLA-005)
```
