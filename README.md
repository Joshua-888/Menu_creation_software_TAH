# TakeAwayHero Menu Migration Platform

Operational system for onboarding restaurants: extract source menus, normalize through a deterministic domain engine, human-review exceptions, then write into TakeAwayHero admin with read-back verification.

This is **not** a monolithic AI browser agent.

## Status

**Milestone 1 — Deterministic domain engine** complete.

- No Playwright writes
- No AI extraction
- No production admin mutation

See [PLAN.md](PLAN.md) and [AGENTS.md](AGENTS.md).

## Setup

```bash
npm install
npm run check
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | TypeScript strict |
| `npm run test:domain` | Domain + property tests |
| `npm run lint` | ESLint |
| `npm run check` | typecheck + domain tests (quality gate) |

## Layout

```text
src/domain/     Canonical schema + rule engine (Milestone 1)
src/extraction/ Extractor interfaces (stubs)
src/tah/        Admin adapter / contract / WritePlan types (stubs)
src/runs/       Run state / error taxonomy types (stubs)
src/review/     CorrectionEvent types (stubs)
tests/domain/   Domain + fast-check tests
fixtures/       Menu-pattern fixtures
docs/           Architecture and domain docs
```

## Security

Never commit passwords, cookies, or auth state. See `.gitignore` and `docs/SECURITY.md`.
