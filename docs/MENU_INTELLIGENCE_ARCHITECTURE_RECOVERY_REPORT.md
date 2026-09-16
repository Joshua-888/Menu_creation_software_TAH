# MENU INTELLIGENCE ARCHITECTURE RECOVERY REPORT

**Date:** 2026-09-16  
**Repo:** Menu_creation_software_TAH  
**Constitution:** MenuConstitutionV1  
**Live writes this milestone:** NONE (stopped as required)

---

## 1. Current duplicated business-logic paths found

| Area | Locations | Tag |
|---|---|---|
| Grill/burger ingredient fill | `enrichBurgerCards` + `dryRun.toPayload` + `qaLiveImprove.buildQaTargetPayload` + new `completeProductCard` | DUPLICATED_BUSINESS_LOGIC → orchestrated via `MenuIntelligenceEngine` |
| Forbidden Menu variant strip | `dryRun`, `structureMapping`, `qaLiveImprove`, `assertCreateCardQuality` | DUPLICATED_BUSINESS_LOGIC (defense in depth retained; constitution is source of truth) |
| Drink / no food Tilbehør | `categoryLikelihood` + `sanitizeAdditionList` | DUPLICATED_BUSINESS_LOGIC (intentional hard prior) |
| Description join | enrich/dryRun `join(", ")` vs `formatDescriptionFromIngredients` | Partially unified (Danish `og` grammar now in textNormalize) |
| Pizza topping recovery | `applyPizzaToppingRecovery` + dryRun re-propose | Still present (called once from engine) |

## 2. Rules not connected to Create (pre-recovery)

N/A for most shared planners. Gaps that remain structural:

- Field-aware QA never-worse richer than Create (by design)
- Live replan previously omitted `ingredientLikelihood` → **FIXED** in `liveExecute.ts`

## 3. Rules not connected to QA (pre-recovery)

| Rule | Tag |
|---|---|
| PDF/OCR extract + empty-extract fail | NOT_ON_QA_SPINE (by design) |
| `runDomainEngine` / decade numbering | NOT_ON_QA_SPINE |
| Menuer synthesis from Menu price column | NOT_ON_QA_SPINE |
| Category Grill→Burgers rename | NOT_ON_QA_SPINE (live categories preserved; engine proves correct naming on Create) |
| Card quality gate blocked live | Was NOT_ON_QA_SPINE → **NOW BLOCKS QA TOO** via MenuQualityContract |

## 4. Restaurant-specific runtime logic found

| Item | Status |
|---|---|
| `shouldSeedDefaultTilbehor("veronipizza.dk")` auto-true | **REMOVED** — env opt-in only |
| `shouldApplyPeerProbabilityPolicy` Veroni default | **REMOVED** — env opt-in only |
| `isBurgerProductName` Smash dish dictionary | **REMOVED** — generic `burger`/`smash`/`cafeteria` signals only |
| `veroniAutonomousPass` menuNumber cases | Still in CLI/sidechannel (not portal Create/QA spine) |
| `VERONI_CANARY_TARGET` / host allowlist defaults | Remaining in TAH write canary layer (not intelligence) |
| Scripts `submit-smash-*` | Fixture/submit helpers only |

## 5. Removed/deprecated hardcoding

- Veroni default Tilbehør seed host check
- Veroni default peer-probability host check
- Smash-specific dish name regexes in burger detection / ekstra prefer
- `MENU_AS_VARIANT` deterministic resolution → `MENU_IS_COMBO_NOT_VARIANT`

## 6. Contradictory policies found

- Active conceptual conflict: `MENU_AS_VARIANT` (deterministic/transforms) vs `menu-never-variant` SEMANTIC_RULE
- Resolution: lifecycle SUPERSEDED → replacement `MENU_IS_COMBO_NOT_VARIANT`

## 7. MENU_AS_VARIANT deprecation result

| Field | Value |
|---|---|
| Old policy | `MENU_AS_VARIANT` |
| Status | **SUPERSEDED** |
| Replacement | `MENU_IS_COMBO_NOT_VARIANT` |
| Date/version | 2026-09-16 / MenuConstitutionV1 |
| Code | `src/intelligence/constitution.ts`, `policyLifecycle.ts`, `decisions/deterministic.ts`, `decisions/transforms.ts` |

## 8. Menu Constitution implementation

`src/intelligence/constitution.ts` — MenuConstitutionV1 invariants:

PRODUCT_NAME, CATEGORY, MENU_IS_COMBO_NOT_VARIANT, VARIANT, PRODUCT_CHOICE, INGREDIENT, DESCRIPTION, ADDITIONS, DRINKS_NO_FOOD_EXTRAS, ADDITION_PRICING, FOOD_COMPLETENESS, WRITE_GATE

