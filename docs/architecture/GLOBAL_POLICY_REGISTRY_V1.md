# Global Policy Registry V1

Authoritative list of reusable semantic policies.  
Lifecycle statuses: `ACTIVE` | `SUPERSEDED` | `DEPRECATED`.

Code: `src/intelligence/constitution.ts`, `policyLifecycle.ts`, `categoryQualifiedProductName.ts`, `src/portal/policyCatalog.ts`.

---

## ACTIVE

### CATEGORY_QUALIFIED_PRODUCT_NAME_V1

| Field | Value |
|-------|-------|
| policy id | `CATEGORY_QUALIFIED_PRODUCT_NAME_V1` |
| version | V1 |
| scope | GLOBAL |
| status | ACTIVE |
| semantic families | SALAD, PITA, DURUM, ROLL, PIZZA_SANDWICH, SANDWICH, BAGEL |
| input conditions | Category resolves to family; name is filling-only / ambiguous on receipt without category |
| effect | Qualify as `"<Product type> m. <name>"` when needed; preserve already self-describing names; idempotent |
| provenance | Policy application recorded on intelligence / naming provenance |
| quality dependency | `PRODUCT_NAME_RECEIPT_SAFE` |
| tests | unit + certification Bella naming; field-aware name equality |
| supersedes | — |
| superseded by | — |

### MENU_IS_COMBO_NOT_VARIANT

| Field | Value |
|-------|-------|
| policy id | `MENU_IS_COMBO_NOT_VARIANT` |
| version | MenuConstitutionV1 |
| scope | GLOBAL |
| status | ACTIVE |
| effect | Forbid Menu/Menü as size variant; require combo semantics or REVIEW |
| quality dependency | `NO_MENU_VARIANT`, `COMBO_STRUCTURE_VALID` |
| supersedes | `MENU_AS_VARIANT` |

### DRINKS_NO_FOOD_EXTRAS

| Field | Value |
|-------|-------|
| policy id | `DRINKS_NO_FOOD_EXTRAS` |
| version | MenuConstitutionV1 |
| scope | GLOBAL |
| status | ACTIVE |
| effect | Drinks cannot inherit food dips / mayo / ketchup / remoulade / burger extras |
| note | Must not depend on optional peer probability artifact load |

### FOOD_COMPLETENESS

| Field | Value |
|-------|-------|
| policy id | `FOOD_COMPLETENESS` |
| version | MenuConstitutionV1 |
| scope | GLOBAL |
| status | ACTIVE |
| effect | Empty food ingredient lists → attempt completion chain; else QUALITY_REVIEW |

### PRODUCT_NAME_VALID

| Field | Value |
|-------|-------|
| policy id | `PRODUCT_NAME_VALID` |
| version | MenuConstitutionV1 |
| scope | GLOBAL |
| status | ACTIVE |
| effect | Block garbage / ingredient-soup / meta names from READY |

### INGREDIENT_PROVENANCE

| Field | Value |
|-------|-------|
| policy id | `INGREDIENT_PROVENANCE` |
| version | MenuConstitutionV1 |
| scope | GLOBAL |
| status | ACTIVE |
| effect | Inferred ingredients must carry provenance |

---

## SUPERSEDED (must not activate)

### MENU_AS_VARIANT

| Field | Value |
|-------|-------|
| policy id | `MENU_AS_VARIANT` |
| status | SUPERSEDED |
| replacement | `MENU_IS_COMBO_NOT_VARIANT` |
| reason | Menu is a combo/menu product, never a size/price variant |
| date | 2026-09-16 |
| activation | `isConstitutionCompatiblePolicy` returns false |

Deterministic decision transforms map `MENU_AS_VARIANT` to no-op strip / combo resolution path — never revive as active write rule.
