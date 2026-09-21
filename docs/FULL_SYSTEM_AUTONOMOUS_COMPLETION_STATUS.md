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
| **WP-E** | Two price-extraction defects, both TRUE DEFECTS: (1) `layoutExtract.ts` line ~319 price-floor filter `v >= 50 && v <= 400` rejects valid low prices like 48kr soups (dishes 1-2: Kyllingesuppe/Pekingsuppe). (2) No sub-section group-price inheritance: PDF prints ONE price on the first dish of a protein sub-section (Seafood 148,-/And 148,-/Oksekød 138,-/Kylling 128,-/Svinekød 128,-) and subsequent dishes in that group share it, but the extractor only binds price to the first item, leaving 14 sibling dishes at `basePrice:0 SYSTEM_DEFAULT`. | EXTRACTION / STRUCTURAL MAPPING | NOT STARTED — queued, blocks 16/49 failed checks (highest-value single fix). Exact target prices documented: dishes 9-10→14800, 12-13→14800, 15-17→13800, 19-22→12800, 24-26→12800 (øre). |
| **WP-F** | `completeProductCard.ts` ~line 239: `/pizza|calzone|ufo|indbagt|bambino/i.test(name)` triggers Italian pizza-topping injection (Tomat/Ost/Skinke) on ANY dish containing Danish "indbagt" (= battered/deep-fried), incorrectly firing on Asian dishes: "Japanske indbagte rejer", "Indbagte tigerrejer", "Indbagt kylling". This is a genuine silent-fabrication bug (hallucinated ingredients), not a review case. | INGREDIENT RESOLUTION / SEMANTIC COMPLETENESS | NOT STARTED — queued. High priority per correctness/safety precedence; must gate pizza defaults on family===PIZZA or category context, not a bare name-substring match. Must NOT regress Veroni's actual pizza/calzone dishes. |
| **WP-G** | (a) PDF footer/navigation junk ingested as ingredient/description text: "SUPPE MENU PDF RING...", "(https://restaurantjin.dk)" etc. (b) Section subtitle "Mad til familiens yngste medlemmer" (under Børnemenu header) extracted as a standalone product + phantom combo. (c) Phantom combos "Små forårsruller Menu"/"...Menu" created from course fragments of PDF page-3's real fixed-price set menus ("A: Luksus menu 198,-", "B: Luksus menu 178,-"), which themselves were NOT correctly structured as combos. (d) Dish #33 ("Kylling på spyd med pommes frites") dropped near the Børnemenu boundary. | INGESTION / ENTITY CLASSIFICATION / COMBO LOGIC | NOT STARTED — queued, lower priority (2/49 failed checks + cleanliness), same generic-mechanism family as WP-B's ghost-header fix. |

### Genuine REVIEW cases confirmed by Architect (do NOT force-fix these)
- Sparse dishes with zero printed recipe detail (e.g. "Kyllingesuppe 48,-") correctly require MANUAL_REVIEW rather than hallucinating ingredients.
- Page 2 "Kinesisk buffet (All you can eat)" with Mon-Thu/Fri-Sun tiered + child-discount pricing is a dine-in buffet structure poorly suited to a deterministic takeaway engine — correctly left REVIEW; if ever supported, needs a restaurant-fact/approved-template mechanism, not a generic heuristic.

### Sequencing rationale
WP-D (in flight) first: most severe architecture-invariant violation (explicit restaurant-specific hardcoding), contained/mechanical scope. WP-E next: highest failed-check count (16/49), moderate regression risk (price attribution logic) — needs isolated before/after scrutiny once WP-D's branch state is settled. WP-F: safety-critical hallucination fix, independent of WP-D/E files. WP-G: smallest/lowest-risk, same family as already-proven WP-B fix.

## Not Yet Started (per mission Section 5 onward)

- Discovery cohort expansion beyond current 3 merchants + dedicated Validation Holdout cohort (Section 5)
- Extraction completeness / TODO-FIXME-HACK audit (Section 6)
- Source coverage fail-closed audit (Section 7)
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
