# Capability Matrix V1

**Version:** `TahCapabilityMatrixV1`  
**Code:** `src/tah/contracts/evidence.ts` (`M2B_ADAPTER_CAPABILITIES`, gates)

States: **CERTIFIED** | **UNCERTIFIED** | **UNSUPPORTED** / UNAVAILABLE

Runtime must not assume UNCERTIFIED capability.

## Read

| Capability | Status | Evidence |
|------------|--------|----------|
| contractProbe | CERTIFIED | M2B |
| listCategories | CERTIFIED | M2B |
| listProducts | CERTIFIED | M2B |
| readProduct | CERTIFIED | M2B |
| readVariants / ingredients / additions | CERTIFIED | M2B |

## Write

| Capability | Status | Evidence / note |
|------------|--------|-----------------|
| createCategory | CERTIFIED | M6.7 canary |
| deleteCategory | CERTIFIED | M80 empty canary |
| createHiddenProduct | CERTIFIED | M3 Skab + unchecked Aktiv? |
| writeVariants / ingredients / additions | CERTIFIED | M3 |
| updateExistingProductForm | CERTIFIED | M3H Opdater narrow |
| updateProductDescription / scalar | CERTIFIED | M3H |
| updateProduct (broad) | UNCERTIFIED | must stay |
| setProductHidden | UNCERTIFIED | must stay |
| setProductAvailable | UNCERTIFIED | must stay; Bella publication used scoped protocol only |
| image upload | UNCERTIFIED | — |

## ProductChoice destination representation

| Aspect | Status |
|--------|--------|
| Canonical `productChoices` in TargetMenu | Supported in domain/intelligence |
| Native TAH ProductChoice control | **UNSUPPORTED / UNCERTIFIED** as first-class admin field |
| Write mapping | `mapProductChoicesToWriteFields` may map to variants or 0kr additions **only** via peer structure pattern — not silent invent |
| Gate | Do not invent uncertified equivalence; keep capability gate; Bella menu did not require uncertified ProductChoice writes |

## Category visibility

| Capability | Status |
|------------|--------|
| hide category | UNSUPPORTED |
| `CATEGORY_CREATE_IS_PUBLIC_MUTATION` | **true** |

## Field-aware verify / read-back

| Capability | Status |
|------------|--------|
| readBack | CERTIFIED (read product) |
| fieldAwareVerify | CERTIFIED in runner (software); destination-independent |
| storefront inspection | OBSERVED / TESTED per run; not a write capability |
