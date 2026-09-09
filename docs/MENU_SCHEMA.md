# Menu Schema (CanonicalMenu / SourceMenu v1)

## SourceMenu

Extractor output (hand-built in M1 tests).

- Restaurant metadata + source info  
- Categories with `sourceId`, name, order, common ingredients  
- Products with `sourceId`, optional `sourceMenuNumber` (string), name, description, ingredients, variants, add-ons, product choices, evidence, confidence  
- Variants carry `sourceTotalPrice` and/or `sourceExplicitSurcharge` (øre)  
- ProductChoice options reference other product `sourceId`s  

No assigned menu numbers. No calculated surcharges.

## CanonicalMenu

Post domain engine.

- Same `sourceId`s  
- `assignedMenuNumber` (string)  
- `basePrice` + variants with `surcharge`  
- Composed ingredients  
- Validation status + reasons  
- Provenance via `ValueOrigin` on values  

## ValueOrigin

```ts
type ValueOrigin =
  | "SOURCE"
  | "DERIVED"
  | "SYSTEM_DEFAULT"
  | "HUMAN_CORRECTION";
```

`SourceEvidence` is separate (url, file, rawText, page, section, dom, imageRef, confidence, extractorVersion).

## Separate concepts

`Ingredient` ≠ `Variant` ≠ `AddOn` ≠ `ProductChoice`

## Schema version

Constant `CANONICAL_MENU_SCHEMA_VERSION` recorded on every CanonicalMenu.
