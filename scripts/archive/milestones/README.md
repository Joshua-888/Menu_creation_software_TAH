# Milestone archive

Historical **milestone / debug / probe** scripts that have **zero references** anywhere in the live system (no `package.json` alias, no workflow, no `src/`/`tests/`/`docs/` reference, no import from another script). They are preserved for historical / audit reference only.

They are **not** production entry points. Do not call them from `src/`. Do not use them to mutate Bella. Classification: `KEEP_AS_HISTORICAL_ARTIFACT` per [`SCRIPT_CLASSIFICATION_V1.md`](../../../docs/architecture/SCRIPT_CLASSIFICATION_V1.md).

## Still in `scripts/`

Milestone scripts that remain in `scripts/` because they are referenced by `package.json` aliases or other live paths (e.g. `m5-veroni-extraction.ts`, `m5h-veroni-review.ts`, `m6-decision-learning.ts`, `m61`–`m76` learning/cert entries). Those stay in `scripts/` so historical paths and package.json aliases keep working. Treat them as archive-in-place.

## Newly archived (2026-09-19, "archive additional unreferenced milestone scripts")

Each entry was independently verified as having **zero references** anywhere in the repository before relocation.

### m3 / M2-M3 certification + readonly probes (superseded milestone probes, zero references)

- `m3-additions-cert.ts`
- `m3-create-product-cert.ts`
- `m3-inspect-active.ts`
- `m3-inspect-products.ts`
- `m3-preflight-veroni.mjs`
- `m3-public-check.ts`
- `m3d-deep-readonly.mjs`
- `m3d-forensics-readonly.mjs`
- `m3d-show-active.mjs`
- `m3e-canary18-hide-presubmit.mjs`
- `m3e-description-update-canary18.ts`
- `m3e-diagnose-description-readonly.mjs`
- `m3e-opdater-canary18.ts`
- `m3f-update-request-cert.ts`
- `m3g-opdater-event-path.mjs`
- `m3g-opdater-submit-mechanism.ts`
- `m3h-form-completeness-readonly.ts`
- `m3h-update-roundtrip-cert.ts`

### m5h / m5r2 / m5r3 extraction debug + probe dumps (superseded milestone probes, zero references)

- `m5h2-audit.ts`
- `m5h2-dump-36.ts`
- `m5h2-dump-pages.ts`
- `m5h2-names-dump.ts`
- `m5h2-p6-indisk.ts`
- `m5h2-p6-indisk2.ts`
- `m5h-check-names.ts`
- `m5h-debug-34-65.ts`
- `m5h-dump-46.ts`
- `m5h-dump-64-70.ts`
- `m5h-dump-bands.ts`
- `m5h-dump-p456.ts`
- `m5h-final-snap.ts`
- `m5h-mrr44.ts`
- `m5h-ocr-test.ts`
- `m5h-overlap-34.ts`
- `m5h-p6-all.ts`
- `m5h-probe.ts`
- `m5h-read-46.ts`
- `m5h-render-bands.ts`
- `m5h-sanity-read.ts`
- `m5r-debug-nums.ts`
- `m5r-probe.ts`
- `m5r2-debug-18.ts`
- `m5r2-dump-pages.ts`
- `m5r2-probe.ts`
- `m5r2-spatial-band.ts`
- `m5r2-spatial-p2.ts`
- `m5r2-spatial-p5.ts`
- `m5r2-status-lists.ts`
- `m5r3-check.ts`
- `m5r3-debug.ts`
- `m5r3-heading.ts`
- `m5r3-lines.ts`
- `m5r3-p4-only.ts`
- `m5r3-parse34.ts`
- `m5r3-spatial.ts`

### m61 / m67–m70 / m75–m80 debug, probe and pilot scripts (superseded milestone probes, zero references)

- `m61-compare-and-report.ts`
- `m67-debug-submit.ts`
- `m67-probe-category-form.ts`
- `m68-pasta-pilot-live.ts`
- `m68b-pasta-activate.ts`
- `m69-api-elia-trials.ts`
- `m69-continue-import.ts`
- `m69-debug-one-create.ts`
- `m69-debug-variant-create.ts`
- `m69-fill-pizza-gaps.ts`
- `m69-fill-remaining-pizza-gaps.ts`
- `m69-fix-gaps-and-activate.ts`
- `m69-list-all-products.ts`
- `m69-probe-500-and-pages.ts`
- `m69-probe-create-dom.ts`
- `m69-probe-elia-payload.ts`
- `m69-probe-missing.ts`
- `m69-renumber-from-probes.ts`
- `m69-renumber-gap-pizzas.ts`
- `m6-freeze-review-fixture.ts`
- `m70-label-quality-fix.ts`
- `m75-calzone-ingredients.ts`
- `m80-veroni-delete-category-cert.mts`

### Other one-off debug / delta scripts (zero references)

- `portal-inspect-job.cjs` (hardcoded historical job UUID; one-off inspection tool)
- `receipt-safe-naming-delta.mts` (offline delta report tied to commit `55485c2`)

## Not archived (deferred)

The following zero-reference candidates were considered but **excluded** as out-of-scope / ambiguous and left in place pending a dedicated objective:

- `cert-fresh-run.mts` (certification tooling)
- `full-cert-gate.mts` (certification tooling)
- `freeze-golden-manifest.mts` (golden-manifest tooling)
- `smoke-create-dest-snapshot.ts`
- `diagnose-tah-admin-login.ts`
- `veroni-product-accounting.mts` (named in `SCRIPT_CLASSIFICATION_V1.md`)

See [AUTHORITATIVE_PRODUCTION_ENTRY_POINTS.md](../../../docs/architecture/AUTHORITATIVE_PRODUCTION_ENTRY_POINTS.md).
