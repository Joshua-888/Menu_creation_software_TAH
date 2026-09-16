# Recovery Architecture V1

## States

| State | Meaning |
|-------|---------|
| `PARTIAL_WRITE` | Some ops persisted; run incomplete |
| `RECOVERY_REQUIRED` | Must not continue blindly; need new plan |
| `VERIFIED_COMPLETE_HIDDEN` | Full menu written + verified; staged |
| `VERIFIED_LIVE` | Published + storefront verified |

Legacy `COMPLETED_WITH_ERRORS` must **not** be treated as success. Prefer `PARTIAL_WRITE` / `RECOVERY_REQUIRED`.

## Binding

A RecoveryPlan / continuation is valid only when **all** match:

- production SHA
- source hash
- TargetMenu hash
- destination snapshot hash
- RecoveryPlan hash

## Rules

1. **Destination state is authoritative** during continuation.
2. Never replay a stale plan.
3. Hash mismatch → **STOP** (`DESTINATION_CHANGED_SINCE_APPROVAL` / plan mismatch).
4. Do **not** auto-replan-and-execute.
5. Ambiguous create → read destination first; classify PERSISTED_EXACT / NOT_PERSISTED / PARTIAL / AMBIGUOUS — never blind retry.
6. Stop on first true semantic mismatch; persist state; emit new RecoveryPlan for approval.

## Bella evidence

- Continuation with 11 creates after verified #1 succeeded under bound hashes.
- Later plan with stale destination hash correctly STOPPED.
- Final RO reconciliation certified `VERIFIED_COMPLETE_HIDDEN` before publication.
