# Approval Architecture V1

## Flow

```text
PLAN_READY
→ AWAITING_OPERATOR_APPROVAL
→ approved immutable plan
→ execution
```

Portal statuses include `AWAITING_OPERATOR_APPROVAL`, `READY_DRY_RUN`, `LIVE_EXECUTING`.

## Binding (invalidates on any change)

Approval is bound to:

- production SHA
- source hash
- TargetMenu hash
- destination snapshot hash
- WritePlan **or** RecoveryPlan **or** PublicationPlan hash

Any relevant change → approval void → re-preview → re-approve.

## Rules

- Explicit operator approval required before live writes / publication.
- `review=0` is **not** publication approval (BELLA-005).
- Dry-run ≠ live execute.
- Scripts that set `executeAutomatically: true` still require a human authorization message with exact hashes for production merchants.
