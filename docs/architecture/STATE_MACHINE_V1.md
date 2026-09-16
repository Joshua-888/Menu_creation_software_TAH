# State Machine V1

## Job / portal statuses (`src/portal/types.ts`)

Canonical progression (Create):

```text
DRAFT / QUEUED
→ EXTRACTING
→ DOMAIN / DECISIONS / ARTIFACTS   (intelligence + quality)
→ AWAITING_REVIEW                 (QUALITY_REVIEW items)
→ AWAITING_OPERATOR_APPROVAL      (PLAN_READY equivalent)
→ READY_DRY_RUN
→ LIVE_EXECUTING / WRITING
→ PARTIAL_WRITE | RECOVERY_REQUIRED   (on incomplete/ambiguous)
→ COMPLETED                         (legacy success label; prefer explicit verified states in artifacts)
→ FAILED | CANCELLED | LIVE_EXECUTION_FAILED
```

Menu milestone states (artifacts / recovery / publication):

```text
VERIFIED_COMPLETE_HIDDEN
→ PUBLICATION_READY
→ PUBLISHING
→ VERIFIED_LIVE
```

## Entity states (`src/domain/states.ts`)

`DISCOVERED → EXTRACTED → NORMALIZED → VALIDATED → APPROVED → PENDING_WRITE → WRITTEN → READ_BACK → VERIFIED`  
Failure: `MANUAL_REVIEW | BLOCKED | WRITE_FAILED | VERIFY_FAILED`

## Obsolete / misleading semantics

| Label | Guidance |
|-------|----------|
| `COMPLETED_WITH_ERRORS` | **Do not treat as success.** Map operator UX to `PARTIAL_WRITE` / `RECOVERY_REQUIRED`. Executor may still emit this historically — recovery required. |
| Partial menu as “done” | Forbidden; BELLA-007 — category verify ≠ menu success |

## Workflows

- `CREATE_MENU`
- `QA_RECONCILE`
