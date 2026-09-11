# TakeAwayHero Menu Migration Platform

Operational system for onboarding restaurants: extract source menus, normalize through a deterministic domain engine, human-review exceptions, then write into TakeAwayHero admin with read-back verification.

This is **not** a monolithic AI browser agent.

## Status

**Milestone 1 — Deterministic domain engine** complete.

- No Playwright writes
- No AI extraction
- No production admin mutation

See [PLAN.md](PLAN.md) and [AGENTS.md](AGENTS.md).

## Operator Portal — deploy & invite employees

Internal TakeAwayHero employee web app for merchant menu migrations (PDF upload + optional source URL). **Dry-run is the default.** Live admin writes require an explicit env flag (see below).

### Local

```bash
cp .env.example .env
# set PORTAL_SESSION_SECRET, ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD
npm install
npm run portal:seed
npm run portal:dev
# open http://localhost:3000/login
```

Pre-push ship gate (no Playwright browsers / no heavy PDF OCR suite):

```bash
npm run check:ship
```

### Live writes (gated)

Dry-run remains the default. To unlock live executor writes against an allowlisted host:

1. Certify createCategory canary on Veroni: `npm run m67:category` (needs `TAH_ADMIN_*` in `.env`)
2. Set `PORTAL_LIVE_WRITES=1`
3. Destination host must be allowlisted (`veronipizza.dk` for this milestone)
4. Provide `TAH_ADMIN_EMAIL` / `TAH_ADMIN_PASSWORD` for Playwright admin session

Without the flag, the portal only writes dry-run artifacts. Customer Pasta create uses `allowCustomerCategory: true` at the executor call site after the canary gate.

Heavy Veroni PDF extraction tests (optional, slow):

```bash
npm run test:extraction
```

Add more employees:

```bash
npm run portal:seed -- --email colleague@takeawayhero.example --password '…' --name "Colleague"
```

### Railway (recommended)

1. Push this repo to GitHub (`Joshua-888/Menu_creation_software_TAH`).
2. New Railway project → deploy from that repo (uses `railway.toml` / Nixpacks, or `Dockerfile.portal`).
3. Attach a **persistent volume** at `/data` and set:
   - `PORTAL_DATA_DIR=/data/portal`
   - `PORTAL_SESSION_SECRET` (long random, min 16 chars) — **required** or the app will not boot pages in production
   - `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`
   - Leave `PORTAL_LIVE_WRITES` unset unless intentionally enabling gated live writes
4. Prefer a **single running instance** while the portal uses local SQLite on the volume.
5. Open `https://<railway-url>/login` with personal credentials.

Do **not** commit `*.traineddata`, `.env`, or `data/` — they are gitignored (Tesseract downloads language data at runtime).

Portal code: `apps/portal/` (Next.js) + `src/portal/` (auth, jobs, worker). Engine reuse: `src/domain`, `src/extraction`, `src/decisions`, `src/planning`.

| Command | Purpose |
|---------|---------|
| `npm run portal:dev` | Next.js portal on :3000 |
| `npm run portal:build` / `portal:start` | Production portal |
| `npm run portal:seed` | Bootstrap / add employees |
| `npm run m67:category` | Veroni createCategory canary certification |
| `npm run test:portal` | Portal unit/API smoke tests |

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
| `npm run check` | typecheck + domain + contract + unit tests |
| `npm run portal:dev` | Operator portal (local) |

## Layout

```text
apps/portal/    Next.js Operator Portal (employee UI + API)
src/portal/     Portal auth, jobs, worker adapters
src/domain/     Canonical schema + rule engine
src/extraction/ PDF / source extractors
src/decisions/  Decision learning + human review
src/planning/   Dry-run WritePlan
src/tah/        Admin adapter / contract / WritePlan types
tests/          Domain, contract, unit, portal tests
fixtures/       Menu-pattern fixtures
docs/           Architecture and domain docs
```

## Security

Never commit passwords, cookies, or auth state. See `.gitignore` and `docs/SECURITY.md`.
