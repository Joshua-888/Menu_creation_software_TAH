# Permanent Incident Regression Registry

Traceability only. Permanent memory remains: code, tests, fixtures, constitution/policies, quality gates.

| ID | Title | Root cause | Generic fix | Runtime guard | Regression test | Status | Introduced / Fixed SHA |
|----|-------|------------|-------------|---------------|-----------------|--------|------------------------|
| BELLA-001 | 12 visible → 1 OCR product | Incomplete/incorrect extraction + premature write path left destination sparse vs source | Full TargetMenu freeze + READY gate before write | Refuse execute unless TargetMenu READY count matches approved freeze | certification / Bella TargetMenu verification | DOCUMENTED | — |
| BELLA-002 | Garbage product became READY | Label/name quality gates insufficient; ingredient-soup names passed | `gateWriteLabels` / assessLabelQuality BLOCK/REVIEW for garbage names | createHiddenProduct fails closed on LABEL_QUALITY_REVIEW | `label-quality-learn`, menu-card-quality | DOCUMENTED | — |
| BELLA-003 | Unsupported 0 price | Zero/absent price treated as writable | Exact money equality; refuse unsupported 0 where policy requires positive base | PRICE_EXACT_MONEY mismatch fails verify | field-aware price exactness test | DOCUMENTED | — |
| BELLA-004 | Invented PIZZA category | Category invented without TargetMenu authority | Categories only from approved TargetMenu; orphan delete certification | deleteCategory CERTIFIED + plan binds destination snapshot | delete-category-contract, M80 | DOCUMENTED | — |
| BELLA-005 | review=0 auto-live | Review queue misread as clearance to publish | Publication ops remain 0 until explicit publication certification | `publicationOperations: 0`; no setProductAvailable in recovery | recovery plan fixtures | DOCUMENTED | — |
| BELLA-006 | Partial public mutation | Writes continued after partial success without stop-on-mismatch | Stop-on-first-mismatch; RECOVERY_REQUIRED on partial | Executor / recovery scripts stop on verify fail | create-partial-failure | DOCUMENTED | — |
| BELLA-007 | Category verification misrepresented menu success | Category-only success treated as menu complete | Separate `categoriesVerified` vs `productsVerified` vs `wholeMenuVerified` | Metrics must not collapse category verify into menu success | MenuCreationMetrics | DOCUMENTED | — |
| BELLA-008 | Unsafe ambiguous persistence handling | Ambiguous create treated as success without identity proof | AMBIGUOUS / WRITTEN-without-destination → REVIEW, never guess | `resolveCreateResume` REVIEW_AMBIGUOUS | m4-migration-runner | DOCUMENTED | — |
| BELLA-009 | Orphan category recovery | Incident left empty wrong category (PIZZA) | Certified `deleteCategory` + rebound RecoveryPlan from destination snapshot | requireEmpty + read-back absence | M80 Veroni delete cert | DOCUMENTED | — |
| BELLA-010 | Representation-equivalent description caused false semantic failure | Exact string compare on description; `gateWriteLabels`→`polishDescriptionText` (`description_hygiene`) transforms TargetMenu `"…ketchup og mayo"` into submitted `"…Ketchup, Mayo"` before form fill | Field-aware `INGREDIENT_DESCRIPTION_SEMANTIC` comparator; REPRESENTATION_EQUIVALENT ≠ fail | `compareProductExact` / `verifyProductFields` ignore representation-only diffs | `tests/unit/field-aware-verify.test.ts` BELLA-010 | FIXED | `68523de76a48fab3694a431299905c6f7775a4a4` |
| BELLA-011 | Hidden products but public empty categories | TAH has no category visibility; createCategory immediately exposes nav labels | `CATEGORY_CREATE_IS_PUBLIC_MUTATION=true`; dependency-minimizing create (category only immediately before its hidden products); empty-category compensation propose-only | `buildMinimizedCategoryExposureSteps` + pre-create READY validation | field-aware-verify BELLA-011 + categoryExposure | FIXED | `68523de76a48fab3694a431299905c6f7775a4a4` |

## BELLA-010 forensic note (verified)

| Layer | Value |
|-------|--------|
| TargetMenu description | `Oksekød, salat, tomat, løg, ketchup og mayo` |
| WritePlan / expectedPayload | same as TargetMenu (untransformed) |
| Adapter serialize before submit | `gateWriteLabels` → `assessLabelQuality` → `polishDescriptionText` (`description_hygiene`) → **`Oksekød, Salat, Tomat, Løg, Ketchup, Mayo`** |
| Admin stored / read-back | same as submitted gated value |

**Transformation layer:** our write adapter label gate (`description_hygiene`), **not** TAH server-side mutation after submit.

## BELLA-011 capability audit (verified)

| Capability | Supported |
|------------|-----------|
| hidden category | NO |
| inactive category | NO |
| availability status (category) | NO |
| category visibility control | NO |
| draft category | NO |
| store/menu global disable (certified) | NO |
| CATEGORY_CREATE_IS_PUBLIC_MUTATION | **true** |
