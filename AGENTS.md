# AGENTS.md — TakeAwayHero Menu Migration

## What this repo is

A **reliable, auditable, recoverable** menu migration platform for TakeAwayHero.

Success = `EXPECTED → WRITE → SAVE → READ BACK → NORMALIZE → COMPARE → VERIFIED`.

A browser click or save banner is **not** success.

## Decision priority

correctness > silent-error prevention > auditability > recoverability > testability > versionability > maintainability > usability > performance > autonomy

## AI vs deterministic

**AI may:** interpret heterogeneous sources, classify ambiguous structures, extract from HTML/PDF/images when parsing is insufficient.

**Deterministic code must:** menu numbers, arithmetic, base price, surcharges, validation, WritePlan, Playwright execution, retries, persistence, read-back, compare, audit, recovery, admin version handling.

Never ask an LLM to do deterministic work.

## Pipeline stages (do not skip)

SOURCE → EXTRACTION → SOURCE MODEL → NORMALIZATION → CANONICAL MENU → DOMAIN RULES → VALIDATION → HUMAN REVIEW → APPROVED → WRITE PLAN → ADMIN CONTRACT CHECK → PLAYWRIGHT → READ BACK → COMPARE → VERIFIED|FAILED

## Hard rules

- Domain code **must not** import Playwright or AI SDKs.
- Extraction **must not** write to TakeAwayHero.
- Browser adapters **must not** invent menu-business decisions.
- On `ADMIN_CONTRACT_DRIFT`: **block production writes**.
- Only `CERTIFIED` admin adapters may write production menus.
- Credentials never committed; auth under `playwright/.auth/` (gitignored).

## Identity and provenance

- Stable `sourceId` on entities; ProductChoice references **IDs**, not names.
- Menu numbers are strings (support `220A`, `01`); only pure integers count toward highest-numeric assignment.
- `ValueOrigin`: `SOURCE | DERIVED | SYSTEM_DEFAULT | HUMAN_CORRECTION`.
- Status aggregation (one function): `BLOCKED > MANUAL_REVIEW_REQUIRED > WARNING > READY`.

## Milestone discipline

Current work baseline: **Milestone 1 frozen** (deterministic domain engine).

- **M2** = Playwright **read-only** discovery of an **explicitly supplied** restaurant admin URL only. No host guessing. No mutations.
- **M3** = first WRITE + READ-BACK against **canary** only.

**Do not start the next milestone** without explicit human approval.

## Done means

Implementation + types + relevant tests green + docs updated if needed. Bug fixes ship with regression fixtures when applicable.

Business logic lives in **code + tests**, not only Cursor rules.
