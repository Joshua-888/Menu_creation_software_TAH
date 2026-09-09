# Reliability

## Verified writes

Only `VERIFIED` after expected → persist boundary submit → save → read-back → normalize → compare.

### Create vs edit persist boundaries (`HUMAN_CONFIRMED`)

| Action | Persist control | Not persisted until |
|--------|-----------------|---------------------|
| Create product | `Skab` | `Skab` submitted |
| Update existing product (any field, including `Aktiv?`) | `Opdater` | `Opdater` submitted |

Form/draft DOM changes **never** count as `WRITTEN`.

Edit lifecycle:

`PRE_UPDATE` → `FORM_MODIFIED` → `UPDATE_SUBMITTED` → `WRITTEN` → `READ_BACK` → `VERIFIED`

Create lifecycle:

`PENDING_WRITE` → `WRITTEN` → `READ_BACK` → `VERIFIED`

`createProduct` certification does **not** certify `updateProduct`.

## Visibility writes

Intended `Aktiv?` mapping (`HUMAN_CONFIRMED`): checked = AVAILABLE, unchecked = HIDDEN.

Visibility write is **VERIFIED** only after Opdater + admin read-back + list status + storefront check. Checkbox-only changes are form state, not storefront mutations.

## Fail-safe defaults

Prefer human review over silent automation when ambiguous.

## Error taxonomy (machine-readable)

Includes among others: `SOURCE_ACCESS_ERROR`, `SOURCE_PARSE_ERROR`, `AI_EXTRACTION_ERROR`, `DOMAIN_NORMALIZATION_ERROR`, `DOMAIN_VALIDATION_ERROR`, `ADMIN_CONTRACT_DRIFT`, `ADMIN_AUTH_ERROR`, `ADMIN_WRITE_ERROR`, `READBACK_MISMATCH`, `DUPLICATE_DETECTED`, `UNKNOWN_ERROR`.

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
