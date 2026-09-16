# scripts/

## Production spine

Normal merchant Create / QA runs through the **portal worker** (`src/portal/worker.ts`) and shared libraries under `src/`.  
Do **not** treat merchant-named scripts here as production entry points.

## Classification

See [`docs/architecture/SCRIPT_CLASSIFICATION_V1.md`](../docs/architecture/SCRIPT_CLASSIFICATION_V1.md).

- `cert-*-raw.mts` — golden certification CLIs (CI/local)
- `bella-*`, `execute-approved-bella-*` — historical Bella incident/recovery/publication artifacts
- `m*` Veroni milestones — historical capability certification evidence
- `debug-smash-*` — debug only

Architecture: [`docs/architecture/MENU_PLATFORM_ARCHITECTURE_V1.md`](../docs/architecture/MENU_PLATFORM_ARCHITECTURE_V1.md)
