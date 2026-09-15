# Multi-merchant go-live checklist

Use this before running **live production tests** on newly acquired merchants.

## Safety defaults

- Live admin writes are **on** when `TAH_ADMIN_EMAIL` / `TAH_ADMIN_PASSWORD` are set.
- Destination hosts: **any host by default**. Optional restrict via `PORTAL_LIVE_WRITE_HOSTS=shop1.dk,shop2.dk`. Use `PORTAL_LIVE_WRITE_HOSTS=*` explicitly for open. `PORTAL_LIVE_WRITE_HOSTS_STRICT=1` drops automatic Veroni merge when using a restrict list.
- Kill switches: `PORTAL_LIVE_WRITES=0`, `PORTAL_DRYRUN_LIVE_DEST=0`.
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
# Open to any destination (default). To restrict:
# PORTAL_LIVE_WRITE_HOSTS=merchant1.dk,merchant2.dk
# PORTAL_LIVE_WRITE_HOSTS_STRICT=1

TAH_ADMIN_EMAIL=...
TAH_ADMIN_PASSWORD=...
# Point discovery/scripts at the merchant under test
TAH_ADMIN_BASE_URL=https://merchant1.dk
```

## Per-merchant procedure

1. Confirm TAH admin login works on that storefront (`/login` → `/admin/menu`) with the portal `TAH_ADMIN_*` credentials.
2. Create a portal job with the merchant PDF; destination host = that shop (`restaurantKey` becomes that hostname).
3. Run worker through ARTIFACTS / REVIEW:
   - Check `destination-snapshot-meta.json` → `source: "live"`.
   - Confirm dry-run creates are **storefront-visible** unless `PORTAL_CREATE_HIDDEN=1`.
   - Answer review questions; do not invent Tilbehør prices from peers.
4. When the last question clears and live gate is open, post-review live execute runs automatically from canonical artifacts.
5. Prefer a **small slice** first; verify products appear on the storefront after live write.
6. Repeat for merchant 2 with its own job (never reuse Veroni decision facts).

## Verify before go-live

```bash
npm run check:ship
```

## Rollback

- Set `PORTAL_LIVE_WRITES=0` to stop all portal live writes immediately.
- Set `PORTAL_CREATE_HIDDEN=1` if you need creates to stay Skjult again.
- Delete or edit in admin if a create was wrong.
