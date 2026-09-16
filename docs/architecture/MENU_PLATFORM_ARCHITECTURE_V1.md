# MENU PLATFORM ARCHITECTURE V1

**Version:** `MENU_PLATFORM_ARCHITECTURE_V1`  
**Frozen:** 2026-09-16  
**Constitution:** `MenuConstitutionV1`  
**Capability matrix:** `TahCapabilityMatrixV1`  
**Core pipeline:** `MenuCorePipelineV1`

Bella Kebab production evidence binding this freeze:

- `BELLA_MENU_STATE = VERIFIED_LIVE`
- 12/12 products, TargetMenu equality PASS
- 0 semantic mismatches, 0 duplicates
- receipt-safe naming PASS, publication PASS, storefront PASS

This document is the **single authoritative** architecture. No parallel business-logic universes.

---

## 1. Canonical pipeline

```text
RAW SOURCE
↓ Source ingestion
↓ Multi-evidence extraction (text / OCR / layout / price anchors / vision fallback)
↓ Source evidence ledger
↓ SourceMenu
↓ Semantic classification
↓ MenuIntelligenceEngine
    · Menu Constitution
    · approved restaurant facts
    · global policies
    · peer evidence
    · completion
↓ TargetMenu
↓ MenuQualityContract → READY / REVIEW / BLOCK
↓ Operator Preview
↓ Explicit Operator Approval
↓ Immutable WritePlan
↓ Destination Executor
↓ Field-aware Read-back Verification
↓ Menu-level Verification
↓ VERIFIED_COMPLETE_HIDDEN
↓ Explicit PublicationPlan (visibility only)
↓ Publication
↓ Storefront Verification
↓ VERIFIED_LIVE
```

**Hard rule:** NO business intelligence after TargetMenu.  
WritePlan / Executor / Verifier / Publication map, mutate mechanically, or compare — they do not invent menu semantics.

Code marker: `src/architecture/menuPlatformArchitectureV1.ts`

---

## 2. System boundaries (ownership)

| Layer | Owns | Must not |
|-------|------|----------|
| **EXTRACTION** | What source evidence exists | Decide final restaurant menu |
| **INTELLIGENCE** | What the final menu should be (`TargetMenu`) | Talk to browser / destination |
| **QUALITY CONTRACT** | Whether TargetMenu is safe to write | Invent fields |
| **PLANNER** | How approved state maps to destination ops | Re-complete products |
| **EXECUTOR** | Performing immutable operations | Restaurant intelligence |
| **VERIFIER** | Whether destination equals intended state | “Fix” by rewriting content |
| **RECOVERY** | Safe continuation from partial state | Replay stale plans |
| **PUBLICATION** | Visibility / availability transition only | Change name/price/ingredients/etc. |
| **Browser / Playwright** | Mechanical interaction only | Business rules |

Dependency direction (conceptual):

```text
source/extraction → domain/intelligence → quality → planning → execution → verification
```

Recovery and publication **orchestrate** these components; they do not own a second intelligence engine.

---

## 3. Shared intents (Create / QA / Recovery / Publication)

| Intent | Flow | Shared core |
|--------|------|-------------|
| **CREATE** | raw → TargetMenu → write new state | `runMenuIntelligence`, quality, WritePlan, executor, field-aware verify |
| **QA** | live menu → intelligence → never-worse candidate → WritePlan | same intelligence + quality; compare never invent |
| **RECOVERY** | actual destination + approved TargetMenu → RecoveryPlan | snapshot hash binding; no auto-replan-execute |
| **PUBLICATION** | verified hidden menu → visibility-only PublicationPlan | `#active` + Opdater; content re-verify |

Do not duplicate semantic completion between these paths.

---

## 4. Production entry points

