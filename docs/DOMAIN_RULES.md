# Domain Rules

Implemented in `src/domain` with tests. Not only in prompts.

## Menu numbers

- Preserve exact source string when present (`01`, `220A`).  
- Only values matching `/^\d+$/` after trim participate in highest-numeric.  
- Do not extract numeric prefixes from alphanumeric values.  
- Assign missing numbers sequentially after highest numeric, in source order.  
- Never renumber existing source numbers for aesthetics.  
- `DUPLICATE_SOURCE_MENU_NUMBER` → `MANUAL_REVIEW_REQUIRED`  
- `DUPLICATE_ASSIGNED_MENU_NUMBER` → `BLOCKED`

## Variants

- Every normal product needs ≥1 variant.  
- If none: inject `Alm.` / surcharge 0 / `SYSTEM_DEFAULT`.

## Base variant

Deterministic alias normalize (trim, lower, strip harmless punctuation):

`Alm.` | `Alm` | `Almindelig` | `Standard` | `Normal` | `Regular`

Else size hierarchy `Lille < Mellem < Stor` or numeric `cm` (smallest = base).  
Else `AMBIGUOUS_BASE_VARIANT` → review.

## Surcharges

- Explicit surcharge alone → use it (`DERIVED` from source explicit).  
- Total alone → `total - basePrice`.  
- Both present → require `base + explicit === total`; else `SOURCE_PRICE_CONFLICT`.  
- Unexpected negative → review.

## Ingredients

- Never invent.  
- Merge category + product: preserve order; dedupe case/whitespace-insensitive; keep first display form.  
- Product choices never enter ingredient lists.  
- Missing → `MISSING_SOURCE_SUPPORTED_INGREDIENTS` → review.

## Status aggregation

`BLOCKED > MANUAL_REVIEW_REQUIRED > WARNING > READY` — single function `aggregateStatus`.
