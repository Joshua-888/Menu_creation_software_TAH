# Learning System

Four separate loops. Never mix knowledge kinds or write paths incorrectly.

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

## Loop D — Peer structure & category probability (M71–M76)

Peer customer menus (observe) → distill **SEMANTIC_RULE** (variant/addition placement, Tilbehør *scope*) + **probability policy** P(feature|kind) → apply in dry-run / gated live → **Policy Application Report** for owner audit.

| Knowledge | What it may encode | What it must not encode |
|-----------|--------------------|-------------------------|
| `SEMANTIC_RULE` | Where choices go (variants vs additions); which *kinds* may receive dips; **category structural-variant fan-out** (Alm/Fam, Deep, Glutenfri, Fuldkorn, Hj. on eligible food categories) | Peer prices, peer option name lists copied as Veroni facts |
| `BUSINESS_FACT` | This restaurant’s Tilbehør list / prices (operator or source) | Invented menu contents |

### Category structural-variant fan-out (structure SEMANTIC_RULE)

When **one product** in an eligible category already exposes structural choice variants, siblings get the same variant axis (priced from **median sibling surcharges** — never invented).

| Applies to | Does **not** apply to |
|------------|------------------------|
| Pizza (all pizza-named), burger, durum, pita, sandwich, indbagt | Drinks, dip / diverse |

Structural kinds: `Alm.`, `Familie` (Fam.), `Deep`, `Glutenfri`, `Fuldkorn`, `Hj.` (hjemmelavet).

Encoded on `MENU_STRUCTURE_SEMANTIC` as `categoryVariantFanOut` (mode `SOURCE_CATEGORY` / `PEER_OR_SOURCE` / `OFF`).

### Category-ingredient Tilbehør (source-empty fill)

When a product has **no source additions**, Tilbehør is composed from the **union of ingredients** across that category (including toppings parsed from Beskrivelse), then fanned out as a `RESTAURANT_CATEGORY` BUSINESS_FACT.

| Applies to | Does **not** apply to |
|------------|------------------------|
| All food categories with recoverable ingredients | Drinks, dip / diverse |

- Dips never enter the composed ekstra list (restaurant mayo Tilbehør still merges separately; probability strips dips from pizza).
- Price: peer median for that name when known, else **10 kr**.
- Precedence when source empty: `EXACT_PRODUCT` → **category-ingredient union** → merge `RESTAURANT` Tilbehør → peer category facts only if the union was empty.
- Artifact: `category-ingredient-additions.json` on the job.

### Per-addition likelihood (M73+)

Peer observe also distills **P(additionName | product_kind)** (Alm/Familie suffixes collapsed).

- Artifacts: `runs/decisions/peer-addition-likelihood.json`
- Veroni (and other jobs) upsert **RESTAURANT_CATEGORY** `BUSINESS_FACT`s from ALLOW rows onto matching menu categories
- Pizza/pasta: **non-dip ekstra toppings** only (dips still kind-gated: finger_food / menu_with_fries)
- Mayo/ketchup restaurant seed still fans out, then probability strips dips from pizza

So Veroni pizza #1 gets peer-consensus ekstra toppings (ost, pepperoni, …), **not** mayo dips.

Hard safety priors (always applied with probability policy):

- Drinks never receive Tilbehør
- Vegetarian never receives meat additions
- Sandwich/burger dips only when classified as `menu_with_fries` (menu with pommes)

### Operator override feedback (M77)

When probability strips mayo dips after restaurant Tilbehør fan-out, the portal seeds **Tilbehør policy** review questions with real `decisionCaseId`s.

Operator answers:

| Resolution | Effect |
|------------|--------|
| `ACCEPT_POLICY_STRIP` | HumanDecision only — keep peer strip |
| `KEEP_TILBEHOR` | EXACT_PRODUCT BUSINESS_FACT with dips; next dry-run skips dip strip for that menu # |
| `SUPPRESS_TILBEHOR` | EXACT_PRODUCT empty set — sticky suppress |

### Pizza topping recovery (M78–M79)

Pizza/calzone products often have toppings only in the **description** with empty ingredient rows. After domain engine:

1. **M78** dry-run CREATE could recover toppings into the write payload.
2. **M79** `applyPizzaToppingRecovery` writes DERIVED ingredient rows onto the canonical menu, revalidates issues (`MISSING_SOURCE_SUPPORTED_INGREDIENTS` → `RESOLVED_BY_POLICY`), and persists updated `canonical-menu.json` before review/dry-run.

Mayo/ketchup dips stay **out** of ingredients (Tilbehør additions only). Never invents when description has no list.

Peer observe (`m71`) uses **stratified sampling** so pizza/calzone rows are not under-sampled when menus are category-clustered.

### Pipeline

```bash
npm run m76:pipeline              # distill + dry-run + policy report (no live writes)
npm run m76:pipeline -- --observe # re-observe PEER_MENU_URLS first
npm run m76:pipeline -- --apply   # gated live reconcile (needs structure confirm)
npm run m76:policy-report         # print latest owner audit markdown
```

Artifacts:

- `runs/decisions/latest-peer-observe.json` — pointer to latest peer snapshot dir
- `runs/decisions/peer-probability-policy.json` — category likelihood policy
- `runs/decisions/peer-structure-summary.json` — structure fingerprint (+ confirm gate)
- `runs/decisions/latest-policy-application.json` / `.md` — **what rules shaped the plan**
- `runs/decisions/policy-application/<runId>.json` — per-run history

### Owner: how to audit applied policies

1. Run `npm run m76:pipeline` (or a portal job dry-run — writes `policy-application.json` on the job).
2. Read `npm run m76:policy-report` or open `runs/decisions/latest-policy-application.md`.
3. Check sections:
   - **SEMANTIC_RULE — menu structure** (fingerprint, meat-choice placement, category structural-variant fan-out, peer hosts)
   - **SEMANTIC_RULE — category probability** (dip allow/deny kinds, hard priors)
   - **BUSINESS_FACT — restaurant** (e.g. Veroni Tilbehør list)
   - **Per-product decisions** (kind, additions before→after, reason codes like `DIP_DENY_KIND`, `CATEGORY_STRUCTURAL_VARIANT_FANOUT`)

Portal Policy UI that renders the same report on the job page is a follow-on; the report JSON is the source of truth.

### Portal (operator)

Job detail (`/jobs/[id]`) shows an **Applied policies** panel from job artifact `policy-application.json` (written by the migration worker dry-run). The jobs API also returns `policyApplication`. CLI `npm run m76:policy-report` remains the system-owner dump of the latest global report.