| Entry | Production reachable | Intelligence | Quality | WritePlan | Central executor | Central verifier |
|-------|---------------------|--------------|---------|-----------|------------------|------------------|
| Portal Create UI → worker | YES | YES | YES | YES | YES (liveExecute) | YES (field-aware) |
| Portal QA UI → worker | YES | YES | YES | YES | YES | YES |
| Recovery scripts / plans | Operator-gated | Uses frozen TargetMenu | Gate before write | RecoveryPlan | Adapter/port | Field-aware |
| Publication certification | Operator-gated | No | Content re-verify only | PublicationPlan | `#active`+Opdater | Field-aware + storefront |
| Golden certification CLI (`cert-*-raw`) | CI / local | YES | YES | no live write | n/a | n/a |
| Legacy milestone scripts (`scripts/m*`, `scripts/bella-*`) | **NOT** production spine | varies | varies | ad-hoc | ad-hoc | ad-hoc |

**Requirement:** `PRODUCTION_SIDE_DOOR_BUSINESS_LOGIC = 0`  
Enforced by `tests/certification/production-purity-audit.test.ts`.

Merchant-specific executable scripts under `scripts/` are **historical / certification / incident tooling**, not the production Create/QA spine. Classification: `docs/architecture/SCRIPT_CLASSIFICATION_V1.md`.

---

## 5. Related documents

| Doc | Purpose |
|-----|---------|
| [MENU_CONSTITUTION_V1.md](./MENU_CONSTITUTION_V1.md) | Hard invariants vs policies vs peers vs facts |
| [GLOBAL_POLICY_REGISTRY_V1.md](./GLOBAL_POLICY_REGISTRY_V1.md) | Active / superseded policies |
| [QUALITY_CONTRACT_REGISTRY_V1.md](./QUALITY_CONTRACT_REGISTRY_V1.md) | Quality gates |
| [EXTRACTION_ARCHITECTURE_V1.md](./EXTRACTION_ARCHITECTURE_V1.md) | Multi-evidence extraction |
| [VERIFICATION_ARCHITECTURE_V1.md](./VERIFICATION_ARCHITECTURE_V1.md) | Field-aware verification |
| [RECOVERY_ARCHITECTURE_V1.md](./RECOVERY_ARCHITECTURE_V1.md) | Partial write / RecoveryPlan |
| [APPROVAL_ARCHITECTURE_V1.md](./APPROVAL_ARCHITECTURE_V1.md) | Explicit approval binding |
| [PUBLICATION_ARCHITECTURE_V1.md](./PUBLICATION_ARCHITECTURE_V1.md) | Hidden → live |
| [CAPABILITY_MATRIX_V1.md](./CAPABILITY_MATRIX_V1.md) | CERTIFIED / UNCERTIFIED / UNSUPPORTED |
| [STATE_MACHINE_V1.md](./STATE_MACHINE_V1.md) | Job / entity states |
| [ARTIFACT_STANDARD_V1.md](./ARTIFACT_STANDARD_V1.md) | Per-run artifacts |
| [GOLDEN_FIXTURES_V1.md](./GOLDEN_FIXTURES_V1.md) | Smash / Veroni / Bella / Thai |
| [READINESS_DEFINITIONS_V1.md](./READINESS_DEFINITIONS_V1.md) | Intelligence / Execution / Live ready |
| [SCRIPT_CLASSIFICATION_V1.md](./SCRIPT_CLASSIFICATION_V1.md) | Bella / Veroni / Smash script fate |
| [../INCIDENT_REGRESSION_REGISTRY.md](../INCIDENT_REGRESSION_REGISTRY.md) | BELLA-001…012 |

---

## 6. Ship gate

Canonical command:

```bash
npm run check:ship
```

Must include typecheck, unit, domain, portal, certification (incl. Bella/Smash/Veroni/Thai + purity), contract, extraction where applicable, and portal build.

CI: `.github/workflows/ci.yml` runs `npm run check:ship` after Playwright Chromium install.

---

## 7. Category exposure limitation

`CATEGORY_CREATE_IS_PUBLIC_MUTATION = true`

TAH cannot hide categories. Strategy: validate dependent product payloads first → create category → immediately create/verify hidden products. Never treat category create as staged/hidden.

---

## 8. Freeze statement

`ARCHITECTURE_V1_FROZEN = YES` when:

- this document set is committed
- ship gate passes with Bella/Smash/Veroni/Thai
- production purity audits pass
- no merchant-specific runtime business logic in intelligence/planning/portal/domain

Consolidation must be **behavior-preserving**. Unexpected TargetMenu drift → STOP; do not retune goldens for refactor noise.
