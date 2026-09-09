# Architecture

## Goal

Migrate restaurant menus into TakeAwayHero with verified correctness, auditability, and recoverability.

## Stages

Each stage has explicit inputs/outputs and is independently testable.

1. Source acquisition  
2. Extraction → `SourceMenu`  
3. Normalization + domain rules → `CanonicalMenu`  
4. Validation  
5. Human review (exceptions)  
6. Immutable `WritePlan`  
7. Admin contract probe  
8. Playwright execution (adapter)  
9. Read-back → normalize → compare → `VERIFIED` | `VERIFY_FAILED`

## Layers

```text
src/domain     pure business rules (M1)
src/extraction adapters + LLM behind interfaces (M5)
src/review     corrections / approval (M6)
src/tah        versioned admin adapters (M2+)
src/runs       SQLite run state + artifacts (M4)
src/runner     planner / executor (M4)
```

## Identity

Every category, product, and choice-relevant entity carries a stable `sourceId`. ProductChoice references `sourceId`s. Names are display data only.

## Money

`MoneyMinor` = integer øre (DKK × 100). No floating point arithmetic in domain.

## Versions recorded on runs

`canonicalMenuSchema`, `domainRuleEngine`, later: extractor, adminContract, adminAdapter, migrationRunner.

## Playwright timing

- **M2:** read-only discovery and contract probe  
- **M3:** first writes against canary restaurant only
