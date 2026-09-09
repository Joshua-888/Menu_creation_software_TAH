# TakeAwayHero Admin Contract

## Status

**AdminContract v1** — create-side discovered on Veroni (M2); populated **READ certification** on NEW WAY (M2B/M2C).

| Milestone | Host | Focus |
|-----------|------|--------|
| M2 | `https://veronipizza.dk` | Create-form contract (empty menu) |
| M2B | `https://newwaypizzaringsted.dk` | Populated list/edit read certification |
| M2C | `https://newwaypizzaringsted.dk` | Non-default public variant finals + live `readProduct` |
| M3 | `https://veronipizza.dk` | Write canary — **BLOCKED** (active-state) |
| M3D | `https://veronipizza.dk` | Read-only active-state forensics |

**Admin login (NEW WAY):** [https://newwaypizzaringsted.dk/login](https://newwaypizzaringsted.dk/login)

Machine-readable: [`src/tah/contracts/v1.ts`](../src/tah/contracts/v1.ts)  
Evidence levels: [`src/tah/contracts/evidence.ts`](../src/tah/contracts/evidence.ts)  
Active / edit semantics: [`src/tah/contracts/activeSemantics.ts`](../src/tah/contracts/activeSemantics.ts)  
Sanitized fixtures: [`fixtures/admin-contracts/v1/`](../fixtures/admin-contracts/v1/)

## Evidence levels

Critical elements carry `OBSERVED` | `TESTED` | `INFERRED` | `UNKNOWN` | `HUMAN_CONFIRMED`.

- `variantPriceSemantics`: **SURCHARGE** (`TESTED`)
- `basePriceSemantics`: **DEFAULT_BASE_PRODUCT_PRICE** (`TESTED`)
- `additionPriceSemantics`: **ABSOLUTE_ADDON_PRICE** (`OBSERVED`)
- `activeIntendedMapping`: **CHECKED_MEANS_AVAILABLE** (`HUMAN_CONFIRMED`) — checked = AVAILABLE, unchecked = HIDDEN
- `activePersistRequiresOpdater` / `editPersistRequiresOpdater`: **HUMAN_CONFIRMED** — see below
- `activeReadSemantics`: NEW WAY **TESTED** checked↔Tilgængelig; Veroni product 18 read remains **EDIT_CHECKBOX_NOT_AUTHORITATIVE** (list/storefront preferred) — likely render inconsistency, **do not invert**
- WRITE: `updateExistingProductForm` **CERTIFIED** (M3E canary 18 Opdater + field read-back, hidden→hidden). Still **UNCERTIFIED**: `createProduct`, `updateProduct`, `setProductHidden`, `setProductAvailable`

## Aktiv? intended mapping (`HUMAN_CONFIRMED`)

For existing products:

| `Aktiv?` | Intended meaning |
|----------|------------------|
| checked | VISIBLE / AVAILABLE on storefront |
| unchecked | HIDDEN from storefront |

This is **write intent**. Persistence still requires **Opdater**.

## Persistence boundaries

| Flow | Persist control | Lifecycle |
|------|-----------------|-----------|
| **CREATE** | `Skab` | fill → Skab → read back → verify |
| **EDIT** (any field) | `Opdater` | PRE_UPDATE → FORM_MODIFIED → UPDATE_SUBMITTED → WRITTEN → READ_BACK → VERIFIED |

Edit applies to: menu number, name, description, price, variants, ingredients, additions, categories, image, **and** active.

**Before Opdater:** assume **no** persisted change (form/draft only).  
**After Opdater:** a mutation **may** have occurred — **must** verify.

Never treat a changed DOM field as persisted data before `Opdater`.

## Three observation layers

| Layer | Meaning |
|-------|---------|
| **A. FORM/DRAFT** (`EDIT_CONTROL_STATE`) | Browser form only, e.g. `#active.checked` |
| **B. PERSISTED ADMIN STATE** | After successful `Opdater`; re-read admin |
| **C. STOREFRONT STATE** | Customer ordering UI presence |

Do not collapse A, B, and C into one boolean.

## Visibility write certification (future)

Hide synthetic canary (only with explicit approval):

1. Open edit, read persisted state  
2. Uncheck `#active`, confirm DOM unchecked  
3. Zero-network FormData inspect  
4. Approved `Opdater` submit + wait  
5. Re-read product + admin-list + storefront  
6. **VERIFIED** only if hidden outcome observed  

Show path is the reverse (`#active` checked → Opdater → verify). Do **not** show products to real customers without separate approval.

Until then: `setProductHidden` / `setProductAvailable` = **UNCERTIFIED**.

M3E (canary 18): one approved Opdater with `#active` omitted preserved all business fields and kept list **Skjult** / public absent. That certifies **`updateExistingProductForm`** only — not a visibility transition.

## Veroni product 18 note

Observed: list **Skjult**, public absent, edit `#active` server-rendered **checked**.

- Intended mapping remains checked = AVAILABLE (`HUMAN_CONFIRMED`)
- Do **not** invert the checkbox
- Prefer **list + storefront** as visibility evidence
- Treat edit checkbox as form control with known persist semantics but **inconsistent render** on this record until proven by Opdater round-trip

## Create vs edit

| | Create | Edit |
|--|--------|------|
| Submit | `Skab` | `Opdater` |
| Method | POST `/admin/menu` | POST `/admin/menu/{id}` + `_method=PUT` |
| Certifies | `createProduct` only | `updateProduct` only (separate) |

## Version marker / IDs

`ADMIN_VERSION_MARKER_NOT_FOUND` — prefer future `data-admin-contract-version`.

- Product database ID from `/admin/menu/{id}/edit` — **never** from visible menu number  
- Payload inspection: zero-network `inspectFormSubmission` (abort-after-submit is **not** a no-mutation guarantee)

## Read-only adapter

`TahAdminAdapterV1` lifecycle `DEVELOPMENT`. READ certified after M2B. Writes blocked until canary certification.

## Future regression note

Veroni source-menu PDF is a high-value **future** extraction fixture. Do not encode customer menu contents as global domain rules. Do not import yet.
