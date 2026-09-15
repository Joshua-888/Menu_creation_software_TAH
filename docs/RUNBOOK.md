# Runbook

Operational procedures for production migrations.

1. Local / CI gate: `npm run check` or `npm run check:ship`.
2. Multi-merchant production test (2 new shops): follow [MULTI_MERCHANT_GO_LIVE.md](./MULTI_MERCHANT_GO_LIVE.md).
3. Live writes are on with `TAH_ADMIN_*` + host allowlist (`PORTAL_LIVE_WRITES=0` to stop). Prefer hidden creates; activate in admin after review.
4. Learning / peer structure: [LEARNING_SYSTEM.md](./LEARNING_SYSTEM.md).
