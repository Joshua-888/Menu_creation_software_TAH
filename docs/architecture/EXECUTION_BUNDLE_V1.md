# ExecutionBundle V1

Human approval binds the **exact executable artifact**. After approval there is no business planning, category remapping, policy application, TargetMenu mutation, or replacement WritePlan.

## Shape

```ts
ExecutionBundleV1 = {
  bundleVersion: "ExecutionBundleV1",
  restaurantKey,
  destinationHost,          // normalized hostname
  destinationIdentity,
  productionSha,
  adapterVersion,
  contractFingerprint,
  targetMenuHash,
  destinationSnapshotHash,
  writePlanHash,
  createdAt,
  operations,               // immutable, already interleaved
  operationCount,
  capabilityRequirements,
  qualityStatus,
  immutable: true,
}
```

Frozen at portal `ARTIFACTS` as `execution-bundle.json` plus `approval-binding.json`.

## Approval binding

Invalid if any of these change:

- destinationHost
- destinationIdentity
- productionSha
- targetMenuHash
- destinationSnapshotHash
- writePlanHash

Codes: `STALE_EXECUTION_BUNDLE`, `APPROVAL_INVALIDATED`. Generate a new bundle. Do not execute the old one.

## Execute path

```text
load approved ExecutionBundle
→ validate hash
→ re-read destination
→ evaluatePreWriteGate (host, auth, contract, snapshot freshness, SHA)
→ execute EXACT operations (preserveOperationOrder: true)
→ assertApprovedPlanEqualsExecutedPlan
```

`POST_APPROVAL_REPLANNING = 0`.

## Pre-write evidence

Never pass `hostOk = true` / `contractMatch = true` as assumptions. The gate is computed from:

- browser hostname
- merchant binding
- TAH contract probe + expected `contractFingerprint`
- authentication
- destination snapshot hash
- required capabilities (certified vs runtime health)

If the contract changed: `DESTINATION_CONTRACT_DRIFT` — no mutation.

Supersedes the “rebuild live plan from TargetMenu” paragraph in older portal notes. [APPROVAL_ARCHITECTURE_V1](APPROVAL_ARCHITECTURE_V1.md) still describes the product rule; this file is the executable binding.
