# FULL_SYSTEM_AUTONOMOUS_COMPLETION_V1 — Mission Status

> Durable, crash-survivable mission state. A new Supervisor session must be able to
> recover from this file + repository state alone, without conversation memory.
> Update after every meaningful checkpoint.

## Mission

FULL_SYSTEM_AUTONOMOUS_COMPLETION_V1 — complete the blind pilot, harden the full
core pipeline, then perform a major Menu Operator UX/UI transformation, stopping
only at explicit human-authorization boundaries (live customer mutation).

## Current HEAD / Branch

- Branch: `mission/new-merchant-blind-pilot-v1`
- HEAD: `f0f0475ded146fc233b5b9b68aac1cf29473c101`
- Base: `main @ b169451` (all SEMANTIC_COMPLETENESS_ENGINE_V1 WP1-WP6 merged)
- Working tree: clean (only untracked `.a0proj/`, which is Agent Zero runtime state, not repo content)
- This mission is nested under the master mission FULL_SYSTEM_AUTONOMOUS_COMPLETION_V1; current phase remains Phase 1 (blind pilot) — see Master Mission Context below.

## Current Phase

**PHASE 1: NEW_MERCHANT_BLIND_PILOT_V1 completion** (mission Section 4)

### Gevninge Pizza & Grill — FORMALLY DEFERRED (external blocker, not a repo defect)
- Attempt 1 (original mission): direct HTTP fetch → HTTP 454/455 (Simply.com hosting WAF challenge page).
- Attempt 2 (this session, final retry before formal deferral): `curl` with full browser User-Agent + Accept-Language headers → HTTP 403. Headless Chromium via Playwright (`{waitUntil:'domcontentloaded'}`) → HTTP 454, page title "Checking your browser..." (live JS bot-challenge, not a static block page). Wayback Machine (`archive.org/wayback/available`) → zero snapshots exist for this domain.
- Conclusion: genuine, evidence-backed external blocker. Defeating a live WAF JS challenge would require bot-challenge circumvention, which is out of scope for legitimate source acquisition (distinct from the earlier Gaza-landing-page-vs-PDF and Jin-cookie-banner acquisition fixes, which only involved correctly locating/dismissing UI elements, not defeating anti-bot defenses).
- Status: DEFERRED. Not counted in the Discovery cohort. If the owner can supply an alternative source (PDF export, photos, or a direct file) for this merchant, it can be added later.

## Work Package Ledger

| WP | Description | Status | Commit | Reviewer | QA |
|---|---|---|---|---|---|
| WP0 | Blind-pilot harness script (`scripts/pilot-run-merchant.ts`) | DONE | 88e1c8d | N/A (tooling) | N/A (tooling) |
| WP-A | Generic 'NNN DKK' price-suffix recognition (extraction) | DONE | d47f343 | PASS | PASS |
| WP-B | Sub-section-header ghost-product elimination + stale PIZZA page-fallback fix | DONE | 752f24c | PASS | PASS |
| WP-C | Ingest-level PDF text-item de-duplication (Gaza Grill); multi-column reconstruction attempted, found geometrically unsafe, deliberately deferred | **DONE** | 421ea39 | PASS | PASS |

### WP-C outcome (final)

- SHIPPED: `dedupePdfTextItems()` in `src/extraction/pdf/ingest.ts` — epsilon-based (x/y within 2px) spatial+text duplicate collapse, prefers rendered (width>0) over zero-width ghost runs. Verified: Gaza P2 340→162 raw items. Zero regression on all 4 golden fixtures (32/32 certification, Veroni exact parity READY 76/REVIEW 11/BLOCKED 1/productCount 88). New tests: `tests/unit/pdf-item-dedup.test.ts` (8 tests, positive+negative cases). Full suite: 572/572 unit, 26/26 extraction.
- DEFERRED (evidence-based, NOT a shortcut): confidence-gated multi-column reconstruction (`partitionPageColumns`) was implemented per Architect's original plan, then measured against the real Gaza PDF and found geometrically unsatisfiable — max middle-third gutter widths were 0px (P2)/0px (P3)/24px (P4), all below the required 25px safety threshold. Root cause: centered elements ('Mezze' ~9% page width, 'Vegetarisk' ~8% page width) and full-width bilingual intro prose sit exactly in the only candidate gutter corridor and cannot be excluded by a width filter. Row-level gutter detection was also evaluated and rejected as fragile (asymmetric column line-heights would fragment wrapped descriptions). Architect explicitly recommended deferring full 2D layout segmentation to a dedicated future milestone rather than weakening the safety gate. The column-split code was pruned entirely from the shipped commit (no dead code).
- RESULT ON GAZA: sourceProductCount 9 / targetProducts 9 / MENU_QUALITY_REVIEW / ready 4 / review 5 / blocked 0 — an honest, modest improvement (clean deduped lines) without a fabricated big win. Two known residual limitations block full Gaza recovery: (1) deferred 2D column reconstruction above, (2) `isCredibleDishTitle` in `namePriceExtract.ts` rejects Gaza's all-caps dish titles (FALAFEL/FATTOUSH/HUMMUS/SHAWARMA) — tracked as candidate **WP-D**, out of scope for WP-C, untouched.
- PROCESS NOTE: first Reviewer and first QA invocations both returned malformed responses using the wrong role's status-line format (echoing 'REVIEW STATUS:' when 'QA STATUS:' was required, or narrating implementation activity instead of independent verification). Both were corrected on retry with an explicit format lock + forbidding any file edits + requiring distinct negative-case checks. Valid PASS obtained from both on retry with concrete, independently-executed command evidence.

## Blind-Pilot Merchant Cohort (Discovery, current)

