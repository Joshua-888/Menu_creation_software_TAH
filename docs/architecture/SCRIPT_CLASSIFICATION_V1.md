# Script Classification V1

Merchant / milestone scripts under `scripts/` are **not** the production Create/QA spine (portal worker + `runMenuIntelligence`).

## Bella

| Script | Classification | Notes |
|--------|----------------|-------|
| `_tmp-bella-ro-poststop.mts` | **DELETE** | Removed 2026-09-16 (temp RO helper) |
| `bella-apply-accepted-reviews.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Incident review application |
| `bella-build-recovery-plan.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Plan builder for Bella recovery |
| `bella-recovery-prep-intel.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Intel prep |
| `bella-deploy-rebind.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Deploy rebind |
| `bella-final-recovery-readiness.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Readiness report |
| `bella-rebuild-final-readiness.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Readiness rebuild |
| `bella-continuation-readiness.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Continuation readiness |
| `bella-final-continuation-rebind.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Rebind plan `7c955a70…` |
| `bella-rebind-receipt-naming.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Naming rebind |
| `execute-approved-bella-recovery.mts` | KEEP_AS_HISTORICAL_ARTIFACT | One-shot recovery execute |
| `execute-approved-bella-continuation.mts` | KEEP_AS_HISTORICAL_ARTIFACT | One-shot continuation execute |
| `bella-final-destination-reconciliation.mts` | KEEP_AS_HISTORICAL_ARTIFACT | RO final recon |
| `bella-publication-certification.mts` | KEEP_AS_HISTORICAL_ARTIFACT | Publication cert (Bella-bound) |

Generic behaviors already in core: field-aware verify, quality contract, host allowlist, destination port, Opdater observe. **Do not** promote Bella wrappers into production runtime.

Stale plans marked `SUPERSEDED_BY_DESTINATION_STATE` must never execute against current Bella.

## Smash

| Script | Classification |
|--------|----------------|
| `cert-smash-raw.mts` | KEEP_AS_GENERIC_TOOL (golden cert CLI) |
| `submit-smash-create.ts` / `submit-smash-qa.ts` | KEEP_AS_HISTORICAL_ARTIFACT |
| `debug-smash-*.ts` | KEEP_AS_HISTORICAL_ARTIFACT (debug only) |

## Veroni

| Script | Classification |
|--------|----------------|
| `cert-veroni-raw.mts` | KEEP_AS_GENERIC_TOOL |
| `m3*` / `m5*` / `m6*` / `m7*` / `m80*` Veroni certs | KEEP_AS_HISTORICAL_ARTIFACT (capability certification evidence) |
| `veroni-product-accounting.mts` | KEEP_AS_HISTORICAL_ARTIFACT |

## Production reachable

Only portal/worker paths + shared `src/**` libraries. Scripts may call core libs for certification but must not be required for normal new-merchant UI flow.
