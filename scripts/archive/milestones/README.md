# Milestone archive

`scripts/m5*`–`m75*` remain in `scripts/` so historical paths and package.json aliases keep working.

They are **not** production entry points. Do not call them from `src/`. Do not use them to mutate Bella.

See [AUTHORITATIVE_PRODUCTION_ENTRY_POINTS.md](../../docs/architecture/AUTHORITATIVE_PRODUCTION_ENTRY_POINTS.md).
