# MENU INTELLIGENCE CERTIFICATION REPORT

**Date:** 2026-09-16  
**Milestone:** Certification + Consolidation only  
**Customer mutations performed:** **0**

---

## 1. Business-logic ownership audit

Inventory: [`docs/certification/business-logic-ownership.json`](docs/certification/business-logic-ownership.json)  
Drain list: [`docs/certification/after-targetmenu-drain.md`](docs/certification/after-targetmenu-drain.md)

Authoritative owner after this milestone: **`runMenuIntelligence` → `applyApprovedFactsToMenu` → `completeProductCard` → `evaluateMenuQualityContract`**.

## 2. Post-TargetMenu business logic found initially

**24 invent/fill call sites** after TargetMenu, chiefly:

- `dryRun.toPayload` (pizza/grill invent, dip/ekstra refill, description invent)
- `qaLiveImprove.buildQaTargetPayload` (same invent stack)
- `dryRun` variant + Tilbehør fan-out + probability mutation of canonical
- orphan `enrichCanonicalBurgerCards`

## 3. Post-TargetMenu business logic remaining

| Remaining | Kind | Justification |
|---|---|---|
| `sanitizeIngredientList` / `sanitizeAdditionList` in `toPayload` | Fail-closed strip | Validation hygiene — does not invent |
| `filterAdditionsWithTrace(..., policy:null)` in `toPayload` | Fail-closed strip | Drinks hard prior — constitution |
| `stripForbiddenMenuVariants` | Fail-closed strip | Constitution MENU_IS_COMBO_NOT_VARIANT |
| `mapProductChoicesToWriteFields` | Structural map | Places already-decided choices onto write fields |
| `assessLabelQuality` repair | Hygiene | Does not invent peer/domain content |
| QA `buildQaTargetPayload` never-worse field selection | Comparison policy | Allowed (§17) — picks live vs TargetMenu |
| QA `polish*` / name recovery when live defective | Hygiene + never-worse | Not a second knowledge system |

**Invent/fill after TargetMenu = 0** (grill resolve, pizza propose, dip/ekstra prefer, description invent, fan-out, probability mutate removed from dryRun/QA invent paths).

## 4. dryRun logic moved

Moved upstream into `applyApprovedFactsToMenu` (intelligence):

- `applyCategoryVariantFanOut`
- `fanOutRestaurantAdditions`
- probability / hard-prior addition filter

Removed from `toPayload`:

- `proposePizzaToppingsFromDescription`
- `resolveGrillIngredients`
- `preferGrillDipAdditions` / `preferBurgerEkstraAdditions`
- description invent via `ingredients.join`

## 5. QA logic moved

`buildQaTargetPayload` now:

- trusts TargetMenu `sourcePayload` as intelligence candidate
- never-worse scores vs live
- hygiene strip only

Invent calls deleted (`resolveGrillIngredients`, `prefer*`, `proposePizza*`, `inferGrillDescription`).

## 6. Off-spine Veroni logic found

| Item | Classification |
|---|---|
| `scripts/m6*` / `m64` / `m65` | HISTORICAL_SCRIPT / CERTIFICATION_TOOL |
| `src/decisions/veroniAutonomousPass.ts` | HISTORICAL — barrel re-export only; **not** imported by portal/intelligence/planning |
| `veroniDefaultTilbehorAdditions` / `upsertVeroniTilbehorBusinessFact` | Scoped BUSINESS_FACT helpers; seed **env opt-in only** |
| `fixtures/veroni/*` | TEST_FIXTURE |

## 7. Production-reachable Veroni logic remaining

- Named helpers still exist (`upsertVeroniTilbehorBusinessFact`) but **do not auto-run** for `veronipizza.dk` without `PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS`
- TAH canary/host allowlist defaults may still mention Veroni (write layer, not intelligence)
- **menuNumber-specific autonomous pass: not reachable from portal worker**

## 8. Production-reachable Smash logic remaining

- Generic `\bsmash\b` product-family signal only
- Golden/cert scripts under `fixtures/golden/smash` + `scripts/cert-smash-raw.mts`
- **No** `if host == smashmburger.dk` in intelligence

## 9. Active contradictory policies remaining

Runtime active `MENU_AS_VARIANT` resolution assignments in intelligence/portal/planning: **0**

## 10. MENU_AS_VARIANT runtime count

**0** active. Lifecycle: **SUPERSEDED** → `MENU_IS_COMBO_NOT_VARIANT`. Regression in `tests/certification/isolation-and-policies.test.ts`.

## 11. Smash raw-source input confirmed

**YES** — `fixtures/golden/smash/raw-source.jpg` bytes → `PdfSourceAdapter.extractDetailed({ kind: "image" })`.

## 12. Smash extraction accounting

| Metric | Value |
|---|---|
| pageCount | 1 |
| uniqueProducts (extract) | 5 |
| source products after reconcile/Menuer | 10 |
| TargetMenu products | 10 (5 Burgers + 5 Menuer) |

## 13. Smash semantic golden result

**PASS** (`tests/certification/smash-raw-photo.test.ts`)  
Golden updated with justification: [`docs/certification/golden-delta-review.md`](docs/certification/golden-delta-review.md)

- Category **Burgers** (not Grill)
- **0** Menu variants
- Burger cards ≥2 ingredients + description
- Menuer products present as combo category (not variants)

