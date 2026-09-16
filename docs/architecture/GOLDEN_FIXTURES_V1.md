# Golden Fixtures V1

| Merchant | Path | Source modality | Purpose | Status |
|----------|------|-----------------|---------|--------|
| **Smash** | `fixtures/golden/smash` | REAL JPEG / photo | RAW extraction + intelligence certification | CERTIFIED golden |
| **Veroni** | `fixtures/golden/veroni` | REAL PDF | RAW PDF extraction + intelligence + destination canary history | CERTIFIED golden |
| **Bella** | `fixtures/golden/bella-kebab` | REAL JPEG | Photo extraction + recovery + **REAL PRODUCTION DESTINATION** | **VERIFIED_LIVE** (production) |
| **Thai** (third-merchant) | `fixtures/golden/third-merchant` | Synthetic / fixture | Isolation + policy purity | Synthetic unless replaced |

## Bella production binding

- Destination: `bellakebab.dk`
- TargetMenu hash (approved): `607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e`
- Menu state: `VERIFIED_LIVE`
- Known limitations: category nav public (TAH limitation); `setProductAvailable` global still UNCERTIFIED (scoped publication used)

## Known limitations (general)

- Fixtures must not embed merchant-specific branches into `src/intelligence` / `src/planning` production spine.
- Thai remains synthetic for isolation tests.
