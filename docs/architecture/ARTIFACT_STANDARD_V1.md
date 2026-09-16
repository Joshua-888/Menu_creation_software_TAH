# Artifact Standard V1

Every production / certification run should retain:

| Artifact | Purpose |
|----------|---------|
| source-manifest | Input files / URLs |
| source-evidence | OCR/text/layout ledger |
| SourceMenu | Extracted menu |
| intelligence trace | Constitution / policy / completion |
| policy trace | Applied global policies |
| TargetMenu | Approved intended menu |
| quality report | READY/REVIEW/BLOCK |
| destination-before snapshot | Pre-write / pre-publish |
| WritePlan / RecoveryPlan / PublicationPlan | Immutable ops |
| approval | Operator + hash binding |
| operation results | Per-op outcomes |
| field-aware read-back | Per-field expected/actual |
| destination-after snapshot | Post-write / post-publish |
| TargetMenu comparison | Menu equality |
| storefront verification | When publishing |
| final report | Success / blockers |

## Required metadata on each

- `runId`
- `timestamp`
- `production SHA` (when live)
- `constitution version` (`MenuConstitutionV1`)
- `policy snapshot/version`
- TargetMenu / plan / destination snapshot hashes when applicable

## Storage

Typically under `runs/<stream>/<runId>/`. Historical Bella streams: `bella-recovery-*`, `bella-continuation-*`, `bella-final-recon`, `bella-publication`.
