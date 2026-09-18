# Operational Hardening V1

**Authoritative for runtime/operations.** Product pipeline remains [MENU_PLATFORM_ARCHITECTURE_V1](MENU_PLATFORM_ARCHITECTURE_V1.md).  
**Approval binding:** [EXECUTION_BUNDLE_V1](EXECUTION_BUNDLE_V1.md)  
**Worker/recovery:** [RUNTIME_AND_RECOVERY_V1](RUNTIME_AND_RECOVERY_V1.md)  
**Audit:** [OPERATIONAL_HARDENING_AUDIT_V1](OPERATIONAL_HARDENING_AUDIT_V1.md)

This document supersedes informal “empty destination = empty catalog” and “unset allowlist = *” behavior. It does **not** replace the constitution, quality contract, or publication architecture.

## Target

When something fails, the platform either:

1. Recovers automatically when safe (read-before-retry, bounded transient retry, session re-auth once).
2. Resumes from the last verified checkpoint.
3. Stops immediately with one precise blocker.

It must never hang, reinstall Chromium at runtime, blindly retry deterministic 500s, replan after approval, fake an empty restaurant, or auto-delete customer content.

## Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| FAST | Baked Chromium, 1 catalog list + N edit reads, condition waits, `check:fast` |
| DETERMINISTIC | Classification from evidence; no LLM runtime classification |
| RESUMABLE | Job leases, checkpoints, skip `VERIFIED` ops |
| IDEMPOTENT | Read destination first when mutation is ambiguous |
| OBSERVABLE | BlockerRecord, DiagnosticPack, operator summary, `/api/version`, `/api/ready` |
| FAIL-CLOSED | Pre-write gate, bundle-bound writes, `LIVE_COMPLETE` required |
| LOW-MAINTENANCE | One worker replica + SQLite WAL; no extra infra |
| DEPLOYMENT-SAFE | Baked SHA; MAIN_SHA must equal DEPLOYED_SHA |
| OPERATOR-SAFE | Approval binds the exact ExecutionBundle |

## Deny-by-default writes

- `PORTAL_LIVE_WRITES=0` is the global kill switch.
- Unset `PORTAL_LIVE_WRITE_HOSTS` is **bundle-bound** (exact job/bundle host), not `*`.
- `PORTAL_LIVE_WRITE_HOSTS=*` is an emergency override only. Execute still requires the browser host to match the bundle host.
- Browser page host must equal the bundle host at every mutation boundary.

## Snapshot results

`LIVE_COMPLETE` is required for CREATE planning, QA, and live execute.  
`FAILED` / `OFFLINE_EXPLICIT` / `LIVE_PARTIAL_WITH_ERRORS` / `SNAPSHOT_TRUNCATED` never look like a successful empty catalog.

## Playwright

Build image → exact Playwright + Chromium at `/ms-playwright` → runtime asserts `chromium.executablePath()` → READY.  
If missing: `BROWSER_RUNTIME_UNAVAILABLE`. Do not download in the portal process.

## Persistence

Production `PORTAL_DATA_DIR` must be `/data/portal` (Railway volume). Holds:

- `portal.sqlite` (jobs, leases, locks, blockers)
- `live-runs.sqlite`
- uploads, run artifacts, ExecutionBundles, DiagnosticPacks, RecoveryPlans

SQLite: WAL, busy_timeout 5000, foreign_keys ON. One writer replica until a future Postgres migration. Do not run multi-replica writers against one SQLite file.

## CI

- `npm run check:fast` — typecheck + core unit tests
- `npm run check:ship` — full required gate (never skip for deploy)

## Bella

Do not mutate Bella as part of this hardening. Existing categories stay. No product CREATE. No empty-ingredients diagnostic.
