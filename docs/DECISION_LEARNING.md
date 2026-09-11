# Decision Policy + Continuous Learning (M6)

## What “learning” means

1. An operator resolves a `DecisionCase` → immutable `HumanDecision` row (never overwritten).
2. The system derives a `PolicyCandidate` from features + chosen resolution.
3. Narrow scopes enter **SHADOW** (observe-only).
4. After enough consistent support (`DECISION_THRESHOLDS`) and a clean shadow evaluation, a policy may become **ACTIVE**.
5. Later matching cases may `AUTO_RESOLVED_POLICY` (or precedent / gated AI).

Recommendations in human-review packs are **system suggestions only**. They are never stored as `HumanDecision` and never seed ACTIVE policies.

## What learning does **not** mean

- Training or fine-tuning models on restaurant data
- Self-modifying application source
- Inventing Menu combo contents, fries/soda bundles, or missing prices
- Auto-answering Veroni (or any) review pack without an operator
- Bypassing WritePlan / capability gates / admin contract certification

## Separate from Loop A / Loop B

See also `LEARNING_SYSTEM.md`:

| Loop | Object | Outcome |
|------|--------|---------|
| A — source patterns | CorrectionEvent → fixture → test → code fix | Extraction/domain correctness |
| B — admin UI | Contract drift → adapter version | Safe writes |
| **C — decisions (M6)** | HumanDecision → policy registry | Reusable semantic resolutions |

Do not mix: a wrong price OCR fix belongs in Loop A, not an ACTIVE decision policy.

## Lifecycle

```
UNRESOLVED
  ├─ ACTIVE policy match (no conflict) → AUTO_RESOLVED_POLICY
  ├─ Precedent consensus + gate → AUTO_RESOLVED_PRECEDENT
  ├─ AI proposal + multi-signal gate → AUTO_RESOLVED_AI
  └─ else → HUMAN_REVIEW_REQUIRED

HumanDecision
  → PolicyCandidate
  → SHADOW (does not execute)
  → support ≥ threshold AND shadow-eval pass → ACTIVE

Human corrects an auto resolution
  → new HumanDecision (immutable)
  → prior ACTIVE policy downgraded to SHADOW for revalidation
```

## WritePlan integration

`buildDryRunWritePlan({ decisionCases })` calls `assertDecisionsResolvedForWrite`.
Statuses `UNRESOLVED`, `HUMAN_REVIEW_REQUIRED`, `POLICY_CONFLICT`, and `BLOCKED` throw
`WRITEPLAN_BLOCKED_UNRESOLVED_DECISIONS`.

## Observability

`npm run m6:learning` writes `runs/m6-decision-learning/` (cases, outcomes, metrics, policies, report).
SQLite store: `runs/m6-decision-learning/decisions.sqlite`.

Veroni learning fixture (frozen 9 decisions): `fixtures/veroni/m6-human-review-final.json`
(does not depend on a live destination snapshot / admin auth).

## Safety defaults

- `globalAutoPromoteEnabled: false`
- Restaurant / exact-case ACTIVE requires ≥ 2 supporting human decisions
- Precedent auto-resolve requires agreement + (for HIGH risk) cross-restaurant support
- Model confidence alone never auto-approves
- Policies that would invent missing Menu facts cannot enter SHADOW/ACTIVE
