# TakeAwayHero Admin Contract

## Status

**AdminContract v1** certified structurally from read-only discovery against the supplied Veroni admin host (`https://veronipizza.dk/admin/menu`).

Machine-readable definition: [`src/tah/contracts/v1.ts`](../src/tah/contracts/v1.ts)  
Sanitized fixture: [`fixtures/admin-contracts/v1/contract.json`](../fixtures/admin-contracts/v1/contract.json)

## Version marker

`ADMIN_VERSION_MARKER_NOT_FOUND`

Recommendation: expose `data-admin-contract-version` on `<body>` of all admin pages.

## ID strategy

- **Category database ID:** `/admin/categories/{id}/edit`
- **Product database ID:** `/admin/menu/{id}/edit` (pattern; empty menus 404 for missing ids)
- **Visible menu number:** `#menu_number` / `name=menu_number` — **not** the database id

## Read-only adapter

`TahAdminAdapterV1` lifecycle `DEVELOPMENT`. Writes throw `ADMIN_WRITE_BLOCKED` until Milestone 3 + certification.

## Future regression note

Veroni source-menu PDF is a high-value **future** extraction fixture (alphanumeric numbers, Alm./Familie, Lille/Stor, combos). Do not encode Veroni menu contents as global domain rules.
