# Menu Constitution V1

**Version:** `MenuConstitutionV1`  
**Code:** `src/intelligence/constitution.ts`

## Layers (do not collapse)

| Layer | Meaning | Examples |
|-------|---------|----------|
| **HARD INVARIANT** | Always true; never probabilistic | Menu ≠ Variant; ProductChoice ≠ Variant/Ingredient/Addition; WRITE_GATE |
| **GLOBAL POLICY** | Reusable ACTIVE rules with id/version | `CATEGORY_QUALIFIED_PRODUCT_NAME_V1`, `MENU_IS_COMBO_NOT_VARIANT` |
| **PEER INFERENCE** | Cohort evidence with N/confidence; never alone as write authority | peer ingredient/addition benchmarks |
| **RESTAURANT FACT** | Human-approved merchant facts | explicit restaurant additions, branded category names |

## Hard invariants

1. **PRODUCT_NAME** — name is a real menu item; never ingredient-only, category heading, price, meta, OCR garbage.
2. **CATEGORY** — category must semantically fit products; prefer explicit source branding.
3. **MENU_IS_COMBO_NOT_VARIANT** — “Menu”/“Menü” is a COMBO / menu product, never a size/price variant. Supersedes `MENU_AS_VARIANT`.
4. **VARIANT** — true variants only (sizes, crusts, dietary). ProductChoice ≠ Variant ≠ Ingredient ≠ Addition.
5. **PRODUCT_CHOICE** — choose-meat / rice-naan / pizza / drink selection semantics.
6. **INGREDIENT** — food products require professional ingredient representation with provenance.
7. **DESCRIPTION** — for food, from normalized ingredients unless restaurant formatting policy says otherwise.
8. **ADDITIONS** — real selectable add-ons only; never product titles, meta labels, drinks-as-food-extras.
9. **DRINKS_NO_FOOD_EXTRAS** — drinks never inherit burger/grill dips.
10. **ADDITION_PRICING** — source → restaurant fact → peer benchmark; no arbitrary 10 DKK fallback without policy.
11. **FOOD_COMPLETENESS** — empty food ingredients never silently READY.
12. **WRITE_GATE** — only QUALITY_READY may CREATE/UPDATE; REVIEW/BLOCKED never write.
13. **CATEGORY_QUALIFIED_PRODUCT_NAME_V1** — receipt-safe naming for SALAD/PITA/DURUM/ROLL/PIZZA_SANDWICH/SANDWICH/BAGEL families.

## Active constitution policy ids

From `ACTIVE_CONSTITUTION_POLICIES`:

- `MENU_IS_COMBO_NOT_VARIANT`
- `DRINKS_NO_FOOD_EXTRAS`
- `FOOD_COMPLETENESS`
- `PRODUCT_NAME_VALID`
- `CATEGORY_QUALIFIED_PRODUCT_NAME_V1`
- `INGREDIENT_PROVENANCE`

## Superseded

| Policy | Status | Replacement |
|--------|--------|-------------|
| `MENU_AS_VARIANT` | SUPERSEDED | `MENU_IS_COMBO_NOT_VARIANT` |

`isConstitutionCompatiblePolicy("MENU_AS_VARIANT") === false` — cannot activate accidentally.
