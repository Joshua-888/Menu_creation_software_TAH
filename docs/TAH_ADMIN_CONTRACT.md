# TakeAwayHero Admin Contract

## Status

**AdminContract v1** — create-side discovered on Veroni (M2); populated **READ certification** on NEW WAY (M2B).

| Milestone | Host | Focus |
|-----------|------|--------|
| M2 | `https://veronipizza.dk` | Create-form contract (empty menu) |
| M2B | `https://newwaypizzaringsted.dk` | Populated list/edit read certification |

**Admin login (NEW WAY):** [https://newwaypizzaringsted.dk/login](https://newwaypizzaringsted.dk/login)

Machine-readable: [`src/tah/contracts/v1.ts`](../src/tah/contracts/v1.ts)  
Evidence levels: [`src/tah/contracts/evidence.ts`](../src/tah/contracts/evidence.ts)  
Sanitized fixtures: [`fixtures/admin-contracts/v1/`](../fixtures/admin-contracts/v1/)

## Evidence levels

Critical elements carry `OBSERVED` | `TESTED` | `INFERRED` | `UNKNOWN`.

- `variantPriceSemantics`: **SURCHARGE** (`TESTED`) — admin variant price is surcharge over `#price`
- `basePriceSemantics`: **DEFAULT_BASE_PRODUCT_PRICE** (`TESTED`)
- `menuEditPattern`: **OBSERVED** on populated products
- WRITE capabilities: all **UNCERTIFIED** (M2B is read-only)

## Version marker

`ADMIN_VERSION_MARKER_NOT_FOUND`

Recommendation: expose `data-admin-contract-version` on `<body>` of all admin pages.

## ID strategy

- **Product database ID:** path `/admin/menu/{id}/edit` and update form action `/admin/menu/{id}` — **OBSERVED**
- **Visible menu number:** `#menu_number` — may be alphanumeric; **MUST NOT** equal database id  
  Examples (NEW WAY): `0`→`1`, `20`→`12`, `45A`→`4`
- **Variant / ingredient / addition IDs:** hidden `*[i][id]` on edit forms — **OBSERVED**

## Create vs edit

| | Create | Edit |
|--|--------|------|
| Submit | `Skab` | `Opdater` (detect only) |
| Method | POST `/admin/menu` | POST `/admin/menu/{id}` + `_method=PUT` |
| Row IDs | blueprints, no persistent ids | hidden `[id]` fields |
| Extra | — | delete form also present — readers must use form with `#menu_number` |

## Read-only adapter

`TahAdminAdapterV1` lifecycle `DEVELOPMENT`. READ capabilities certified after M2B. Writes throw `ADMIN_WRITE_BLOCKED` until Milestone 3 + canary certification.

## Future regression note

Veroni source-menu PDF is a high-value **future** extraction fixture. Do not encode customer menu contents as global domain rules.
