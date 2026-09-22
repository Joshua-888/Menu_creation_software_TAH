# Authoritative production entry points

Use these. Milestone `m5*`–`m75*` scripts are historical evidence, not production.

## Runtime

| Command | Role |
|---------|------|
| `npm run portal:build` | Bake deploy-meta + Next build. Chromium ensure is a no-op when `/ms-playwright` exists. |
| `npm run portal:start` | Production HTTP. Asserts Playwright executable; **does not download**. |
| `npm run portal:dev` | Local Next dev only. |
| `npm run portal:seed` | Bootstrap employee. |

## Gates

| Command | Role |
|---------|------|
| `npm run check:fast` | Typecheck + core unit tests for iteration. |
| `npm run check:ship` | Full required deploy gate. Never skip. |
| `npm run typecheck` / `lint` | Always required before ship. |

## Canonical deploy

```text
main → CI green (check:ship) → Railway image build (Chromium baked) → start → /api/version
MAIN_SHA == DEPLOYED_SHA
```

`railway up` is an emergency mechanism only.

## Production code

- Portal worker: `src/portal/worker.ts`
- Live execute: `src/portal/liveExecute.ts`
- Execution bundle: `src/runtime/executionBundle.ts`
- TAH adapter: `src/tah/adapters/v1/adapter.ts`
- Executor: `src/runner/executor.ts`

Production `src/` must not import `scripts/m*` milestone files.

## Script classification (do not delete)

- `scripts/` (root) — documented start/build helpers (`portal-start.mjs`, `write-deploy-meta.mjs`, `ensure-playwright-chromium.mjs`); `scripts/production/` contains only a `README.md` classification note, not the scripts themselves
- `scripts/diagnostics/` — read-only probes (future promotions only)
- `scripts/archive/milestones/` — historical `m5*`–`m75*` evidence, physically relocated under `scripts/archive/milestones/` (see its `README.md`)