## 9. Semantic entity classifier implementation

`src/intelligence/semanticClassifier.ts` — typed `SemanticEntityType` with provenance-ready `ClassifiedPhrase`. Drives invalid product-name / ingredient / addition filters.

## 10. Evidence pipeline implementation

Unchanged extract adapters remain multi-path (PDF text, layout, OCR, rendered fallback). Intelligence layer consumes CanonicalMenu after extract/domain or live snapshot — OCR is evidence, not sole truth. Vision/multimodal recovery is **not** newly wired this milestone (risk noted in §39).

## 11. Vision/OCR/text evidence behavior

Existing: PDF text + layout + OCR + rendered fallback. Bounding-box/vision enrichment for missed burger ingredients is **deferred** (architectural hook via provenance origins `SOURCE_VISION` defined in types).

## 12. Single MenuIntelligenceEngine implementation

`src/intelligence/menuIntelligenceEngine.ts` → `runMenuIntelligence()`

Flow: pizza recovery → `completeCanonicalMenuCards` → MenuQualityContract → policy traces → write eligibility

## 13. Create integration

`src/portal/worker.ts` CREATE path calls `runMenuIntelligence({ mode: "CREATE_MENU" })` instead of standalone enrich. Artifacts: `menu-intelligence-result.json`, `policy-application-trace.json`, `menu-quality-contract.json`.

## 14. QA integration

Same engine with `mode: "QA_RECONCILE"` + `preserveLiveRichness`. MenuQualityContract **blocks QA auto-live** the same as Create.

## 15. Peer evidence architecture

`src/intelligence/peerCohorts.ts` — product families, restaurant-diversity weighting, HIGH/MEDIUM/LOW bands. Existing `ingredientLikelihood` / `additionLikelihood` consumed through completion engine.

## 16. Product-card completion architecture

`src/intelligence/completeProductCard.ts` — single `completeProductCard()` + `completeCanonicalMenuCards()` used by engine for Create+QA.

## 17. Ingredient inference behavior

Priority in completion: source → sanitize/classify → peer resolveGrillIngredients → domain prior. Provenance recorded per field. Category Burgers without the word “burger” in the title still receives burger baseline (generic family, not merchant dish list).

## 18. Description generation behavior

`formatDescriptionFromIngredients` now professional Danish: `"Oksekød, bacon, salat, tomat, løg, ketchup og mayo"`. Generated from final normalized ingredients.

## 19. Addition generation behavior

Candidate filter via semantic classifier + `isForbiddenTilbehorName` + drink hard wipe + burger ekstra / grill dip helpers. No product/category/meta titles.

## 20. Addition pricing behavior

Source price preferred; burger ekstra uses documented domain prior prices with provenance `DOMAIN_PRIOR`. Full peer median/p25/p75 report types exist in peer price benchmark module (pre-existing); constitution forbids silent arbitrary 10 DKK without policy — further tightening of silent 10kr union paths remains a residual risk (§39).

## 21. Category intelligence behavior

Create still uses `normalizeSourceCategoriesByKind` (Grill→Burgers). Quality contract **blocks** burgers under Grill. No live GRILL rename performed this milestone.

## 22. Menu/combo representation

Menu variants stripped; Menuer synthesis remains on extract path. Unresolved combo contents → review, not variant invent.

## 23. Menu Quality Contract checks

`src/intelligence/qualityContract.ts` — PRODUCT_NAME_VALID, CATEGORY_SEMANTIC_FIT, DESCRIPTION_PROFESSIONAL, INGREDIENTS_*, NO_MENU_VARIANT, ADDITIONS_*, ADDITION_SCOPE_VALID (drinks), NO_OCR_GARBAGE, GRAMMAR_VALID, PROVENANCE_SUFFICIENT, etc.

Statuses: QUALITY_READY / QUALITY_REVIEW / QUALITY_BLOCKED → menu MENU_QUALITY_* 

## 24. Whole-menu coherence checks

NO_DIP_PRODUCTS_IN_BURGER_CATEGORY, DRINKS_NO_FOOD_ADDITIONS, NO_MENU_VARIANTS_ANYWHERE, NO_DUPLICATE_PRODUCTS, PRODUCTS_ACCOUNTED

## 25. WritePlan gate behavior

Worker: `cardGate.ok = planGate.ok && intelligence.writeEligible` for **both** Create and QA. No auto-live when REVIEW/BLOCKED.

## 26. Policy trace implementation

`policy-application-trace.json` written per job with per-product field origins, constitution version, quality checks.

## 27. Policy UI/execution parity

`policyCatalog.ts` updated: MenuConstitutionV1 entry; MENU_AS_VARIANT marked superseded; peer probability no longer “Veroni by default”. Full NOT_CONNECTED_TO_PRODUCTION badges for every stale catalog row — partial (catalog improved; exhaustive spine-wiring audit UI still thin).

