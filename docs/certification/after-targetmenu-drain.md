# AFTER TargetMenu invent/fill — drain list

TargetMenu is owned by `runMenuIntelligence` → `completeProductCard`. Anything below that **re-invents or fills** menu field semantics *after* that point must be drained so WritePlan/QA only map/compare, not invent.

## Must drain (afterTargetMenu invent/fill)

| Function | Module | Why drain |
|---|---|---|
| `fanOutRestaurantAdditions` | `planning/structureMapping.ts` | Fills Tilbehør onto cards after TargetMenu |
| `applyCategoryVariantFanOut` | `learning/categorySizeVariantPolicy.ts` | Fills structural variants after TargetMenu |
| `composeCategoryIngredientAdditions` | `learning/categoryIngredientAdditions.ts` | Builds addition sets post-TargetMenu |
| `upsertCategoryIngredientAdditionFacts` | `learning/categoryIngredientAdditions.ts` | Persists those sets for fan-out |
| `upsertPeerAdditionFactsForMenu` | `learning/additionLikelihood.ts` | Peer Tilbehør facts applied after TargetMenu |
| `proposalForKind` | `learning/additionLikelihood.ts` | Feeds peer addition invent |
| `veroniDefaultTilbehorAdditions` | `planning/structureMapping.ts` | Hardcoded dip seed |
| `upsertVeroniTilbehorBusinessFact` | `learning/structurePolicy.ts` | Seed fact path for default dips |

## Drained (completed)

| Function | Module | Why drain |
|---|---|---|
| `enrichProduct` / `enrichCanonicalBurgerCards` | `planning/enrichBurgerCards.ts` | Orphan duplicate of `completeProductCard` (deprecated). Drained — module removed; had no callers, exports, or tests. |
| `inferGrillDescription` | `domain/grillCardFill.ts` | Zero production callers; orphaned after invent-call-site removal. Function definition deleted; unit test assertion and ownership entry removed. |
| `applyCategorySizeVariantFanOut` | `learning/categorySizeVariantPolicy.ts` | Unused `@deprecated` alias of `applyCategoryVariantFanOut`. Alias export deleted; real function untouched. |

**Already drained via call-site removal (earlier commit):** `toPayload` (`planning/dryRun.ts`) and `buildQaTargetPayload` (`planning/qaLiveImprove.ts`) had their invent call-sites removed — `resolveGrillIngredients`, `inferGrillIngredients`, `inferBurgerIngredients`, `prefer*`, `proposePizzaToppingsFromDescription`, `proposePeerIngredients`, `inferGrillDescription`, `formatDescriptionFromIngredients`. They now only map/sanitize/strip TargetMenu output and remain in the 'Keep after TargetMenu (not invent)' framing below, not as still-pending drains.


## Shared invent helpers (keep for intelligence; stop calling after TargetMenu)

Drain **call sites** in `toPayload` / `buildQaTargetPayload` / enrich — not the helpers themselves when used only from `completeProductCard`:

- `resolveGrillIngredients`, `inferGrillIngredients`, `inferBurgerIngredients`
- `preferGrillDipAdditions`, `preferBurgerEkstraAdditions`
- `proposePizzaToppingsFromDescription`, `proposePeerIngredients`
- `formatDescriptionFromIngredients`
- `repriceTilbehorList`, `defaultTilbehorPriceOre`

## Keep after TargetMenu (not invent)

Sanitize / remap / gate may remain as defense-in-depth or WritePlan mapping: `sanitize*`, `polish*`, `stripForbiddenMenuVariants`, `filterAdditions*`, `mapProductChoicesToWriteFields`, `assertCreateCardQuality`, label recovery.
