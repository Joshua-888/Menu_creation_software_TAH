# Project status — TakeAwayHero Menu Creation Platform

**Authoritative architecture:** [MENU_PLATFORM_ARCHITECTURE_V1](architecture/MENU_PLATFORM_ARCHITECTURE_V1.md)  
**Constitution:** `MenuConstitutionV1`  
**Pipeline:** `MenuCorePipelineV1`  
**Capability matrix:** `TahCapabilityMatrixV1`

This file is the operational source of truth for *what is certified now*.  
Architecture V1 freeze documents remain the product design. Historical incident reports stay historical.

---

## What is built

The frozen V1 pipeline:

```text
RAW SOURCE → extraction → SourceMenu → MenuIntelligenceEngine → TargetMenu
→ MenuQualityContract → operator preview → explicit approval → immutable WritePlan
→ destination execution → readback → field-aware verification
→ VERIFIED_COMPLETE_HIDDEN → PublicationPlan → storefront verification → VERIFIED_LIVE
```

No business intelligence after TargetMenu. Create and QA share `completeProductCard`.

V1 product scope (CREATE): PDF and JPEG sources, extraction, professional TargetMenu (categories, products, prices, variants, ingredients, evidence-backed additions, combo/menu semantics, supported ProductChoice), quality contract, dry-run plan, explicit operator approval, CREATE against an empty destination, Playwright TAH admin execution, readback, semantic verification, recovery from partial/ambiguous writes.

---

## Production SHAs

| Record | SHA | Notes |
|--------|-----|--------|
| `CURRENT_LOCAL_HEAD` (committed main) | `75e1c32e6b7a676e1f3b3829f2d8b286d21f7635` | Chromium bake during `portal:build` |
| `CURRENT_MAIN_SHA` (origin/main) | `75e1c32e6b7a676e1f3b3829f2d8b286d21f7635` | Matches local HEAD |
| `DEPLOYED_SHA` (`/api/version`) | `97ab093a0cd91554e2398ce68f2b83fe7f74f815` | Railway `GIT_COMMIT_SHA` pin |
| `DEPLOY_MATCH` | **NO** | Production version endpoint does not report current main |

Intelligence + deploy-provenance + login/cookie hardening exist in the **local working tree** and are **not** on `origin/main` until committed and pushed. Established deploy path: push GitHub `main` → Railway.

---

## What is certified

| Capability | State |
|------------|--------|
| Architecture V1 freeze | Frozen 2026-09-16 |
| `npm run check:ship` | GREEN on the local CREATE V1 working tree (domain 49, unit 289, contract 92, certification 31, extraction 26, portal 23; `portal:build` compiled) |
| `npm run lint` | GREEN |
| Smash RAW photo intelligence | CERTIFIED (ship gate) |
| Veroni RAW PDF intelligence | CERTIFIED (ship gate; non-burger derived Menuer stay REVIEW) |
| Bella RAW JPEG → TargetMenu | **LOCAL CERT:** 12 source / 12 target / 0 open questions / `MENU_QUALITY_READY` |
| Playwright snapshot timeout / no infinite ARTIFACTS hang | Code path present; failed login returns deterministic `source=empty` + error (does not hang) |
| Historical Bella live menu (pre-empty) | Historical `VERIFIED_LIVE` via recovery scripts — **not** the current emptied CREATE canary |

---

## What is not certified

| Capability | State |
|------------|--------|
| Bella full CREATE E2E on emptied production destination | **NOT VERIFIED** |
| Live destination snapshot of `bellakebab.dk` | **FAIL** — admin login stayed on `/login` |
| Production runtime = current main | **NO** (`DEPLOY_MATCH=NO`) |
| CREATE-only WritePlan against a proven-empty Bella | Not generated (live destination unread) |
| Operator-approved live writes | Not started |
| 12/12 live readback verification | Not started |
| Publication / storefront recert on emptied Bella | Out of current CREATE V1 proof until CREATE verifies |
| URL ingestion, image upload UI, broad UPDATE, auto-delete, autonomous publication | Post-V1 gaps |

---

## Bella CREATE V1 canary

- **Only authorized live destination:** `bellakebab.dk` (Bella Kebab)
- Operator emptied the destination for a full 12-product CREATE test
- If Bella is not empty at pre-write snapshot: **stop** — do not delete
- Do not resume stale ARTIFACTS jobs; require a fresh snapshot + fresh WritePlan
- Explicit approval of the exact bound hashes is mandatory (`HUMAN_ACTION_REQUIRED = APPROVE_BELLA_WRITE_PLAN`)

### Local TargetMenu (not a live write)

- Source: `fixtures/golden/bella-kebab/raw-source.jpeg`
- `SOURCE_PRODUCTS = 12`
- `TARGET_PRODUCTS = 12`
- `OPEN_QUESTIONS = 0`
- `QUALITY_STATUS = MENU_QUALITY_READY`
- Combos keep printed sides; wraps keep filling + bread; derived-menu OCR is not copied as combo contents

---

## Remaining V1 blockers

1. **CODE/HUMAN:** Commit + push the local CREATE V1 working tree, then confirm `/api/version` matches the pushed SHA (`DEPLOY_MATCH=YES`). Also unset leftover Railway `GIT_COMMIT_SHA=97ab093…` if it still overrides baked provenance.
2. **HUMAN/EXTERNAL:** TAH admin login to `https://bellakebab.dk/login` must be classified (`LOGIN_OK` / `CREDENTIALS_REJECTED` / form/cookie/session/network) rather than treated as “still on /login”. Run `npx tsx scripts/diagnose-tah-admin-login.ts`. If credentials are rejected: `HUMAN_ACTION_REQUIRED = VERIFY_TAH_ADMIN_CREDENTIALS`.
3. **HUMAN:** After live snapshot proves `DESTINATION_PRODUCTS=0` and `DESTINATION_CATEGORIES=0`, approve the exact CREATE-only WritePlan hashes. Do not treat review=0 or an old job as approval.
4. **HUMAN:** Cancel/archive any stale Bella Create job in ARTIFACTS on production through the portal cancel action (do not resume it). Portal bootstrap credentials are not in local `.env`, so this was not done from here.

Until (1)+(2) succeed, **do not live-write**. An empty fallback snapshot is not proof that Bella is empty.

---

## Next validation step

1. Deploy matching SHA  
2. READ-ONLY `npx tsx scripts/smoke-create-dest-snapshot.ts bellakebab.dk` → `SNAPSHOT_SOURCE=live`, empty dest  
3. Fresh Create job on production path → immutable CREATE-only plan  
4. `HUMAN_ACTION_REQUIRED = APPROVE_BELLA_WRITE_PLAN`  
5. Execute → readback → 12/12 semantic verify → `BELLA_FULL_CREATE_E2E = VERIFIED`  
6. Then, separately, PublicationPlan if operator authorizes visibility-only publish  

---

## Post-V1 capability gaps

- Direct URL extraction  
- Image upload beyond current Create file ingest  
- Broad arbitrary UPDATE / menu replacement  
- Generic auto-delete / reset of other customers  
- Native ProductChoice UI if TAH does not support it  
- Fully autonomous publication  
- Future learning experiments  

Do not hold CREATE V1 for these.
