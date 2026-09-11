# Price + Additions Learning (M6.3)

Extends the M6 decision architecture. Not a parallel system.

## Semantic vs business fact

| Kind | May generalize | Example |
|------|----------------|---------|
| SEMANTIC_RULE | Yes (carefully) | `+X` after ingredient → paid addition using **source** X |
| BUSINESS_FACT | No GLOBAL fixed values | Veroni Ekstra ost = 1500 øre; Veroni Vælg selv options |

## Fact precedence

1. CURRENT EXPLICIT SOURCE EVIDENCE  
2. EXACT HUMAN CORRECTION / EXACT PRODUCT FACT  
3. RESTAURANT_CATEGORY FACT  
4. RESTAURANT FACT  
5. Semantic policy / precedent  
6. AI / human review  

Source vs learned conflict → keep source, record `LEARNED_FACT_CONFLICT_WITH_SOURCE`.

## GLOBAL protection

`assertGlobalPolicyHasNoFixedMoney` rejects GLOBAL BUSINESS_FACT with fixed amounts/option lists.

## Modules

- `facts.ts` — PriceFact, AdditionSetFact, ChoiceOptionsFact  
- `factStore.ts` — SQLite tables  
- `priceSemantics.ts` — Alm/Familie arithmetic  
- `precedence.ts` — effective value resolution  
- `moneyTransforms.ts` — CanonicalMenu transforms + WritePlan money gate  
- `operatorParser.ts` — OperatorDecisionParserPort  
- `batchResolve.ts` — one answer → many cases  

## Demo

`npm run m63:learning` → `runs/m63-price-additions/`
