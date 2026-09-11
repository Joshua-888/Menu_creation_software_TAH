# Learning System

Two separate loops. Never mix.

## Loop A — Source menu patterns

production error → evidence → human correction → CorrectionEvent → minimized fixture → failing test → fix → full regression → merge

## Loop B — Admin UI changes

contract drift → block writes → capture → repair mode → new adapter version → contract tests → dry-run → canary write/read-back → certify → activate

LLM may assist candidate repairs; must never silently continue production imports after drift.

Corrections become permanent knowledge only via fixture + test + implementation + regression.

## Loop C — Decision policy reuse (M6)

See `DECISION_LEARNING.md`.

human review → HumanDecision (immutable) → PolicyCandidate → SHADOW → safe ACTIVE → auto-resolve later

Recommendations ≠ approvals. No inventing Menu contents. No admin writes from learning alone.
