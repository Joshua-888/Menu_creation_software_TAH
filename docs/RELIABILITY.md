# Reliability

## Verified writes

Only `VERIFIED` after expected → write → save → read-back → normalize → compare.

## Fail-safe defaults

Prefer human review over silent automation when ambiguous.

## Error taxonomy (machine-readable)

Includes among others: `SOURCE_ACCESS_ERROR`, `SOURCE_PARSE_ERROR`, `AI_EXTRACTION_ERROR`, `DOMAIN_NORMALIZATION_ERROR`, `DOMAIN_VALIDATION_ERROR`, `ADMIN_CONTRACT_DRIFT`, `ADMIN_AUTH_ERROR`, `ADMIN_WRITE_ERROR`, `READBACK_MISMATCH`, `DUPLICATE_DETECTED`, `UNKNOWN_ERROR`.

## Retries

Bounded for transient network. Never blind-retry contract drift or auth. Read-back mismatch: limited repair then review. Retries must not create duplicates.

## Metrics to track later

READY rate, review rate, wrong prices after validation (must be 0), duplicate creates (0), read-back mismatch rate, contract drift events, regression pass rate (100%).

## Zero-tolerance

- Wrong VERIFIED prices: 0  
- Accidental duplicate products: 0  
- READY production writes without read-back: 0  
- Known contract drift ignored: 0
