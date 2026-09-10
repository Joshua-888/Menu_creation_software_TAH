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
- `dynamicRowCompletenessRequired`: **HUMAN_CONFIRMED** — every instantiated variant/ingredient/addition row must be complete or removed before Skab/Opdater
- `activeReadSemantics`: NEW WAY **TESTED** checked↔Tilgængelig; Veroni product 18 read remains **EDIT_CHECKBOX_NOT_AUTHORITATIVE** (list/storefront preferred) — likely render inconsistency, **do not invert**
- WRITE: M3H CERTIFIED narrow Opdater path (`updateExistingProductForm`, `updatePersistBoundary`, `updateProductDescription`, `updateScalarProductField`). M3 CREATE CERTIFIED (`createProduct`, `createHiddenProduct`, `writeDefaultVariant`, `writeNonZeroVariants`, `writeMultipleVariants`, `writeIngredients`, `assignExistingCategory`, `writeAdditions`). Still **UNCERTIFIED**: `createCategory`, full `updateProduct`, image, `setProductHidden`, `setProductAvailable`.

## Aktiv? intended mapping (`HUMAN_CONFIRMED`)

For existing products:

| `Aktiv?` | Intended meaning |
|----------|------------------|
| checked | VISIBLE / AVAILABLE on storefront |
| unchecked | HIDDEN from storefront |

This is **write intent**. Persistence still requires **Opdater**.

## Dynamic row completeness (`HUMAN_CONFIRMED`)

`DYNAMIC_ROW_COMPLETENESS_REQUIRED`

Before **Skab** or **Opdater**, every currently instantiated editable row in the product form must be valid and complete — especially **VARIANTER**, **INGREDIENSER**, **TILBEHØR**.

There is **no** fixed or default row limit. A product may have 1, 5, or many variants/ingredients/additions when every instantiated row is complete. **Multiple complete rows = valid.** **Any incomplete instantiated row = invalid.**

| Concept | Rule |
|---------|------|
| Empty section | Allowed (header only, zero rows) |
| Instantiated blank/partial row | **Not** allowed — fill required fields **or** remove via red X |
| Multiple complete rows | **Valid** — do not remove populated rows merely because there are several |
| Green `+` | Adds a real editable row |
| Hidden `#blueprint-*` | Template only — **ignore**; do not treat as a row |
| Invented data | **Forbidden** — never invent variants/ingredients/additions to pass validation |
| WritePlan | **Source of truth** for which rows should exist (product-specific; never hardcode `expectedVariants = 1`) |
| Variant names | **Open-ended** source/CanonicalMenu data — any restaurant-specific name; **no whitelist**; browser must not interpret names |
| Invariant | Actual intended rows == WritePlan rows **and** no incomplete instantiated rows |
| `form.checkValidity()` | Native HTML only — **does not** prove TAH dynamic-row readiness |

Required fields per instantiated row:

- Variants: non-empty name + valid price/surcharge (names are open-ended; e.g. Lille/Mellem/Stor, Alm./Deep Pan/Glutenfri, 20 cm/30 cm, or any source name — all valid when complete)
- Ingredients: name (any count)
- Additions: name + price (zero rows valid when the product has none)

The Playwright/admin adapter must not decide which variant names are valid, how many variants a product should have, or what a variant “means”. It only executes the approved WritePlan (N complete rows when the plan has N variants).

Base-variant aliases used by the domain engine (Alm./Standard/…, Lille&lt;Mellem&lt;Stor, cm sizes) are for **base-price selection only**, not an allowlist. Unfamiliar sets without a deterministic base → `MANUAL_REVIEW_REQUIRED` — do not rename or reject variants.

Pre-submit: derive expected collections from the approved WritePlan → `validateAdminFormBeforeSubmit(snap, writePlan)` → `VALID` or `INCOMPLETE_ADMIN_ROW` / `ADMIN_FORM_NOT_SUBMIT_READY` with section, row index, missing fields. Unintended blank rows (not in WritePlan) → remove via UI red X; WritePlan rows that are incomplete → fill, do not invent. Re-validate. Do not submit until clean.

Incomplete dynamic rows are a first-line suspect for `UPDATE_REQUEST_NOT_SENT` (application JS may block submit even when native `checkValidity()` is true).

## Persistence boundaries

| Flow | Persist control | Lifecycle |
|------|-----------------|-----------|
| **CREATE** | `Skab` | fill → validate completeness → Skab → read back → verify |
| **EDIT** (any field) | `Opdater` | PRE_UPDATE → FORM_MODIFIED → validate completeness → UPDATE_SUBMITTED → WRITTEN → READ_BACK → VERIFIED |

Edit applies to: menu number, name, description, price, variants, ingredients, additions, categories, image, **and** active.

**Before Opdater:** assume **no** persisted change (form/draft only).  
**After Opdater:** a mutation **may** have occurred — **must** verify.

Never treat a changed DOM field as persisted data before `Opdater`.

## Submit control interactability (`HUMAN_CONFIRMED` via M3H)

Cookie/consent banners (and similar overlays) may physically block **Skab** / **Opdater**.

Before every Skab or Opdater click:

1. Dismiss known cookie/consent banners safely when present  
2. Confirm the exact submit control is visible and enabled  
3. Confirm it is not covered (`elementFromPoint` hits the button / child, not the banner)  
4. **Do not** use `{ force: true }` to click through an overlay  

Errors: `SUBMIT_CONTROL_BLOCKED_BY_OVERLAY`, `SUBMIT_CONTROL_NOT_INTERACTABLE`.

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

M3E hidden→hidden Opdater did **not** prove a semantic field mutation. **M3H VERIFIED** description-only Opdater on Veroni canary 18 (multipart-safe POST observation) and CERTIFIED `updateExistingProductForm` / `updatePersistBoundary` / `updateProductDescription` / `updateScalarProductField`. Full `updateProduct` and visibility writes remain **UNCERTIFIED**.

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
