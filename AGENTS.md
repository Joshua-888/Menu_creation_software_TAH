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

## Authoritative status and architecture

This file is a broad contributor guide, not the operational source of truth. Before making architectural, execution, recovery, publication, menu-intelligence, or production-safety changes, read the current authoritative documents, in precedence order:

1. [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) — current operational/certification state (what is certified now).
2. [docs/architecture/MENU_PLATFORM_ARCHITECTURE_V1.md](docs/architecture/MENU_PLATFORM_ARCHITECTURE_V1.md) — the single frozen authoritative product architecture.
3. Current architecture/operations documents under [docs/architecture/](docs/architecture/), including `OPERATIONAL_HARDENING_V1.md`, `EXECUTION_BUNDLE_V1.md`, `RUNTIME_AND_RECOVERY_V1.md`, `MENU_CONSTITUTION_V1.md`, `GLOBAL_POLICY_REGISTRY_V1.md`, `QUALITY_CONTRACT_REGISTRY_V1.md`, `CAPABILITY_MATRIX_V1.md`, `STATE_MACHINE_V1.md`, `ARTIFACT_STANDARD_V1.md`, `READINESS_DEFINITIONS_V1.md`, `SCRIPT_CLASSIFICATION_V1.md`, `APPROVAL_ARCHITECTURE_V1.md`, `VERIFICATION_ARCHITECTURE_V1.md`, `RECOVERY_ARCHITECTURE_V1.md`, `PUBLICATION_ARCHITECTURE_V1.md`, and `GOLDEN_FIXTURES_V1.md`.
4. [docs/INCIDENT_REGRESSION_REGISTRY.md](docs/INCIDENT_REGRESSION_REGISTRY.md) and current reliability/security/runbook documentation.

If an older document conflicts with a newer authoritative status or architecture document, do not silently choose one: follow the current authoritative document and report the drift.

Do not revive superseded milestone assumptions, policies, or legacy behavior merely because they still appear in older files.

Historical note: the early `M1`/`M2`/`M3` milestones (frozen deterministic domain engine, read-only discovery, first canary write + read-back) are historical context only. They are **not** the current operating baseline; see `docs/PROJECT_STATUS.md` for the current state. Destructive or live operations still require explicit human authorization bound to the exact destination and operation.

## Done means

Implementation + types + relevant tests green + docs updated if needed. Bug fixes ship with regression fixtures when applicable.

Business logic lives in **code + tests**, not only Cursor rules.
