# Multi-merchant go-live checklist

Use this before running **live production tests** on newly acquired merchants.

## Safety defaults

- Live admin writes are **on** when `TAH_ADMIN_EMAIL` / `TAH_ADMIN_PASSWORD` are set and the destination host is allowlisted.
- Kill switches: `PORTAL_LIVE_WRITES=0`, `PORTAL_DRYRUN_LIVE_DEST=0`.
- Destination hosts must be on `PORTAL_LIVE_WRITE_HOSTS` (veronipizza.dk is included by default unless `STRICT`).
- Job `restaurantKey` is the **destination hostname** (not merchant display name).
- New merchants **do not** get Veroni Tilbehør mayo/ketchup defaults.
- Peer probability policies apply to **Veroni only** by default (`PORTAL_APPLY_PEER_PROBABILITY_HOSTS` / `PORTAL_APPLY_PEER_PROBABILITY=1` to opt in).
- Products are created **storefront-visible** by default (`Aktiv?` checked / `intendedHidden: false`). Kill switch: `PORTAL_CREATE_HIDDEN=1`.
- Peer structure fingerprint confirm is **optional** unless `STRUCTURE_WRITE_REQUIRED=1`.
- Clearing the last review question schedules live execute when the live gate is open.

## Env for two new merchants

```bash
PORTAL_SESSION_SECRET=<long-random>
ADMIN_BOOTSTRAP_EMAIL=...
ADMIN_BOOTSTRAP_PASSWORD=...

# Live writes (default on with credentials; these are kill switches / allowlist)
# PORTAL_LIVE_WRITES=0
PORTAL_LIVE_WRITE_HOSTS=merchant1.dk,merchant2.dk
# Optional: do not auto-include veronipizza.dk
PORTAL_LIVE_WRITE_HOSTS_STRICT=1

TAH_ADMIN_EMAIL=...
TAH_ADMIN_PASSWORD=...
# Point discovery/scripts at the merchant under test
TAH_ADMIN_BASE_URL=https://merchant1.dk

# Dry-run against live catalog is automatic with credentials + allowlist.
# PORTAL_DRYRUN_LIVE_DEST=0  # only if you must force offline empty dest

# Do NOT set unless that shop should inherit Veroni default dips
# PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS=

# Only if applying peer-learned structure Tilbehør fan-out live
# STRUCTURE_WRITE_REQUIRED=1
# STRUCTURE_WRITE_CONFIRMED=1
# STRUCTURE_WRITE_FINGERPRINT=<from peer-structure-summary.json>
```

## Per-merchant procedure

1. Add both hosts to `PORTAL_LIVE_WRITE_HOSTS` (and restart portal/worker).
2. Confirm TAH admin login works on each storefront (`/login` → `/admin/menu`).
3. Create a portal job with the merchant PDF; destination host = that shop (`restaurantKey` becomes that hostname).
4. Run worker through ARTIFACTS / REVIEW:
   - Check `destination-snapshot-meta.json` → `source: "live"`.
   - Confirm dry-run creates are **storefront-visible** unless `PORTAL_CREATE_HIDDEN=1`.
   - Answer review questions; do not invent Tilbehør prices from peers.
5. When the last question clears and live gate is open, post-review live execute runs automatically from canonical artifacts.
6. Prefer a **small slice** first; verify products appear on the storefront after live write.
7. Repeat for merchant 2 with its own job (never reuse Veroni decision facts).

## Verify before go-live

```bash
npm run check:ship
```

## Rollback

- Set `PORTAL_LIVE_WRITES=0` to stop all portal live writes immediately.
- Set `PORTAL_CREATE_HIDDEN=1` if you need creates to stay Skjult again.
- Delete or edit in admin if a create was wrong.
