# PLAN.md — TakeAwayHero Menu Migration Platform

## Purpose

Production-grade restaurant menu migration into TakeAwayHero admin.

Maximum **verified correctness** over autonomy. AI only where interpretation is required; deterministic code for numbering, pricing, validation, writes, read-back, and audit.

## Decision priority

1. correctness  
2. prevention of silent errors  
3. auditability  
4. recoverability  
5. testability  
6. versionability  
7. maintainability  
8. operator usability  
9. performance  
10. autonomy  

## Pipeline

```text
SOURCE → EXTRACTION → SOURCE MODEL → NORMALIZATION → CANONICAL MENU
  → DOMAIN RULE ENGINE → VALIDATION → HUMAN REVIEW → APPROVED MENU
  → WRITE PLAN → ADMIN CONTRACT CHECK → PLAYWRIGHT → READ BACK
  → NORMALIZE DESTINATION → COMPARE → VERIFIED | FAILED
```

Extraction never writes to TakeAwayHero. Browser automation never makes menu-business decisions. A click/save is not success — only `VERIFIED` after read-back compare.

## Module boundaries

| Module | Role | May depend on |
|--------|------|----------------|
| `src/domain` | Schema, numbering, pricing, ingredients, validation | nothing external |
| `src/extraction` | Source adapters + LLM behind interfaces | domain types only |
| `src/review` | Corrections, approval | domain types |
| `src/tah` | Admin adapters, probe, verifier | domain types; Playwright only inside adapters |
| `src/runs` | Persistence, artifacts, errors | domain types |
| `src/runner` | Planner + executor | domain, tah, runs |

**Hard rule:** `domain` must never import Playwright or AI clients.

## Milestones

| ID | Scope | Writes TAH? |
|----|--------|-------------|
| **M0** | Architecture, docs, Cursor memory, type-only contracts | No |
| **M1** | Deterministic domain engine + tests | No |
| **M2** | Playwright **read-only** discovery of the **exact supplied** admin URL + AdminContract probe | No (read-only inspection only) |
| **M3** | WRITE + READ-BACK against **canary** restaurant only | Canary only |
| **M4** | WritePlan, idempotency, resume, artifacts | Canary |
| **M5** | Source extraction (HTML → PDF → image) | No new write path |
| **M6** | Human review UI + CorrectionEvent | No |
| **M7** | Admin drift / repair / adapter certification | Canary until certified |
| **M8** | Production hardening | After certification |

**Current stop:** Milestone 1 complete and frozen. Milestone 2 starts only with an **explicitly supplied** restaurant admin URL (no host guessing). M2 is strictly read-only.

## Architecture locks (pre-M1)

1. Stable `sourceId` on every category/product/choice-relevant entity; ProductChoice references IDs, not names.
2. Menu numbers are strings; alphanumeric preserved; only pure integers after trim enter `highestExistingNumericMenuNumber` (no numeric-prefix extraction).
3. `DUPLICATE_SOURCE_MENU_NUMBER` → `MANUAL_REVIEW_REQUIRED`; `DUPLICATE_ASSIGNED_MENU_NUMBER` → `BLOCKED`.
4. `ValueOrigin`: `SOURCE | DERIVED | SYSTEM_DEFAULT | HUMAN_CORRECTION` (not a boolean).
5. Both total + explicit surcharge → conflict check; mismatch → `SOURCE_PRICE_CONFLICT` / review.
6. Base-variant aliases: trim, lowercase, punctuation normalize; explicit alias list only.
7. Ingredient merge: preserve order, case/whitespace-insensitive dedup; choices never flatten into ingredients.
8. Property tests (`fast-check`) for numbering, pricing, purity, determinism.
9. Status aggregation: `BLOCKED > MANUAL_REVIEW_REQUIRED > WARNING > READY` in one function.
10. M2 = read-only Playwright; M3 = first writes (canary).

## M1 acceptance

- [x] CanonicalMenu / SourceMenu Zod schemas
- [x] Domain engine pure functions
- [x] Fixture + property tests pass
- [x] `npm run typecheck` and `npm run check` pass
- [x] No Playwright / AI / SQLite runner

## Assumptions

- Money is DKK as integer **øre** (`MoneyMinor`).
- Default injected variant display name is `Alm.` with `SYSTEM_DEFAULT` origin.
- Menu numbers are strings; highest numeric uses `/^\d+$/` after trim only.
- TakeAwayHero admin UI details from the master spec are **provisional** until M2 discovery.
- No backend menu import API exists yet.
- Destination uniqueness of menu numbers is **unknown** until AdminContract discovery.

## Risks

- Real admin may diverge from provisional routes/fields (mitigate in M2).
- Incomplete size-hierarchy aliases → fail to `AMBIGUOUS_BASE_VARIANT` (extend via fixtures).
- Extractors may see mixed price formats (`89` vs `89,00`) — convert only at extraction boundary.
- Canary restaurant must exist before M3.

## Learning loops (design only until later milestones)

- **Loop A (source patterns):** correction → fixture → failing test → fix → regression green → merge.
- **Loop B (admin UI):** drift → block writes → repair mode → new adapter version → canary certify → activate.

Never mix the two. Never promote a single restaurant correction to a global rule without the fixture/test path.