| Merchant | Frozen source | Checksum file | Status |
|---|---|---|---|
| Restaurant Jin, Herning | `/a0/usr/workdir/pilot/frozen_sources/restaurant-jin-herning-v2-clean.pdf` (cookie-banner dismissed before capture — v1 was contaminated with Cookiebot consent-banner text, do not use v1) | `/a0/usr/workdir/pilot/frozen_sources/CHECKSUMS.sha256` | Baselined + WP-B fix applied. Post-WP-B: 36 source/target products (was 52 with ghosts, was 60 with cookie contamination). Still `MENU_QUALITY_BLOCKED` (49 failed checks) — semantic audit of remaining blockers not yet done. |
| Gaza Grill Nordhavn | `/a0/usr/workdir/pilot/frozen_sources/gaza-grill-nordhavn-v2-corrected.pdf` (direct Shopify CDN PDF — v1 was the wrong artifact, a link-out landing page, do not use v1) | same | Baselined + WP-A fix applied (0→6 products). WP-C (multi-column + dedup) in progress to recover more of the true ~24-30 item mezze section. |
| Gevninge Pizza & Grill | `/a0/usr/workdir/pilot/frozen_sources/gevninge-pizza-grill.pdf` (WAF-blocked capture — contains only the site's 403 block page, NOT usable) | same | **DEFERRED — genuine external blocker.** Simply.com hosting WAF returns HTTP 454/455 to every fetch method tried (curl w/ realistic headers, www/non-www/http, real headless Chromium). Wayback Machine also transiently 503'd during retry. Not a repo/tool defect. Retry later or ask user for an alternate source (e.g. a manually-provided PDF/photo) if this merchant is still wanted. |

## Known Limitations / Deferred Items

1. Gaza Grill: even after WP-C's column/dedup fix, an all-caps title filter in `isCredibleDishTitle` will likely still suppress some dishes (FALAFEL, FATTOUSH, HUMMUS, SHAWARMA are printed all-caps). Tracked as candidate **WP-D**.
2. Restaurant Jin: still `MENU_QUALITY_BLOCKED` after WP-B; the remaining 49 failed checks have not yet been manually audited (Section 3 semantic audit incomplete for this merchant).
3. Gevninge Pizza & Grill: fully deferred, external network blocker, not yet resolved.

## Restaurant Jin Manual Semantic Audit (Architect, read-only, complete)

Baseline: 36 source/target products, MENU_QUALITY_BLOCKED, 11 READY / 9 REVIEW / 16 BLOCKED, 49 failed checks (INGREDIENTS_COMPLETE:20, PRICE_SUPPORTED:16, DESCRIPTION_PROFESSIONAL:11, COMBO_STRUCTURE_VALID:2).

Confirmed: WP-B (ghost sub-header products) is fully resolved — 0 residual header-as-product entries.

### Corrective WP queue (Supervisor lettering — authoritative; two independent Architect audit passes agree on substance, minor P0/P1 vs D/E/F/G lettering differences reconciled below)

| WP | Root cause | Layer | Status |
|---|---|---|---|
| **WP-D** | Hardcoded `layoutExtract.ts` lines ~60-61: `/^forretter$/i -> "INDISK / Forretter"`, `/^hovedretter$/i -> "INDISK / Hovedretter"` — a Veroni-specific hack baked into the generic extractor, mislabeling Restaurant Jin's (Chinese restaurant) generic Danish "Forretter"/"Hovedretter" headings as Indian. Also: 22 dishes fall into `UNKNOWN` because `Supper`, `Oksekød`, `Kylling`, `Svinekød`, `And`, `Ris og nudler` aren't recognized as generic section headers. | EXTRACTION / STRUCTURAL MAPPING | **DONE** | f0f0475 | PASS | PASS |

### WP-D outcome (final)
- SHIPPED: generic `COURSE_SUB_HEADINGS`/`PARENT_SECTION_HEADINGS` composition in `layoutExtract.ts` — "Forretter"/"Hovedretter" only compose to "INDISK / ..." when an actual `INDISK` heading precedes them in-source (confirmed Veroni's real signal is its own printed `INDISK` heading, not the removed hardcoded string). Added generic headers: Supper, Seafood, And, Oksekød, Kylling, Svinekød, Ris og nudler, Børnemenu, Dessert. New tests: `tests/unit/pdf-section-header-extraction.test.ts` (15 tests). Full suite 576/576 unit, 32/32 certification (Veroni exact parity READY 76/REVIEW 11/BLOCKED 1/productCount 88), 26/26 extraction. Zero merchant-keyed hacks (grep-confirmed).
- RESULT ON JIN: INDISK/* dishes 9→0; UNKNOWN dishes 22→5 (honest, not forced — remaining 5 are genuine cross-page/un-headed source entries). Overall menu still MENU_QUALITY_BLOCKED pending WP-E/F/G.
- FLAGGED (non-blocking, deferred): `fixtures/golden/third-merchant/THAI_HOUSE_GOLDEN_V1.json` retains stale "INDISK / Forretter" labels from the removed hack; confirmed via grep that no test asserts this JSON's category field (script/archive consumers only). Requires a separate, properly-reviewed golden-update follow-up — not corrected here.
- Both Reviewer and QA independently re-ran full validation with concrete command evidence (see Reviewer/QA Notes below for the format-lock process now standard for this mission).
| **WP-E** | Two price-extraction defects: (1) claimed price-floor bug (48kr soups) — Builder investigated and found NOT reproducible; Jin's soups already correctly extracted at parent commit, no change needed (reported honestly rather than making an unnecessary change). (2) No sub-section group-price inheritance: PDF prints ONE price on the first dish of a protein sub-section and subsequent dishes in that group share it implicitly — TRUE DEFECT, fixed. | EXTRACTION / STRUCTURAL MAPPING | **DONE** | 174e521 | PASS | PASS |

### WP-E outcome (final)
- SHIPPED: new `src/extraction/pdf/sectionPriceInheritance.ts` — generic, boundary-safe group-price inheritance running AFTER dedup in `reconcile.ts`. Inherits a section's single-price token to subsequent priceless dishes in the SAME recognized section; stops at section boundaries, `UNKNOWN` sections, ambiguous multi-price entries, or multi-column (`alm_familie`) pricing modes; never overrides a dish's own explicit price. Inherited prices tagged `priceOrigin: DERIVED` (vs `SOURCE` for direct reads) — threaded through `SourceCandidate`/`SourceVariant` schema and `domain/pricing.ts` so `basePriceOrigin` honestly reflects provenance.
- SELF-CAUGHT REGRESSION (during implementation, before commit): an initial pre-dedup placement caused a duplicate page-3 read to fabricate a wrong price on Veroni dish #34 (105 instead of correct 130 from page 4). Fixed by moving the pass to run post-dedup. Both Reviewer and QA independently re-verified Veroni #34 = 13000 (130,-) after the fix.
- RESULT ON JIN: PRICE_SUPPORTED failures 14→0. Overall menuStatus MENU_QUALITY_BLOCKED→MENU_QUALITY_REVIEW; ready 12→13, review 10→23, blocked 14→0. Remaining 35 failed checks are INGREDIENTS_COMPLETE(21)/DESCRIPTION_PROFESSIONAL(12)/COMBO_STRUCTURE_VALID(2) — out of scope for WP-E, queued as WP-F/WP-G.
- Zero regressions: 583/583 unit, 32/32 certification (Veroni exact parity), 26/26 extraction. Zero merchant-keyed hacks (grep-confirmed).
| **WP-F** | TWO independent bare-token surfaces (`peerCohorts.ts` family classifier + `completeProductCard.ts` ingredient injector) triggering Italian pizza/calzone ingredient injection (Tomat/Ost/Skinke) on Danish "indbagt" (= battered/deep-fried, generic cooking method), incorrectly firing on Asian dishes: "Japanske indbagte rejer", "Indbagte tigerrejer", "Indbagt kylling". Genuine silent-fabrication bug. | INGREDIENT RESOLUTION / SEMANTIC COMPLETENESS | **DONE** | 4e6d4a7 | PASS | PASS |

### WP-F outcome (final)
- SHIPPED: removed 'indbagt' from both gates; kept `pizza|calzone|ufo|bambino` (verified genuinely pizza-shop-specific via Veroni's own category 'Indbagt, ufo og calzone' and names 'Ufo - Seetha'/'Tino Bambino'). Veroni's calzone classification confirmed independent of 'indbagt' — zero regression risk.
- RESULT ON JIN: 3 dishes previously fabricated ['Tomat','Ost','Skinke'] and falsely READY; now ZERO fabricated ingredients, honestly land in QUALITY_REVIEW (no replacement hallucination). Overall: ready 13→10, review 23→26, blocked 0→0.
- Zero regressions: 589/589 unit, 32/32 certification (Veroni exact parity, calzone toppings independently re-verified present), 26/26 extraction. Zero merchant-keyed hacks.
| **WP-G** | (a) PDF footer/navigation junk in ingredient/description text. (b) Section subtitle extracted as standalone product+phantom combo. (c) Phantom combos from unstructured page-3 fixed-price set menus. (d) Dish #33 dropped near Børnemenu boundary. | INGESTION / ENTITY CLASSIFICATION / COMBO LOGIC | **DONE (3/4 fixed, 1 deferred)** | dbe8ea0 | PASS | PASS |

### WP-G outcome (final)
- (a) FIXED: new `src/extraction/pdf/boilerplate.ts` — structural URL/email/embedded-path/nav-token detection, wired into layoutExtract + namePriceExtract before product grouping. No merchant-string matching.
- (b) FIXED: generic structural guard in `namePriceExtract.ts` — unnumbered priceless line after a recognized section header, followed within 3 lines by a numbered dish, treated as tagline not product. No literal Danish-phrase match.
- (c) DEFERRED (honest, not hidden): phantom combo #60 from page-3 fixed-price set menus remains. Builder determined a safe generic fix requires new combo-block-parsing architecture (a 'Letter: Name Price' set-menu-with-sub-listed-components parser); forcing a heuristic risked silently dropping real business content. Flagged as Architect-consultation candidate, same deferral pattern as WP-C's column-reconstruction.
- (d) FIXED: narrowed `reconcile.looksLikeBadProductName` (regression from earlier protein-leading-name guard) to accept ≥3-word dish phrases with a connecting preposition (på/med/i/af/uden/til), restoring dish #33 'Kylling på spyd med pommes frites'.
- RESULT ON JIN: products 36→35 (2 subtitle-products removed, 1 dropped dish restored), failedChecks 43→40, menuStatus still MENU_QUALITY_REVIEW. Phantom combo #60 remains as a known, explicitly-surfaced limitation (not hidden).
- Zero regressions: 595/595 unit, 32/32 certification (Veroni exact parity), 26/26 extraction. Zero merchant-keyed hacks (grep-confirmed, including the exact Danish phrases as literal strings).
- Non-blocking finding surfaced by Builder: `.a0proj/` was not in `.gitignore` (accidentally staged once during WP-G, correctly reset out of the commit) — **FIXED by Supervisor** (commit 4808ae7, added `.a0proj/` to `.gitignore` — this directory contains local `secrets.env`).

| **WP-H** | Blind-pilot merchant 'Gaza Grill Nordhavn' severely under-extracted (only 9/9 products) — root cause: all-caps dish-title rejection gate + a shared-regex `lastIndex` determinism bug (PRICE_LINE_RE/IMAGE_PRICE_LINE_RE `g`-flag state leaking between `.test()`/`matchAll` calls, silently skipping real price tokens depending on call order). | EXTRACTION / ENTITY CLASSIFICATION | **DONE (partial recovery + 1 honest deferral)** | d69bf75 | PASS | PASS |

### WP-H outcome (final)
- SHIPPED: `allCapsPricedDishTitle()` in `namePriceExtract.ts` — accepts an all-caps title ONLY when it carries exactly ONE printed price on its own line (structural signal distinguishing a real dish from a merged multi-column row or OCR/header blob); dietary markers (VE/V/GL/VG/GF/LF/EV) stripped as metadata, never glued into titles. Fixed shared-regex `lastIndex` reset before `matchAll` (order-independent now, verified across all fixtures).
- RESULT ON GAZA: source/target products 9→32/31. menuStatus REVIEW→BLOCKED — Reviewer independently confirmed this is a LEGITIMATE new finding (9 ready/20 review/2 blocked on genuinely newly-recovered real products), not a hidden regression. Recovered dishes verified with correct prices: TAHINI SALAD, SAMBOSAK, WARAK ENAB, BEEF SHAWARMA, CAULIFLOWER, etc.
- HONEST NON-RECOVERY: FATTOUSH independently confirmed absent from the raw source PDF entirely (not a pipeline defect — genuinely not printed in this merchant's menu).
- HONEST DEFERRAL: 'HUMMUS' is now correctly extracted (basePrice 85 DKK) but dropped at the INTELLIGENCE layer (`dropInvalidHeadings.ts`, reason TOPPING_TOKEN_AS_PRODUCT — 'hummus' is in the ingredient lexicon, misclassified as an ingredient token rather than a priced product row). Builder attempted a narrow price-aware exemption, but it REGRESSED Veroni certification (blocked 1→3) — REVERTED cleanly (diff-verified byte-identical to parent). Flagged as a genuine, separate intelligence-classifier finding requiring an Architect-owned, Veroni-aware objective — NOT fixed in this WP.
- Two merged multi-column source lines remain unsplit (e.g. 'MUHAMMARA 85 DKK BATATA HARRA 95 DKK') — correctly refused by the safety gate (exactly-one-price rule) rather than force-split; still covered by the deferred WP-C column-reconstruction limitation.
- Zero regressions: 608/608 unit, 32/32 certification (Veroni exact parity), 26/26 extraction. Zero merchant-keyed hacks in `src/` production code (grep-confirmed; test file references are permitted and flagged).

### Genuine REVIEW cases confirmed by Architect (do NOT force-fix these)
- Sparse dishes with zero printed recipe detail (e.g. "Kyllingesuppe 48,-") correctly require MANUAL_REVIEW rather than hallucinating ingredients.
- Page 2 "Kinesisk buffet (All you can eat)" with Mon-Thu/Fri-Sun tiered + child-discount pricing is a dine-in buffet structure poorly suited to a deterministic takeaway engine — correctly left REVIEW; if ever supported, needs a restaurant-fact/approved-template mechanism, not a generic heuristic.

### Sequencing rationale
WP-D (in flight) first: most severe architecture-invariant violation (explicit restaurant-specific hardcoding), contained/mechanical scope. WP-E next: highest failed-check count (16/49), moderate regression risk (price attribution logic) — needs isolated before/after scrutiny once WP-D's branch state is settled. WP-F: safety-critical hallucination fix, independent of WP-D/E files. WP-G: smallest/lowest-risk, same family as already-proven WP-B fix.

## Phase 2 — Core Pipeline Audits (started)

### Architect audit: Section 6 (extraction completeness) + Section 36 (side-door audit) — COMPLETE
Read-only audit performed on HEAD 72474c7 (before WP-I). Key findings:
- **PRODUCTION_SIDE_DOOR_BUSINESS_LOGIC = 0** confirmed: single authoritative `runMenuIntelligence` spine, zero parallel TargetMenu builders, zero legacy intelligence bypass, zero legacy direct-write routes, zero test-helpers-imported-by-production, zero undocumented CLI write paths. `scripts/archive/` historical scripts correctly classified per SCRIPT_CLASSIFICATION_V1 (host-locked/target-locked, non-production).
- **1 blocking finding** (fixed as WP-I below): `src/extraction/pdf/classify.ts` COVER_HINTS regex hardcoded Veroni-specific tokens (street/city/merchant name) — architectural violation.
- **Non-blocking findings** (logged, not yet actioned): minor doc drift in `docs/architecture/AUTHORITATIVE_PRODUCTION_ENTRY_POINTS.md` (script path descriptions stale vs actual `scripts/` layout — zero functional impact); a few extraction magic-number thresholds (`v >= 50 && v <= 400` price ranges, `x < 240` column-position assumption) flagged as POTENTIALLY fragile for edge-case merchants (very cheap/expensive items, non-standard layouts) but NOT proven defective by any evidence yet — deferred pending real blind-pilot evidence, per mission Section 10 guidance ("only address if real blind-pilot evidence demonstrates material blocking").

| WP-I | `classify.ts` COVER_HINTS hardcoded merchant tokens (ladingsvej/nykøbing/weron/veroni) | EXTRACTION / STRUCTURAL MAPPING | **DONE** | d5e8612 | PASS | PASS |

### WP-I outcome (final)
- SHIPPED: generalized COVER_HINTS to generic vocabulary only (cvr/tlf/telefon/adresse/åbningstider/facebook/instagram/bestilling/www/https). Empirically verified Veroni's actual cover page still matches via generic tokens present on that page (facebook/buffet/www.) — zero classification change, no structural fallback needed.
- Zero regressions: 611/611 unit, 32/32 certification (Veroni exact parity, page-1 COVER classification independently re-verified), 26/26 extraction, full check:ship gate green. Jin/Gaza blind-pilot re-run: zero drift (stash-based true before/after diff, 0 deltas).
- Zero merchant-specific strings remain anywhere in `src/` (grep-confirmed).

### Architect audit: Section 7 (source coverage fail-closed) — COMPLETE
Read-only audit performed on HEAD 56bd6cd. Key findings:
- **HTML/URL/JSON sources**: already fully fail-closed — no extractor exists, unsupported types explicitly throw or transition to `SOURCE_URL_PENDING` with an informative message. No action needed (verified via `src/portal/worker.ts` and `src/extraction/pdf/adapter.ts`).
- **Corrupt files, zero-product extraction, high-evidence-density-vs-low-product-count**: already fail-closed in `src/portal/worker.ts` (production path) via explicit throws.
- **GAP-1 (fixed as WP-J below)**: `SOURCE_PRODUCT_COVERAGE_SUSPICIOUS` was documented in `QUALITY_CONTRACT_REGISTRY_V1.md` as a universal quality-contract check but was only enforced ad-hoc in `portal/worker.ts` — NOT in the central `evaluateMenuQualityContract`, and NOT in the certification/blind-pilot harness. Architecture-vs-implementation inconsistency, low-risk to fix.
- **GAP-2/3/4 (deferred, NOT actioned)**: PDF raster/OCR-hydration page-skip heuristic, image-OCR-degradation-with-failed-vision-fallback, and per-page-yield tracking are all precautionary/theoretical findings with NO supporting evidence from actual blind-pilot runs (Jin/Gaza/all 4 golden fixtures are text-based PDFs; no scanned/mixed-page merchant has been tested). Per mission Section 10 ('only address if real evidence demonstrates material blocking'), correctly left unactioned pending real evidence — logged as known architecture debt for a future milestone if a scanned/photo-based merchant is ever added to the pilot cohort.

| WP-J | `SOURCE_PRODUCT_COVERAGE_SUSPICIOUS` documented as universal but only enforced in portal/worker.ts, not central quality contract or certification harness | QUALITY CONTRACT / OBSERVABILITY | **DONE** | 0bf8397 | PASS (2 rounds) | PASS |

### WP-J outcome (final)
- SHIPPED: `evaluateMenuQualityContract` now accepts optional pre-computed coverage evidence and surfaces `SOURCE_PRODUCT_COVERAGE_SUSPICIOUS` as a REVIEW-severity coherence finding (never auto-BLOCK) for ANY caller of the intelligence spine. `runMenuIntelligence` derives this via new `sourceCoverageEvidenceFromExtraction()`. Both `src/certification/runRawCertification.ts` (and thus the blind-pilot harness) and `src/portal/worker.ts` now share one evidence-composition path; portal worker RETAINS its stricter production hard-fail throw.
- JUDGMENT CALL (independently verified safe by Reviewer across 2 rounds + QA): recalibrated the underlying evidence-density predicate from bare 2-3 digit integers to currency-marked tokens only ('kr.'/'kr'/'DKK') — the old predicate would have false-flagged 5/6 real menus (Veroni 6.4x, Smash 10.2x, third-merchant 5.3x, Jin 4.7x, Gaza 6.5x) if applied universally. Verified as a strict narrowing (fewer false positives), not a weakening — production hard-fail in `portal/worker.ts` confirmed still intact and unbypassed.
- Zero regressions: 614/614 unit, 32/32 certification (Veroni exact parity, zero new coverage findings on any of the 4 golden fixtures), 26/26 extraction. Jin/Gaza blind-pilot re-runs: `coherenceFailures: 0` for both (no new false positives).
- Documentation updated: `docs/architecture/QUALITY_CONTRACT_REGISTRY_V1.md` now accurately describes central evaluation, evidence shape, and the retained stricter portal hard-fail (independently verified accurate by Reviewer).

### Architect audit: Sections 11+14 (live-write safety + security) — COMPLETE, ZERO BLOCKING FINDINGS
Read-only audit performed on HEAD 6ac1049. Result: **both sections certified fail-closed/secure, no corrective WP required.**
- **Live-write safety (Section 11)**: Traced the full 12-gate pipeline from operator-approval-click to real browser mutation (auth session → job-state → zero-open-questions → live-write-gate incl. kill-switch+credentials+allowlist+capability-cert → atomic status transition → lease → destination-write-lock → bundle/host/SHA binding → contract probe → fresh destination read-back+snapshot-hash comparison (rejects STALE_EXECUTION_BUNDLE) → pre-write gate → approved-plan-equals-executed-plan immutability check → dispatch). Kill-switch (`PORTAL_LIVE_WRITES=0`) is unambiguous and unbypassable (no debug endpoint, no test-flag leak). Deployment configs (railway.toml/nixpacks.toml/Procfile/.env.example) default to writes DISABLED unless explicit credentials + allowlist provided. Bella confirmed protected (not in default live-write host allowlist; separate hardcoded-authorization standalone scripts only).
- **Security (Section 14)**: Zero committed secrets (8 grep hits, all dummy test-fixture strings). `.gitignore`/`.dockerignore` correctly exclude `.env`, `*.sqlite`, `playwright/.auth/`, `.a0proj/`, `data/`. `.env.example` contains only placeholders. Session cookies signed+HttpOnly+SameSite=Lax. `data/portal/portal.sqlite*` confirmed NOT tracked in git. GitHub Actions workflow has zero secret interpolation/leak risk.
- **One non-blocking, optional hardening item** (explicitly deferred, not a defect): portal API routes rely on SameSite=Lax + signed session cookies for CSRF protection but lack an explicit Origin-header check. Architect assessed this as acceptable for an internal, credential-gated operator tool; recommended as optional defense-in-depth for a future hardening pass, not required now.

### Architect audit: Section 13 (recovery / failure durability) — COMPLETE, ZERO BLOCKING FINDINGS
Read-only audit performed on HEAD 640e381. Result: **recovery architecture certified robust, fail-closed, and fully compliant — no corrective WP required.**
- **Crash/restart durability**: every operation transition persisted to SQLite (WAL mode) before progressing; `job_leases` tracks last-completed-checkpoint; lease TTL 120s with `reclaimExpiredLeases` + `expireStaleInFlightJobs` preventing permanent deadlock on worker crash (explicit `WORKER_LEASE_EXPIRED` state, no automatic replay).
- **Read-before-retry**: `executePortalLiveWrites` always takes a fresh destination snapshot and validates bundle hash before continuing; `destination.findByIdentity()` checked before every create; `STALE_EXECUTION_BUNDLE`/`DESTINATION_SNAPSHOT_DRIFT` correctly halts on any live-state drift.
- **Bounded, classification-aware retry**: deterministic failure classification (`TRANSIENT_NETWORK`, `AUTH_SESSION_EXPIRED`, etc.) with bounded max-attempts and circuit-breaker on deterministic rejections (prevents cascading failures).
- **No destructive rollback**: verified — zero delete/reset calls reachable from any recovery/retry path; `neverAutoDelete: true` and `executeAutomatically: false` hardcoded in `RecoveryPlan`; empty-category compensation explicitly requires human approval (`autoDelete: false`).
- **Verified-operation reuse**: `VERIFIED` operations always skipped on replay; category/product existence checked against live destination before every create — duplicate creation on double-submit/retry is architecturally impossible.
- **One non-blocking operational note**: diagnostic-pack data is fully captured (blocker records + error JSON) but not serialized as one standalone `diagnostic-pack.json` file alongside `recovery-plan.json` — ergonomics only, not a safety gap.

## BLIND PILOT PHASE — CLOSED (per TAKEAWAYHERO_MENU_PLATFORM_FINISH_PROJECT_V1 directive)

**Discovery cohort** (sources actively used to drive generic fixes WP-A through WP-I): Restaurant Jin (Herning), Gaza Grill Nordhavn. Both reconfirmed stable at HEAD e136098: Jin 36 products (9 READY/27 REVIEW/0 BLOCKED, 41 failedChecks/0 coherenceFailures), Gaza 32→31 products (9 READY/20 REVIEW/2 BLOCKED, 39 failedChecks/0 coherenceFailures) — identical to pre-closure results, zero regression.

**Deferred external blocker**: Gevninge Pizza & Grill — hosting WAF blocks all automated access (HTTP 403/454, 2 independent attempts). No baseline possible. Documented, not pursued further.

**Validation Holdout cohort** (frozen, baselined, findings NOT used to drive a bespoke fix): Cafe Amalie Vorupør (image-based menu, steak/grill category — genuinely different source type [photo/JPEG vs. all prior text-PDF merchants] from the Discovery cohort). Baseline: 11 products, 0 READY/5 REVIEW/6 BLOCKED, `writeEligible: false`. Two findings logged as evidence only: (1) `ingredients unresolved for OTHER_FOOD (REQUIRED)` on self-descriptive grilled-meat cuts (Oksefilet/Oksemørbrad/Nakkekotelet) — likely a field-requirement-matrix false positive analogous to the prior mission's INDIAN_MAIN fix, to be considered as CORE-2 evidence, not a standalone WP; (2) a weight/price column-glue defect producing an invalid product name `"2009 kr."` and a duplicate `"500g kr."` — likely multi-column weight-price-table (200g/300g/400g/500g) extraction glitch, to be considered as CORE-1 evidence. **Both fail closed correctly (MENU_QUALITY_BLOCKED) — no dangerous silent output.**

**Additional Discovery evidence (not a new fix target)**: Sachi Sushi Helsingør — 32-page real text-PDF (confirmed via `pdftotext -layout`: genuine 3-column roll-menu layout, e.g. `SACHI ROLL | GEISHA ROLL | HONEY BEE ROLL` side-by-side). Extraction yielded only 1/many products. **This reconfirms the SAME root-cause family already investigated and deliberately deferred in WP-C** (Gaza's multi-column gutter-width was measured unsafe at 0-24px vs. the required ≥25px confidence gate to avoid corrupting single-column golden fixtures like Veroni). **Critically, WP-J's coverage-suspicion check (shipped in Section 7 audit) correctly caught this**: `writeEligible: false`, `SOURCE_PRODUCT_COVERAGE_SUSPICIOUS: evidence density 338.0x exceeds extracted products`. This is the safety net working exactly as designed — not a new defect, not a safety violation. No new WP created; multi-column PDF reconstruction remains documented known-limitation debt (GAP-2/3 from Section 7 audit), to be revisited only if a future controlled-live-test merchant requires it.

**Verdict**: Blind-pilot phase sufficiently validates the system's core safety property — genuine under-extraction and structural defects fail closed (REVIEW/BLOCKED, `writeEligible: false`) rather than silently producing plausible-looking-but-wrong menus. No HIGH-SEVERITY defect (wrong money, hallucinated product, dangerous write) was found in either the Discovery or Validation Holdout cohort. Per directive Section 6, ending blind-pilot phase and proceeding to CORE-1 through CORE-4 grouped milestones.

## Not Yet Started (per mission Section 5 onward)

- Discovery cohort expansion beyond current 3 merchants + dedicated Validation Holdout cohort (Section 5) — requires user-supplied new merchant sources
- Non-blocking Phase-2-audit doc-drift fix (AUTHORITATIVE_PRODUCTION_ENTRY_POINTS.md script paths) — low priority, zero functional impact
- GAP-2/3/4 from Section 7 audit (deferred, unevidenced — see above)
- Optional CSRF Origin-header hardening (Section 14, non-blocking, deferred)
- Optional diagnostic-pack file serialization (Section 13, non-blocking, deferred)
- Section 8 (semantic completeness re-audit), Section 9 (quality contract audit beyond WP-J), Section 10 (destination capabilities), Section 12 (ExecutionBundle/approval/verification — substantially covered by Section 11's 12-gate trace, remaining formal write-up optional), Section 15 (deployment readiness), Section 37 (docs alignment)
- Semantic Completeness Engine full audit (Section 8)
- Quality Contract audit (Section 9)
- Destination capability matrix audit (Section 10)
- Live-write safety audit (Section 11)
- Execution Bundle / Approval / Verification audit (Section 12)
- Recovery / failure durability audit (Section 13)
- Security audit (Section 14)
- Operational / deployment readiness audit (Section 15)
- Test system audit (Section 16)
- CORE STATUS: LIVE_TEST_READY checkpoint (Section 17)
- Full Menu Operator UX/UI transformation (Sections 18-34)
- End-to-end system walkthrough (Section 35)
- Side-door audit (Section 36)
- Documentation alignment (Section 37)
- Final validation + Definition of Done (Sections 40-41)

## Reviewer / QA Notes

- Both Reviewer and QA subordinates have twice returned mismatched-format responses (echoing the other role's format or the Builder's own report) before self-correcting on retry. When invoking either, ALWAYS explicitly state the required 'REVIEW STATUS:' or 'QA STATUS:' prefix and require the agent to actually execute commands rather than summarize, and re-prompt in the SAME context if the first response is malformed rather than assuming failure.

## Next Autonomous Action

Re-delegate WP-C to DeepSeek Builder using the exact Architect-approved plan above (the previous delegation call was interrupted before returning a result — no code changes exist yet). Then Reviewer -> QA -> commit -> continue to Restaurant Jin's remaining-blocker semantic audit, then proceed through mission Section 5 onward.

## GATE A — FULL RELEASE VALIDATION (blind-pilot phase closure) — GREEN

Run at HEAD 99ecf58. Results: typecheck PASS, lint PASS, `npm test` 614/614 (79 files), `test:extraction` 26/26, `test:certification` 32/32 (zero fixture drift: bella-kebab, smash, third-merchant, veroni all green). Blind-pilot phase formally CLOSED. Proceeding to CORE-1 (Extraction + Source Coverage) per TAKEAWAYHERO_MENU_PLATFORM_FINISH_PROJECT_V1 directive's four grouped core milestones.

## CORE-1 — EXTRACTION + SOURCE COVERAGE — COMPLETE (audit-only, zero fixes required)

Architect audit at HEAD ac6a8f8. Findings:
- **Hardcode sweep**: 0 TODO/FIXME/HACK/TEMP/XXX/BUG matches in src/extraction/. Zero merchant-specific branches, zero hardcoded destination hosts, zero arbitrary price fallbacks.
- **Cafe Amalie weight-table defect root-caused**: OCR confused sans-serif 'g' for '9' (`200g` -> `2009`), and `cleanName()` stripped the numeric price but left the `kr.` currency token, producing invalid product name `"2009 kr."`. Similarly two distinct weight rows (500g under OKSEFILET and OKSEMØRBRAD) both collapsed to residual name `"500g kr."`, triggering `NO_DUPLICATE_PRODUCTS`. **Confirmed LOW severity**: menu already correctly reaches `MENU_QUALITY_BLOCKED`/`writeEligible: false` via existing `invalid name (PRICE)`, `NO_OCR_GARBAGE`, `PRICE_UNSUPPORTED`, and `NO_DUPLICATE_PRODUCTS` gates — zero live-write risk, zero wrong-money risk. Architect explicitly recommends DEFERRING a full weight-table-matrix reconstruction (out of proportional CORE-1 scope) and flags an OPTIONAL minor `cleanName()` hygiene tweak (strip trailing bare `kr.`/weight-only fragments) as available if desired, but not required since existing fail-closed gates already fully contain the risk.
- **All other extraction pipeline areas** (PDF/image/OCR ingestion, line reconstruction, dedup, title/section detection, price extraction, menu numbers, variants/additions/combos, candidate merge, source accounting): confirmed SOUND, zero gaps.
- **Decision**: Per master directive priority ('fail closed on uncertain LOW/MEDIUM edge cases... document and move on'), accepting Architect's deferral recommendation. No Builder/Reviewer/QA cycle needed for CORE-1 — clean audit, no code change required. Proceeding directly to CORE-2.

## CORE-2 — SEMANTICS + QUALITY — COMPLETE (audit-only, zero fixes required)

Architect audit at HEAD c152463. Findings:
- **Cafe Amalie OTHER_FOOD ingredient-REQUIRED finding**: traced exact code path (fieldRequirements.ts -> ingredientSufficiency.ts -> qualityContract.ts). Cross-checked ALL 4 certified golden fixtures (Bella, Smash, Veroni, third-merchant/Thai) - NONE has an analogous single-token/self-descriptive meat-cut product resolving to READY under OTHER_FOOD; Veroni's 17 OTHER_FOOD products all have >=2 real ingredients. **Verdict: SAFE CONSERVATIVE BEHAVIOR, not a false positive** - current REQUIRED level correctly and consistently fails closed to QUALITY_REVIEW across the whole system. Weakening OTHER_FOOD globally would risk silently passing genuinely-incomplete dishes across all unclassified cuisines for zero evidenced benefit. DEFERRED - no fix warranted. (Separately, Amalie's underlying extraction produced garbled names like "2009 kr." due to the CORE-1 weight-table OCR issue, which is the primary/real cause of Amalie's BLOCKED status, not the ingredient-requirement logic itself.)
- **Broader sanity check** (evidence hierarchy, Menu-as-variant invariant, CONDITIONAL field-requirement determinism, no unsupported product-choice assumptions): all confirmed sound, zero gaps found.
- **Decision**: No code change. Proceeding directly to CORE-3.

## CORE-3 — DESTINATION + WRITE SAFETY + EXECUTION — COMPLETE (audit-only, zero fixes required)

Architect audit at HEAD a493429. All 5 targeted checks CONFIRMED SAFE:
1. **Credentials-alone test**: airtight - requires credentials AND non-killed flag AND host-allowlist AND capability-certification AND signed operator session AND explicit approval click AND lease/lock AND fresh snapshot-hash match AND pre-write gate AND approved-plan-equals-executed-plan. No single-gate bypass exists.
2. **Partial-mutation depth**: multi-op WritePlan failure after partial success produces distinct `PARTIAL_WRITE`/`RECOVERY_REQUIRED` state (not conflated with full success or no-mutation); recovery reads destination via `findByIdentity`/`listCategories` before any retry, preventing duplicates across the whole plan.
3. **Field-level readback**: `verifyProductFields()` compares 9 distinct fields individually (menuNumber, name, description, price, categories, variants, ingredients, additions, visibility) - not just existence-by-name.
4. **CREATE idempotency under ambiguity**: timeout/ambiguous-outcome creates always re-check destination state (`findByIdentity`) before any retry; `AMBIGUOUS` outcome with destination-not-found correctly BLOCKS rather than blindly retrying.
5. **Deterministic ExecutionBundle hashing**: `sha256Canonical()` key-sorts recursively before hashing - immune to object key-ordering non-determinism; any plan/menu/host/SHA/snapshot divergence triggers `APPROVED_PLAN_EXECUTION_MISMATCH`/`STALE_EXECUTION_BUNDLE`.

**Decision**: Zero gaps found across all 5 checks. No code change. Proceeding directly to CORE-4 (final grouped milestone).

## CORE-4 — RECOVERY + SECURITY + DEPLOYMENT + DOCS — COMPLETE (audit-only, zero HIGH-severity defects)

Architect audit at HEAD aaa0fc3. All 8 checks completed:
1. Path traversal: CONFIRMED SAFE (sanitized filenames, UUID-prefixed, server-generated job IDs).
2. SSRF: CONFIRMED SAFE (no user-directed fetch; HTML source ingestion explicitly refused; destination navigation bundle-bound).
3. XSS: CONFIRMED SAFE (React auto-escaping; only dangerouslySetInnerHTML use is fully static, zero dynamic interpolation).
4. SQL injection: CONFIRMED SAFE (all queries parameterized via better-sqlite3 `?` placeholders).
5. Dependency vulnerabilities: 1 moderate + 1 high advisory in postcss (transitive via next), build-time-only CSS compilation on repo-owned CSS, non-exploitable in production runtime. DEFERRED - fix requires breaking Next.js v16 upgrade, not justified this close to Gate B.
6. Version/SHA endpoint: CONFIRMED SAFE (`/api/version` exposes commitSha/buildTime/contractVersion; automation scripts verify MAIN_SHA==DEPLOYED_SHA).
7. Health check accuracy: Railway healthcheck (`/login`) is shallow liveness only; a proper deep-readiness endpoint (`/api/ready`, checks browserReady+configOk) already exists independently. DEFERRED - changing Railway's healthcheck path risks cold-start deployment races for no net safety gain since all live-write gates are independently enforced regardless.
8. Environment validation on startup: CONFIRMED SAFE (Zod-validated runtime config, fails closed with explicit diagnostic exceptions: INVALID_BOOLEAN_CONFIG, ADMIN_AUTH_MISSING, LIVE_WRITES_DISABLED).

Docs: `docs/PROJECT_STATUS.md` flagged stale by Architect (referenced prior mission/commit) - corrected by Supervisor to reflect current mission, HEAD, and CORE-1/2/3/4 completion.

**Decision**: Zero HIGH-severity defects across all 8 checks. Two LOW-severity items explicitly deferred with documented reasoning (non-blocking for LIVE_TEST_READY). All 4 CORE grouped milestones (CORE-1 through CORE-4) now COMPLETE. Proceeding to GATE B (full release validation) per master directive Section 8.

## GATE B — FULL RELEASE VALIDATION (CORE completion) — GREEN

Run at HEAD 1334f53. Full chain: typecheck && lint && npm test && test:extraction && test:certification && test:portal && portal:build && check:ship.

Results: typecheck PASS, lint PASS, `npm test` 614/614 (79 files: domain 56 + unit 466 + contract 92), `test:extraction` 26/26, `test:certification` 32/32 (zero fixture drift), `test:portal` 23/23 (6 files), `portal:build` compiled successfully (16/16 static pages, all routes built, Playwright Chromium confirmed present). `check:ship`'s internal re-run of typecheck/domain/unit/contract/certification/extraction/portal/build also 100% green with identical counts. Zero error/FAIL lines found anywhere in the full validation log.

============================================================
CORE STATUS: LIVE_TEST_READY
============================================================

All 4 CORE grouped milestones complete with zero HIGH-severity defects:
- CORE-1 (Extraction + Source Coverage): zero hardcodes/side-doors, all pipeline stages sound, blind-pilot edge cases (Sachi multi-column, Amalie weight-table OCR) confirmed to fail closed safely.
- CORE-2 (Semantics + Quality): field-requirement matrix confirmed consistent across all certified fixtures, evidence hierarchy/Menu-variant-invariant/CONDITIONAL-determinism/product-choice-safety all sound.
- CORE-3 (Destination + Write Safety + Execution): credentials-alone cannot enable writes (12-gate pipeline airtight), partial-mutation correctly distinguished and recoverable, field-level readback confirmed (9 comparators), CREATE idempotency under ambiguity confirmed, ExecutionBundle hashing deterministic/canonical.
- CORE-4 (Recovery + Security + Deployment + Docs): zero path-traversal/SSRF/XSS/SQLi findings, environment validation fails closed, version/SHA endpoint and readiness endpoint both sound, PROJECT_STATUS.md corrected. Two LOW-severity items deferred with documented reasoning (postcss build-time-only advisory; Railway healthcheck shallow-liveness vs. already-existing deep /api/ready).

Blind-pilot phase closed with zero HIGH-severity defects. Gate A and Gate B both fully green.

**Per master directive Section 8: DO NOT STOP. Proceeding immediately to UI/UX (AUTONOMOUS_MENU_OPERATOR_UX_V2, starting with UI-1).**

## UI-1 — INFORMATION ARCHITECTURE + RESTAURANT WORKFLOW — COMPLETE

Architect audit confirmed portal is NOT greenfield: nav shell, merchant dashboard, job creation, review queue, policy panel, live-write gates, approval API already existed and working. Genuine gaps closed by Builder (commit 596f59b):
1. Design-system primitives (`apps/portal/src/components/ui/`: Badge, Button, Panel, StatTile, Table) - thin wrappers over existing CSS classes, no redesign.
2. Restaurant-centric dashboard on `/jobs` - one row per restaurant via existing restaurantKey grouping.
3. New `/restaurants/[key]` history page backed by new `store.listJobsForRestaurant()` (plain parameterized SELECT).
4. Streamlined `/jobs/new` + `/jobs/qa` with existing-restaurant selection dropdown.

Reviewer PASS: confirmed no backend/worker/domain/auth changes, parameterized SQL, thin CSS wrappers, no regressions.
QA PASS: independently re-ran typecheck/lint/portal:build/vitest (all green, 25/25 portal tests), PLUS live-server end-to-end validation - GET /restaurants/veronipizza.dk returned HTTP 200 with correct content, GET /restaurants/nonexistent.dk returned HTTP 404 via graceful notFound(). Test-diff inspection confirmed pure additions, zero weakened assertions.

17 files changed, 664 insertions. Zero regressions. Commit: 596f59b.

**Proceeding to UI-2 (Menu + QA + Review) per master directive continuation mandate.**
