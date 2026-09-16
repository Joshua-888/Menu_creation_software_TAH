# Publication Architecture V1

## Flow

```text
VERIFIED_COMPLETE_HIDDEN
→ PublicationPlan (visibility only)
→ per-product publish
→ read-back (list status + field-aware content)
→ storefront verification
→ VERIFIED_LIVE
```

## Mechanism (TAH)

| Fact | Detail |
|------|--------|
| Control | Edit form `#active` (Aktiv?) |
| Persist | Opdater submit required |
| Mapping | checked = AVAILABLE; unchecked = HIDDEN (HUMAN_CONFIRMED) |
| Scope | **Per product** — no menu-wide publish switch |
| Categories | No category visibility; nav may already be public |
| Global cap | `setProductAvailable` remains **UNCERTIFIED** as a broad API; Bella used scoped `#active`+Opdater protocol |

## Must not change

name, price, category, ingredients, description, variants, choices, additions, combo structure.

If content drifts after Opdater → STOP.

## Bella certification evidence

- 12 published, 12 verified, 12 storefront-visible
- 0 unexpected / duplicates
- TargetMenu equality PASS
- receipt-safe naming PASS
- `BELLA_MENU_STATE = VERIFIED_LIVE`

No paid test order in publication milestone unless separately certified no-charge capability exists.
