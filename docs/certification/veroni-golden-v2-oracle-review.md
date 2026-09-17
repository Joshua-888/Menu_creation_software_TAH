# Golden Oracle Review — VERONI_GOLDEN_V2 correction (release freeze)

## Finding

Previous VERONI_GOLDEN_V2 froze TargetMenu with **88 QUALITY_READY** products, including
derived Menuer/combo products whose descriptions invented `fries, dip & sodavand`
without source evidence on non-burger Veroni Menu-price rows.

## Truth order

RAW SOURCE → MenuConstitutionV1 → facts/policies → GOLDEN

Constitution `MENU_IS_COMBO_NOT_VARIANT` allows deriving a separate Menu/combo product
from a Menu price column, but **forbids inventing combo contents**.

## Runtime fix (generic, not merchant-specific)

`synthesizeMenuerProductsFromMenuPrices`:

- Burger/smash family: Danish takeaway Menu composition (fries/dip/soda) allowed
- Otherwise: derive price-only Menuer product; `COMBO_CONTENTS_UNRESOLVED` → QUALITY_REVIEW

## Expected golden change

| Field | Old V2 | New V2 |
|-------|--------|--------|
| targetProductCount | 88 | 88 |
| ready | 88 | 76 |
| review | 0 | 12 |
| blocked | 0 | 0 |
| derived Menuer inventing fries/dip on non-burger | YES | NO |

## Source evidence

Veroni PDF Menu column on grill/sides/etc. proves a second price, not meal contents.
Smash burger Menuer remain READY (burger Menu convention).

## Action

Replace `fixtures/golden/veroni/VERONI_GOLDEN_V2.json` with constitution-correct freeze
after this review. Certification restarts from the new RELEASE_CANDIDATE_SHA.

## Status-accounting addendum (wrap/combo parse)

Generic wrap-bread completion and printed combo-list parse later captured
source-supported components on `Kebabmenu` (pommes/soda). Derived non-burger
Menuer remain `QUALITY_REVIEW` (`COMBO_CONTENTS_UNRESOLVED`). Frozen counts:

| Field | Previous freeze | Current freeze |
|-------|-----------------|----------------|
| ready | 75 | 76 |
| review | 12 | 11 |
| blocked | 1 | 1 |

