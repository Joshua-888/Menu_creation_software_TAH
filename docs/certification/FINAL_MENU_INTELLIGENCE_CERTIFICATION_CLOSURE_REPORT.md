# FINAL MENU INTELLIGENCE CERTIFICATION CLOSURE REPORT

**Generated:** 2026-09-16  
**Gate log:** `runs/certification/full-gate-2026-09-16T09-15-27-372Z.log`  
**Customer mutations during certification:** **0**

---

## 1. Commit SHA certified

`e9837bc4515d2acafa77c9b4b8abdee481f6ed07` (working tree dirty — closure changes not yet committed)

## 2. Constitution version

`MenuConstitutionV1`

## 3. Policy snapshot version

`MenuConstitutionV1` (`MENU_AS_VARIANT` = **SUPERSEDED**)

## 4. Veroni status-accounting bug explanation

Previous report mixed **historical golden dish count (72)** with **finding / quality-list lengths (29 review + 6 blocked)** as if they were mutually exclusive product statuses on the same 72 set. That is invalid: findings are multi-valued per product, and TargetMenu product count after OCR can differ from the V1 72-number oracle. Fixed by `statusAccounting` on `MenuQualityContract` with invariant `ready + review + blocked === productCount`, plus separate `findingCounts`.

## 5. Product-status invariant result

**PASS** — `tests/certification/status-accounting.test.ts` + Veroni/Smash/Thai cert runs all report `statusAccounting.reconciles === true`.

## 6. Veroni raw extraction result

| Metric | Value |
|--------|-------|
| Raw PDF | `fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf` |
| Source products (extract) | 107 |
| TargetMenu products (after drop invalid headings/meta/OCR) | 88 |
| Menu variants | 0 |
| Run | `cert_veroni_2026-09-16T09-02-02-197Z` |

## 7. Veroni READY count

**88**

## 8. Veroni REVIEW count

**0**

## 9. Veroni BLOCKED count

**0**

## 10. Full remaining Veroni issues

**None** (empty non-ready set after generic classifier / drop / domain-prior fixes).

## 11. Veroni Golden V2 migration changes

See `docs/certification/veroni-golden-migration-review.md`. Summary: V1 exact-72 oracle obsolete; Menu-as-variant forbidden; OCR meta/heading/marketing rows dropped; pizza dish lexicon allows Pepperoni; compound burger detection; status invariant on TargetMenu count. Frozen at `fixtures/golden/veroni/VERONI_GOLDEN_V2.json`.

## 12. Veroni Golden V2 PASS/FAIL

**PASS**

## 13. Smash regression PASS/FAIL

**PASS**

## 14. Smash READY/REVIEW/BLOCK counts

**10 / 0 / 0** (source=10, menu variants=0)

## 15. Third merchant fixture description

Realistic **Thai takeaway** ASCII PDF (`fixtures/golden/third-merchant/raw-source.pdf`): Forretter, Hovedretter, Nudler/Ris, Vegetar, Tilbehør, Drikkevarer — prices, ingredients lines, variants/choices complexity vs pizza/burger.

## 16. Third merchant raw result

Source ≥10 (22 extract rows), TargetMenu **16**, Menu variants **0**, menuStatus **MENU_QUALITY_READY**

## 17. Third merchant golden PASS/FAIL

**PASS** (status reconcile + no Smash/Veroni leakage)

## 18. Cross-merchant leakage result

**PASS** — isolation tests + fixture blob assertions: no Dirty Smash / Classic Smash / veronipizza / Salatmayonnaise on Thai; no Smash names on Veroni; burger facts not invented on Thai dishes.

## 19. Post-TargetMenu business logic remaining

**POST_TARGETMENU_BUSINESS_LOGIC = 0** (dryRun / qaLiveImprove / worker invent helpers absent; Create+QA call `runMenuIntelligence` before WritePlan)

## 20. Production merchant-specific logic remaining

**PRODUCTION_REACHABLE_MERCHANT_SPECIFIC_BUSINESS_LOGIC = 0** (`tests/certification/production-purity-audit.test.ts`)

## 21. Portal Create parity

**PASS** — worker Create path: ingest → facts → `runMenuIntelligence` → TargetMenu → quality → WritePlan (`tests/certification/portal-spine-parity.test.ts`)

## 22. Portal QA parity

**PASS** — same spine with `mode: QA_RECONCILE`; no QA-only invent after TargetMenu

## 23. QualityContract negative suite

**PASS**

## 24. QualityContract positive suite

**PASS** (burger, pizza, drink, thai curry)

## 25–31. Suite counts (uninterrupted gate)

| # | Suite | Count | Result |
|---|-------|------:|--------|
| 25 | Domain | 49 | PASS |
| 26 | Unit (incl. intelligence) | 205 | PASS |
| 27 | Intelligence (subset of unit) | 12 | PASS |
| 28 | Certification | 24 | PASS |
| 29 | Contract (incl. Playwright/admin) | 92 | PASS |
| 30 | Playwright/admin (within contract) | 8 browser cases | PASS |
| 31 | Portal integration | 8 | PASS |
| — | Extraction | 26 | PASS |
| — | Typecheck | — | PASS |
| — | Portal build | — | PASS |

**Failures = 0**

Gate: start `2026-09-16T09:15:27.372Z` → end `2026-09-16T09:20:36.229Z` (~309s).

## 32. Full uninterrupted test gate PASS/FAIL

**PASS**

## 33. Customer mutations

**MUST BE 0 — confirmed 0** (no live create/update/publish/delete)

## 34. Remaining risks

1. Working tree dirty — certify after commit for immutable SHA pin.
2. Veroni TargetMenu (88) ≠ V1 numbered-dish oracle (72) by design (OCR drops + Menuer).
3. Thai fixture is high-fidelity synthetic PDF (not a photographed menu).
4. Playwright browsers must be installed in CI (`npx playwright install chromium`).

## 35. READY_FOR_SMASH_FRESH_CREATE_TEST

**YES**

## 36. READY_FOR_NEW_MERCHANT_LIVE_CREATE

**YES**

## 37. Exact blockers if NO

*(none — all readiness checklist items PASS)*

---

### Final golden matrix

| Fixture | Raw input | Products | Ready | Review | Block | Golden |
|---------|-----------|----------|-------|--------|-------|--------|
| Smash   | PHOTO     | 10       | 10    | 0      | 0     | PASS |
| Veroni  | PDF       | 88*      | 88    | 0      | 0     | PASS (V2) |
| Third   | PDF (Thai)| 16       | 16    | 0      | 0     | PASS |

\*Source extract 107 → TargetMenu 88 after constitution-valid OCR/meta drops. Status totals reconcile on TargetMenu productCount.

---

**STOP.** No live Create. No live QA mutation.
