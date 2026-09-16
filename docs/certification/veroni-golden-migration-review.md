# Veroni Golden Migration Review (V1 → VERONI_GOLDEN_V2)

Constitution: **MenuConstitutionV1**  
Policy snapshot: **MenuConstitutionV1**  
Raw source: `fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf`

## Why V1 expectations are obsolete

| Topic | Old expected (V1 / historical) | New expected (V2) | Source evidence | Constitution rule | Reason |
|-------|--------------------------------|-------------------|-----------------|-------------------|--------|
| Product count oracle | 72 unique menu-number dishes | 88 TargetMenu products after OCR drop | RAW PDF extract yields 107 source rows; intelligence drops invalid headings/meta/marketing | FOOD_COMPLETENESS + semantic classifier | V1 counted numbered dishes only; V2 counts constitution-valid TargetMenu products (including valid Menuer combos). Status invariant is READY+REVIEW+BLOCKED = TargetMenu productCount, not raw OCR row count. |
| Menu-as-variant | Some historical paths treated Menu price as size variant | 0 Menu variants; Menu → combo/menu product | Price-column Menu on PDF | MENU_IS_COMBO_NOT_VARIANT (MENU_AS_VARIANT = SUPERSEDED) | New architecture forbids Menu variants at runtime. |
| Pepperoni (#6) | Risk of topping-as-name block | QUALITY_READY pizza dish | Source: Pepperoni with Tomat/Ost/Pepperoni, Alm/Familie | Pizza dish lexicon + PRODUCT_NAME when layoutRole=product | Pepperoni is a classic pizza title overlapping ingredient lexicon. |
| Log (#9) | Kept as product under old OCR | Dropped | Name classifies as INGREDIENT; not pizza-style dish lexicon | Drop OCR topping-token products | OCR onion/topping token, not a dish title. |
| Valgfri dyppelse (#10) | Sometimes kept with pizza toppings | Dropped | META_INSTRUCTION | No meta-as-product | Dip instruction is not a dish; toppings were OCR-associated. |
| Klassisk italiensk kødsovs | Standalone product | Dropped (ingredient phrase) | Empty ingredients; sauce description line | Ingredient-phrase-as-product drop | Sauce line is not a pasta dish. |
| Marketing / category headers | Sometimes present | Dropped | VERONI's lokale…, Restaurant, Hovedretter, INDISK Forretter, Stor Lille | Category/marketing prose drop | Not sellable dishes. |
| Cafeteriaburger | Incomplete under `\bburger\b` detection | QUALITY_READY via grill domain prior | Name contains compound `…burger` | Burger stem match without requiring word-boundary before burger | Generic burger detection fix (not merchant-specific). |
| Status accounting | Misreported 72 ready + 29 review + 6 blocked as if mutually exclusive on 72 | ready+review+blocked === productCount (88+0+0) | QualityContract statusAccounting | Invariant test | Findings ≠ product status counts. |

## Freeze

`fixtures/golden/veroni/VERONI_GOLDEN_V2.json` is frozen from certification run after MenuConstitutionV1 compliance:

- menuVariantCount = 0
- statusAccounting reconciles
- all products QUALITY_READY
- no Smash leakage

Do not require exact equality with obsolete V1 menu-number list of 72 when constitution-compliant drops and Menuer expansion change the TargetMenu shape.
