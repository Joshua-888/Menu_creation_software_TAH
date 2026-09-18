# Runtime and Recovery V1

## Durable worker

Jobs no longer depend on one HTTP process surviving.

```text
QUEUED → acquire lease → execute stage → checkpoint → heartbeat → next stage
```

Lease fields: jobId, runId, stage, state, leaseOwner, timestamps, currentOperationId, lastCompletedCheckpoint, deadlineAt, failureClassification, resumeEligible.

If the process dies, the lease expires and another worker may claim it, inspect durable checkpoints, and resume. Verified operations are never restarted.

Ambiguous mutation: **READ DESTINATION FIRST**.

## Destination write lock

Only one mutating run per normalized host. Second job: `DESTINATION_WRITE_LOCKED`. Read-only planning jobs may run without the write lock. Locks are durable SQLite rows, not in-memory mutexes.

## Watchdog

Expired `RUNNING` leases become `WORKER_LEASE_EXPIRED`. Portal boot reclaims locks and converts stale in-flight jobs to `FAILED` / `LIVE_EXECUTION_FAILED` with an explicit message. Jobs must not spin forever.

## BrowserRuntime

One Chromium process per worker process. Isolated `BrowserContext` per job. Never share cookies between merchants. Session reuse only within the same job after validating authenticated host.

## BlockerRecord V1 + DiagnosticPack V1

Runtime classification is deterministic (HTTP status, probe, hashes). No LLM guessing.

Retry policy is centralized in `retryPolicyFor`:

| Class | Policy |
|-------|--------|
| TRANSIENT_NETWORK | bounded exponential, read if mutation ambiguous |
| 502/503/504 | read-before-retry, bounded |
| AUTH_SESSION_EXPIRED | re-auth once |
| 400/409/422 | no identical retry |
| APPLICATION_500 | readback, fingerprint, circuit break same capability |
| CONTRACT_DRIFT / CAPABILITY_UNCERTIFIED / STALE_BUNDLE | no mutation |
| UNKNOWN | fail closed + DiagnosticPack |

DiagnosticPack never stores passwords, cookies, CSRF, API keys, or auth headers.

## RecoveryPlan V2

Inputs: frozen TargetMenu + current live destination + durable operation history + current adapter/contract.

Per operation: `NOT_STARTED | PERSISTED | VERIFIED | FAILED | UNKNOWN | SYSTEMIC_BLOCKED` with `safeToRetry`, `requiresReplan`, `requiresApproval`, `reason`.

- `executeAutomatically: false`
- `neverAutoDelete: true`
- Reuse verified objects
- Never recreate valid existing categories
- Never delete as automatic compensation
- Never blindly replay the original plan

## Capability health

Static certification (capability + adapter version + contract fingerprint + evidence) is separate from runtime health (`HEALTHY | DEGRADED | CIRCUIT_OPEN | CONTRACT_CHANGED | UNKNOWN`). A 500 circuit on merchant Y does not uncertify unrelated capabilities.

## Operator copy

Show what succeeded, failed, was not attempted, whether the destination was mutated, whether retry is safe, and the exact human action. Example: circuit breaker blocked remaining CREATE attempts; existing categories left unchanged; no duplicates.
