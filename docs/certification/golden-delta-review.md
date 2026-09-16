# Smash golden delta review

## Date
2026-09-16

## Source
`fixtures/golden/smash/raw-source.jpg` via production `PdfSourceAdapter.extractDetailed` → `runDomainEngine` → `runMenuIntelligence`.

## Old expected
- 5 burger products only in expected-final-menu.json shape oracle
- Implied exact curated ingredients per dish (hand oracle)

## New expected
- 5 burgers under **Burgers** (not Grill)
- 5 Menuer combo products synthesized from BASE+Menu price columns
- **0** Menu/Menü variants on any product
- Burger ingredients may be `DOMAIN_PRIOR` / peer when OCR does not yield ingredient lines (photo card has limited ingredient OCR)
- Descriptions generated from final ingredient lists (Danish `og` grammar)
- Menu products: combo structure with source-supported description text; components not invented beyond source string

## Reason
Architecture correctly:
1. Strips Menu-as-variant
2. Creates Menuer products from Menu pricing
3. Completes thin burger cards via shared engine priors when source OCR has no ingredient tokens

Does **not** claim EXACT_SOURCE ingredient OCR for burgers when the photo extract yields empty ingredient fields — provenance marks inference.

## Rejected golden pressure
Do not invent combo component ProductChoices merely to match an older oracle that assumed fries/dip/soda structure without source-supported selectable options.
