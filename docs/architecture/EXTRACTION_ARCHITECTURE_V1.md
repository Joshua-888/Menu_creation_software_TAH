# Extraction Architecture V1

## Principle

**OCR IS EVIDENCE, NOT TRUTH.**

Low-confidence source understanding must **fail closed** (REVIEW/BLOCK / coverage suspicion), never invent a sparse TargetMenu that looks READY.

## Multi-evidence pipeline

```text
RAW (PDF / JPEG / URL)
→ PDF text layer (when present)
→ OCR (multi-pass where needed)
→ layout reconstruction
→ price anchors
→ vision fallback (when certified/enabled)
→ evidence reconciliation + confidence
→ SourceMenu + evidence ledger
→ coverage diagnostics
```

## Modules (conceptual)

| Concern | Role |
|---------|------|
| Text layer | High-trust when embedded PDF text exists |
| OCR | Candidates with confidence; never sole authority |
| Layout | Reading order, columns, clusters |
| Price anchors | Bind prices to product rows |
| Vision fallback | Last-resort evidence, same fail-closed rules |
| Reconciliation | Merge evidence; preserve conflicts as review |
| Coverage | `SOURCE_PRODUCT_COVERAGE_SUSPICIOUS` when density ≫ extracted products |

## Confidence & fail-closed

- Prefer REVIEW over wrong READY.
- Bella incident BELLA-001: 12 visible → 1 OCR product — coverage gate must fire.
- Provenance retained into intelligence for ingredient/description completion.

## Tests

- `tests/extraction/*`
- Golden RAW certs: Smash JPEG, Veroni PDF, Bella JPEG, Thai synthetic
