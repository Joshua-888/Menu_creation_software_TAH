# Architecture

> **Authoritative freeze:** [`docs/architecture/MENU_PLATFORM_ARCHITECTURE_V1.md`](./architecture/MENU_PLATFORM_ARCHITECTURE_V1.md)  
> Code marker: `src/architecture/menuPlatformArchitectureV1.ts`

## Goal

Migrate restaurant menus into TakeAwayHero with verified correctness, auditability, and recoverability — ending at `VERIFIED_LIVE`.

## Canonical pipeline (V1)

RAW → extraction → SourceMenu → MenuIntelligenceEngine → TargetMenu → MenuQualityContract → approval → immutable WritePlan → executor → field-aware verify → `VERIFIED_COMPLETE_HIDDEN` → PublicationPlan → storefront → `VERIFIED_LIVE`.

**No business intelligence after TargetMenu.**

## Layers

```text
src/architecture   version marker (MENU_PLATFORM_ARCHITECTURE_V1)
src/domain         pure business rules
src/extraction     multi-evidence adapters
src/intelligence   constitution, policies, completion, quality
src/planning       WritePlan mapping (no re-invent)
src/runner         executor + field-aware verify + recovery helpers
src/tah            versioned admin adapters (mechanical)
src/portal         Create / QA operator spine
src/runs           SQLite run state + artifacts
```

## Stages (legacy summary)

1. Source acquisition  
2. Extraction → `SourceMenu`  
3. Intelligence → `TargetMenu`  
4. Quality → READY / REVIEW / BLOCK  
5. Human approval (hash-bound)  
6. Immutable `WritePlan` / RecoveryPlan / PublicationPlan  
7. Playwright execution (adapter)  
8. Field-aware read-back → menu verify → hidden or live

## Identity / money

Stable `sourceId`s; `MoneyMinor` = integer øre.

## Ship gate

`npm run check:ship` — see architecture V1 doc. CI runs this gate.