## 14. Smash QualityContract result

`MENU_QUALITY_READY` — ready 10 / review 0 / blocked 0 — `writeEligible: true`

## 15. Smash exact mismatch summary

Versus updated oracle: **0 hard mismatches** on required burger/Menuer acceptance criteria.  
Ingredient class: **INFERRED** (`DOMAIN_PRIOR`) when OCR yields empty ingredient lines — documented, not treated as EXACT_SOURCE.

## 16. Veroni raw-source input confirmed

**YES** — `fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf` → production extract.

## 17. Veroni extraction accounting

| Metric | Value |
|---|---|
| pageCount | 7 |
| uniqueProducts | 85 |
| source products | 107 |
| TargetMenu products | 107 |
| menuVariantCount | **0** |

## 18. Veroni semantic golden result

**PASS** on certification invariants (zero Menu variants, no Smash leakage, constitution version).  
Full historical 72-number exact name oracle parity: **not claimed** this run (OCR/extra Menuer inflate count).

## 19. Veroni QualityContract result

`MENU_QUALITY_BLOCKED` — ready 72 / review 29 / blocked 6 — `writeEligible: false`

## 20. Third merchant raw-source result

**PASS** — `fixtures/golden/third-merchant/raw-source.pdf` through production path; no Smash/Veroni leakage; 0 Menu variants (`tests/certification/third-merchant-raw.test.ts`).

## 21. Cross-merchant leakage result

| Check | Result |
|---|---|
| Smash names absent on Veroni/third | PASS |
| Veroni host defaults off | PASS |
| Drinks no food dips (third) | PASS |

## 22. Peer cohort evidence quality

Smash burger fill used **DOMAIN_PRIOR** when peer artifact thin/absent — not reported as HIGH peer confidence. Peer restaurant-diversity banding remains in `peerCohorts.ts`; this Smash run did not claim high peer support per field.

## 23. QualityContract negative tests

**PASS** — empty burger, Menu variant, drink+ketchup, Tomat name, empty menu (`tests/certification/quality-contract.test.ts`).

## 24. QualityContract positive tests

**PASS** — complete baconburger; drink without food additions.

## 25. Portal Create spine parity

**PASS** — worker calls `runMenuIntelligence({ mode: CREATE_MENU })`; writes `target-menu.json` / `quality-report.json` / traces (`tests/certification/portal-spine-parity.test.ts`).

## 26. Portal QA spine parity

**PASS** — same engine with `QA_RECONCILE`; dryRun/QA invent calls absent.

## 27. Fail-closed behavior

Quality gate blocks Create **and** QA auto-live when contract not READY. Engine errors surface as job failure (no fallback invent path in dryRun).

## 28. Policy trace completeness

Worker artifacts: `intelligence-trace.json`, `policy-application-trace.json`, `quality-report.json`, `target-menu.json`, plus existing source/dry-run files.

## 29. Full test suite counts

| Suite | Result |
|---|---|
| unit | **31 files / 205 tests PASS** |
| domain | **7 files / 49 tests PASS** |
| certification | **6 files / 18 tests PASS** (incl. Smash raw, Veroni raw, third raw) |
| contract | Playwright-dependent failures observed historically — not re-certified green in this report |
| extraction | Long-running; not blocking certification claims above |
| typecheck | Pre-existing unrelated errors in some unit fixtures; intelligence/certification spine compiles for tests |

## 30. Customer mutations performed

**MUST BE 0 — confirmed 0** (fixture/fake destination only).

## 31. Remaining risks

1. Veroni TargetMenu still has QUALITY_BLOCKED products (OCR/name quality) — not live-ready
2. Smash burger ingredients are inferred priors when photo OCR lacks ingredient glyphs — provenance honest, but not source-exact
3. Minimal third-merchant PDF is weak realism vs sushi/Thai photo
4. `veroniAutonomousPass` still exists as historical module (isolated)
5. Contract/Playwright suite may still fail in environments without browsers
6. Fail-closed sanitize in planning remains defense-in-depth (acceptable)

## 32. READY_FOR_SMASH_FRESH_CREATE_TEST

# **YES**

Raw Smash photo → production extract → `runMenuIntelligence` → QualityContract READY → semantic golden PASS → 0 Menu variants → no Smash runtime hardcoding → policy traces written.

## 33. READY_FOR_NEW_MERCHANT_LIVE_CREATE

# **NO**

## 34. Exact blockers if NO

1. **Veroni QualityContract** = `MENU_QUALITY_BLOCKED` (6 blocked / 29 review) — cannot claim Veroni raw E2E quality-pass
2. **Veroni full golden name/number oracle** not re-certified at historical 72 exact accounting
3. **Third merchant** uses minimal synthetic PDF — not a rich real non-burger menu photo
4. **Contract/Playwright** suite not fully green in this certification window
5. Residual named Veroni helper symbols / TAH canary host defaults remain outside intelligence (low risk but not “zero named Veroni surface”)

---

### Definition checklist (Smash YES criteria)

| Criterion | Met |
|---|---|
| raw Smash photo input | YES |
| production extractor | YES |
| production intelligence engine | YES |
| no Smash runtime hardcoding | YES |
| semantic golden passes | YES |
| QualityContract passes | YES |
| policy trace complete | YES |
| no unresolved mandatory fields (writeEligible) | YES |

**STOP.** No live writes. No next milestone started.