## 28. Veroni runtime hardcoding remaining

- CLI `veroniAutonomousPass` / m6* scripts (sidechannel)
- Canary/target lock / DEFAULT_LIVE_WRITE_HOSTS
- Scoped BUSINESS_FACT seed function name still says Veroni but only runs when env host list includes restaurant

## 29. Smash runtime hardcoding remaining

- Submit/debug scripts and golden fixtures (allowed)
- Generic `\bsmash\b` as product-family signal (not dish dictionary)
- No Smash restaurant-name branches in intelligence

## 30. Smash golden fixture result

`fixtures/golden/smash/` + unit test via `runMenuIntelligence` on thin burger menu:

- Menu variants stripped
- ≥2 ingredients + description + additions on all 5 products
- Category Burgers
- **PASS** (architecture unit golden)

Full PHOTO→extract→engine golden against raw JPEG in CI: not fully executed end-to-end this session (extract flake risk); production-path function coverage is the shared engine.

## 31. Veroni golden fixture result

Pointer to `fixtures/veroni/golden-source.json` preserved. Runtime Veroni defaults removed. Full PDF extract golden re-run not executed this session.

## 32. Third-restaurant fixture result

`fixtures/golden/third-merchant/` + test: pasta ingredients preserved, drinks lose mayo, no Smash leak, no Burgers category invented — **PASS**

## 33. Cross-merchant leakage result

Third-merchant test asserts no Dirty/Classic Smash strings and no burger Oksekød/Ketchup injection into pasta — **PASS**

## 34. Production-path integration tests

`tests/unit/intelligence/menu-intelligence-architecture.test.ts` exercises `runMenuIntelligence` (same entry as portal worker). Fake-destination WritePlan executor loop not newly added (executor remains dumb; gate tested).

## 35. Regression failures covered

Covered in architecture tests / existing hard-gates:

- Menu as variant
- Grill vs Burgers semantic fit (contract)
- Empty burger ingredients/description
- Dips on drinks
- Meta / topping-as-name classification
- Glued tokens (existing sanitize)
- 0-product menu not READY
- Veroni host defaults off

## 36. CREATE/QA parity result

Same engine entry; same constitution; QA preserveLiveRichness only. Ingredient/normalization parity asserted on thin input — **PASS**

## 37. Golden acceptance metrics

| Metric | Smash unit golden | Third | Veroni PDF |
|---|---|---|---|
| No Menu variants | 100% | n/a | not re-run |
| Food cards complete | 100% (5/5) | pasta source kept | not re-run |
| No meta-as-food | classifier PASS | PASS | — |
| No cross-merchant leak | — | PASS | — |

## 38. Remaining human-review cases

- COMBO_SEMANTICS_UNRESOLVED when Menu price present but components unknown
- QUALITY_REVIEW when food ingredients still insufficient after peer+prior
- Ambiguous category after source+peer
- Unsupported addition prices without peer benchmark

## 39. Remaining architectural risks

1. `dryRun.toPayload` / QA merge still re-apply grill helpers (drift until fully delegated to TargetMenu only)
2. Vision evidence recovery not wired for missed OCR ingredient lines
3. Category-ingredient Tilbehør may still use 10kr fallback in older union path
4. Veroni CLI autonomous menuNumber logic still exists off-spine
5. Smash PHOTO full extract golden not CI-certified this milestone
6. Policy UI “where used / last applied count” incomplete

## 40. READY_FOR_SMASH_FRESH_CREATE_TEST

**NO**

Reason: architecture spine + unit golden PASS, but full RAW photo → extract → engine → expected-final oracle against fixture destination has not been proven green end-to-end in this milestone without live writes. Do not claim fresh-create proof yet.

## 41. READY_FOR_NEW_MERCHANT_LIVE_CREATE

**NO**

Reasons (all required):

- Smash golden full extract path not proven (§40)
- Veroni PDF golden not re-validated this session
- Residual off-spine Veroni CLI hardcoding remains
- dryRun still contains parallel completion logic
- Vision multi-evidence gap remains

---

### Implementation map (new spine)

```
src/intelligence/
  constitution.ts
  semanticClassifier.ts
  peerCohorts.ts
  completeProductCard.ts
  qualityContract.ts
  menuIntelligenceEngine.ts
  policyLifecycle.ts
  types.ts
  index.ts

fixtures/golden/smash/
fixtures/golden/veroni/
fixtures/golden/third-merchant/

tests/unit/intelligence/menu-intelligence-architecture.test.ts
```

### Explicit non-actions (honored)

- No live Create
- No live QA repair of Smash
- No manual GRILL rename on live
- No merchant-specific runtime dish dictionaries added
