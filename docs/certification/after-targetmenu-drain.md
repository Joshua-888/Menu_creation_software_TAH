# AFTER TargetMenu invent/fill — drain list

TargetMenu is owned by `runMenuIntelligence` → `completeProductCard`. Anything below that **re-invents or fills** menu field semantics *after* that point must be drained so WritePlan/QA only map/compare, not invent.

## Must drain (afterTargetMenu invent/fill)

| Function | Module | Why drain |
|---|---|---|
| `toPayload` | `planning/dryRun.ts` | Re-proposes pizza toppings, grill ingredients, dip/ekstra additions, desc join — parallel completion |
| `buildQaTargetPayload` | `planning/qaLiveImprove.ts` | Same invent stack + `inferGrillDescription` on QA merge |
| `enrichProduct` / `enrichCanonicalBurgerCards` | `planning/enrichBurgerCards.ts` | Orphan duplicate of `completeProductCard` (deprecated) |
| `inferGrillDescription` | `domain/grillCardFill.ts` | QA-only invent not on intelligence spine |
| `fanOutRestaurantAdditions` | `planning/structureMapping.ts` | Fills Tilbehør onto cards after TargetMenu |
| `applyCategoryVariantFanOut` | `learning/categorySizeVariantPolicy.ts` | Fills structural variants after TargetMenu |
| `applyCategorySizeVariantFanOut` | `learning/categorySizeVariantPolicy.ts` | Deprecated alias of fan-out |
| `composeCategoryIngredientAdditions` | `learning/categoryIngredientAdditions.ts` | Builds addition sets post-TargetMenu |
| `upsertCategoryIngredientAdditionFacts` | `learning/categoryIngredientAdditions.ts` | Persists those sets for fan-out |
| `upsertPeerAdditionFactsForMenu` | `learning/additionLikelihood.ts` | Peer Tilbehør facts applied after TargetMenu |
| `proposalForKind` | `learning/additionLikelihood.ts` | Feeds peer addition invent |
| `veroniDefaultTilbehorAdditions` | `planning/structureMapping.ts` | Hardcoded dip seed |
| `upsertVeroniTilbehorBusinessFact` | `learning/structurePolicy.ts` | Seed fact path for default dips |

## Shared invent helpers (keep for intelligence; stop calling after TargetMenu)

Drain **call sites** in `toPayload` / `buildQaTargetPayload` / enrich — not the helpers themselves when used only from `completeProductCard`:

- `resolveGrillIngredients`, `inferGrillIngredients`, `inferBurgerIngredients`
- `preferGrillDipAdditions`, `preferBurgerEkstraAdditions`
- `proposePizzaToppingsFromDescription`, `proposePeerIngredients`
- `formatDescriptionFromIngredients`
- `repriceTilbehorList`, `defaultTilbehorPriceOre`

## Keep after TargetMenu (not invent)

Sanitize / remap / gate may remain as defense-in-depth or WritePlan mapping: `sanitize*`, `polish*`, `stripForbiddenMenuVariants`, `filterAdditions*`, `mapProductChoicesToWriteFields`, `assertCreateCardQuality`, label recovery.
