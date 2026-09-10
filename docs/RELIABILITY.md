# Reliability

## Verified writes

Only `VERIFIED` after expected → persist boundary submit → save → read-back → normalize → compare.

### Create vs edit persist boundaries (`HUMAN_CONFIRMED`)

| Action | Persist control | Not persisted until |
|--------|-----------------|---------------------|
| Create product | `Skab` | `Skab` submitted |
| Update existing product (any field, including `Aktiv?`) | `Opdater` | `Opdater` submitted |

Form/draft DOM changes **never** count as `WRITTEN`.

### Dynamic row completeness (`HUMAN_CONFIRMED`)

`DYNAMIC_ROW_COMPLETENESS_REQUIRED` — before every Skab/Opdater:

1. Inspect instantiated rows in variants / ingredients / additions (ignore `#blueprint-*`).
2. Empty section (zero rows) is fine; blank or partial instantiated rows are not.
3. **No fixed row limit** — multiple complete rows are valid; incomplete rows are not. Variant names are open-ended (no whitelist); the browser executes the WritePlan only.
4. Derive expected collections from the **product-specific WritePlan** (never hardcode a default of one variant or a fixed name set).
5. Invariant: actual intended rows == WritePlan rows **and** no incomplete instantiated rows.
6. Fill WritePlan rows completely, or remove unintended rows via red X — **never invent** values; never remove valid populated rows just because there are many.
7. `validateAdminFormBeforeSubmit(snap, writePlan)` must return submit-ready; `form.checkValidity()` alone is insufficient.
8. Incomplete rows are a primary suspect for `UPDATE_REQUEST_NOT_SENT`.

Errors: `INCOMPLETE_ADMIN_ROW`, `MISSING_REQUIRED_ADMIN_FIELD`, `UNEXPECTED_DYNAMIC_ROW`, `ADMIN_FORM_NOT_SUBMIT_READY`, `SUBMIT_CONTROL_BLOCKED_BY_OVERLAY`, `SUBMIT_CONTROL_NOT_INTERACTABLE`.

Before Skab/Opdater: dismiss known cookie banners; verify the submit control is interactable and not covered. Never force-click through overlays.

Edit lifecycle:

`PRE_UPDATE` → `FORM_MODIFIED` → `UPDATE_SUBMITTED` → `SUBMIT_EVENT_CONFIRMED` → `SUBMIT_REQUEST_OBSERVED` → `SERVER_RESPONSE_RECEIVED` → `WRITTEN` → `READ_BACK` → `VERIFIED`

A button click alone never counts as `WRITTEN`. If no submit event occurs → `OPDATER_CLICK_NO_SUBMIT_EVENT`. If no expected mutation HTTP request occurs → `UPDATE_REQUEST_NOT_SENT`. Never use `HTMLFormElement.submit()` (bypasses submit events).

Create lifecycle:

`PENDING_WRITE` → `WRITTEN` → `READ_BACK` → `VERIFIED`

`createProduct` certification does **not** certify `updateProduct`.

## Visibility writes

Intended `Aktiv?` mapping (`HUMAN_CONFIRMED`): checked = AVAILABLE, unchecked = HIDDEN.

Visibility write is **VERIFIED** only after Opdater + admin read-back + list status + storefront check. Checkbox-only changes are form state, not storefront mutations.

## Fail-safe defaults

Prefer human review over silent automation when ambiguous.

## Error taxonomy (machine-readable)

Includes among others: `SOURCE_ACCESS_ERROR`, `SOURCE_PARSE_ERROR`, `AI_EXTRACTION_ERROR`, `DOMAIN_NORMALIZATION_ERROR`, `DOMAIN_VALIDATION_ERROR`, `ADMIN_CONTRACT_DRIFT`, `ADMIN_AUTH_ERROR`, `ADMIN_WRITE_ERROR`, `UPDATE_REQUEST_NOT_SENT`, `ADMIN_VALIDATION_ERROR`, `INCOMPLETE_ADMIN_ROW`, `MISSING_REQUIRED_ADMIN_FIELD`, `UNEXPECTED_DYNAMIC_ROW`, `ADMIN_FORM_NOT_SUBMIT_READY`, `UNEXPECTED_MUTATION_REQUEST`, `UPDATE_RESPONSE_ERROR`, `READBACK_MISMATCH`, `DUPLICATE_DETECTED`, `UNKNOWN_ERROR`.

## Retries

Bounded for transient network. Never blind-retry contract drift or auth. Read-back mismatch: limited repair then review. Retries must not create duplicates.

## Payload inspection (M3D)

**Do not** treat Playwright `route.abort()` after a real form submit click as proof that nothing persisted. M3 observed persistence despite abort. Use zero-network `inspectFormSubmission` (`FormData` / successful controls) for preflight payload checks — zero POST/PUT/PATCH/DELETE required.

## Metrics to track later

READY rate, review rate, wrong prices after validation (must be 0), duplicate creates (0), read-back mismatch rate, contract drift events, regression pass rate (100%).

## Zero-tolerance

- Wrong VERIFIED prices: 0  
- Accidental duplicate products: 0  
- READY production writes without read-back: 0  
- Known contract drift ignored: 0  
- Treating form/draft as persisted without Opdater/Skab: 0
