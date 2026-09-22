# Project status — TakeAwayHero Menu Creation Platform

**Authoritative architecture:** [MENU_PLATFORM_ARCHITECTURE_V1](architecture/MENU_PLATFORM_ARCHITECTURE_V1.md)  
**Operations:** [OPERATIONAL_HARDENING_V1](architecture/OPERATIONAL_HARDENING_V1.md)  
**Executable approval:** [EXECUTION_BUNDLE_V1](architecture/EXECUTION_BUNDLE_V1.md)  
**Runtime/recovery:** [RUNTIME_AND_RECOVERY_V1](architecture/RUNTIME_AND_RECOVERY_V1.md)

This file is the operational source of truth for *what is certified now*.

---

## Production SHAs

| Record | SHA | Notes |
|--------|-----|--------|
| `BASE_SHA` (hardening start) | `a15333a78e96bdf0771447cbb87bbb20411d6300` | Blocker resilience + CREATE circuit breaker |
| `CURRENT_LOCAL_HEAD` | see `git rev-parse HEAD` after Operational Hardening V1 commits | |
| `DEPLOYED_SHA` | confirm via `/api/version` | Must match HEAD after Railway deploy |
| `DEPLOY_MATCH` | confirm after deploy | Required: `MAIN_SHA == DEPLOYED_SHA` |

Canonical path: `main` → CI `check-ship` green → Railway image (Chromium baked) → `/api/version`. `railway up` is emergency only.

---

## Operational Hardening V1

Implemented on this tree:

- Approval binds `ExecutionBundleV1` (exact operations, no post-approval replan)
- Pre-write host/contract/auth/snapshot/SHA evidence gate
- Deny-by-default live writes (`PORTAL_LIVE_WRITES` + bundle host; unset allowlist is **not** `*`)
- Durable job leases, heartbeats, destination write lock, watchdog reclaim
- `LIVE_COMPLETE` snapshots only; FAILED/offline/partial cannot look like empty catalogs
- Pagination until end or `SNAPSHOT_TRUNCATED`
- BlockerRecord + DiagnosticPack + classification-aware retry
- Playwright Chromium baked; runtime asserts executable, does not download
- BrowserRuntime: one browser / process, context per job
- Deep snapshot: 1 catalog list + N edit reads when `listRow` is passed
- RuntimeConfig fail-fast; SQLite WAL + busy_timeout + foreign_keys
- RecoveryPlan V2: never auto-delete; reuse verified objects
- `npm run check:fast` + parallel CI + full `check:ship`

`npm run check:ship` GREEN (as of TAKEAWAYHERO_MENU_PLATFORM_FINISH_PROJECT_V1 directive, branch `mission/new-merchant-blind-pilot-v1`, commit aaa0fc3: `npm test` 614/614 passing across domain+unit+contract, 79 files; `test:certification` 32/32 across 10 files, zero fixture drift; `test:extraction` 26/26; portal:build compiled). Blind-pilot phase closed (Discovery: Restaurant Jin, Gaza Grill Nordhavn; Validation Holdout: Cafe Amalie Vorupør; deferred: Gevninge Pizza & Grill, external WAF blocker; Sachi Sushi confirmed existing multi-column limitation safely fails closed). CORE-1 (extraction/source-coverage), CORE-2 (semantics/quality), CORE-3 (destination/write-safety/execution), and CORE-4 (recovery/security/deployment/docs) grouped milestones all audited complete with zero HIGH-severity defects. Note: granular per-suite counts above were last independently re-verified as aggregate totals; see `docs/FULL_SYSTEM_AUTONOMOUS_COMPLETION_STATUS.md` for the current mission's live checkpoint ledger.  
`npm run lint` GREEN.

---

## Bella — do not mutate in this objective

Observed destination (do not delete/recreate):

- categories: Burgers 7, Menuer 8, Durum 9, Pita 10, Kebab 11
- products: 0

No Bella product CREATE. No empty-ingredients diagnostic. Ingredient A/B remains a future explicitly approved operation.

---

## Remaining operational risks

- Railway volume `/data/portal` must remain mounted; startup warns/fails if production data is not on `/data`.
- One writer replica only while SQLite is the job/lease store.
- TAH CREATE HTTP 500 on Bella is still an external application exception; circuit breaker stops fan-out. Not solved by this hardening.
- Manual `GIT_COMMIT_SHA` pin on Railway must not disagree with baked `deploy-meta.json`.

---

## Next validation

1. Push main and confirm `/api/version` SHA match
2. READ-ONLY smoke: ready, browser, login classification, contract probe, snapshot, leases — **no writes**
3. Bella CREATE remains separately gated behind a new ExecutionBundle + explicit approval
