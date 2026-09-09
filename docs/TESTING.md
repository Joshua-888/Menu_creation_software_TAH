# Testing

| Layer | Tool | When |
|-------|------|------|
| Unit | Vitest | Pure helpers |
| Domain | Vitest + fixtures | Numbering, pricing, ingredients, validation |
| Property | fast-check | Numbering/pricing/purity/determinism invariants |
| Contract | later | AdminContract |
| Integration | Playwright | M2+ against canary |
| Regression | fixtures | Historical failures |

`npm run check` = typecheck + domain tests.

Keep tests deterministic. Seed fast-check when needed.
