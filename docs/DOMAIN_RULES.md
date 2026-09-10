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

- Variant names are **open-ended source data** — any restaurant-specific name is allowed (e.g. Alm., Lille, Deep Pan, 30 cm, XL, Børne, or unknown names).
- **Do not** implement a whitelist of allowed variant names.
- Preserve names from the approved source / CanonicalMenu; do not rename or reject unfamiliar names.
- Every normal product needs ≥1 variant.
- If none: inject `Alm.` / surcharge 0 / `SYSTEM_DEFAULT`.
- Instantiated admin rows: non-empty name + valid price/surcharge; blank rows must be removed before Skab/Opdater.
- Row count is product-specific (WritePlan / CanonicalMenu), not a fixed default.

## Base variant

Base-variant determination uses **deterministic patterns for choosing a base price only**. It is **not** a list of allowed variant names.

Normalize (trim, lower, strip harmless punctuation) aliases used only when selecting base:

`Alm.` | `Alm` | `Almindelig` | `Standard` | `Normal` | `Regular`

Else size hierarchy `Lille < Mellem < Stor` or numeric `cm` (smallest = base).  
Else `AMBIGUOUS_BASE_VARIANT` → `MANUAL_REVIEW_REQUIRED`.

If source contains unfamiliar names and no deterministic base can be identified: **MANUAL_REVIEW_REQUIRED**. Do not rename or reject the variants.

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
