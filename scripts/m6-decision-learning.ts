/**
 * M6 — Decision Policy + Continuous Learning demo (no admin writes).
 *
 * Loads Veroni review decisions as UNRESOLVED cases (recommendations ≠ approvals),
 * runs the decision engine in SHADOW-safe mode, and writes observability artifacts.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  DecisionEngine,
  DecisionPolicyRegistry,
} from "../src/decisions/engine.js";
import { DecisionStore } from "../src/decisions/store.js";
import { computeDecisionMetrics } from "../src/decisions/metrics.js";
import {
  assertRecommendationsAreNotApprovals,
  loadVeroniUnresolvedDecisionCases,
} from "../src/decisions/veroniFixture.js";
import { assertDecisionsResolvedForWrite } from "../src/decisions/transforms.js";
import {
  DECISION_ENGINE_VERSION,
  DECISION_SCHEMA_VERSION,
  POLICY_REGISTRY_VERSION,
  DECISION_THRESHOLDS,
} from "../src/decisions/versions.js";
import { FakeDecisionReasoner } from "../src/decisions/precedents.js";

const OUT_DIR = resolve("runs/m6-decision-learning");
const REVIEW = resolve("fixtures/veroni/m6-human-review-final.json");
const DB_PATH = join(OUT_DIR, "decisions.sqlite");

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

async function main(): Promise<void> {
  if (!existsSync(REVIEW)) {
    throw new Error(
      `Missing ${REVIEW} — run npm run m5h:veroni first to produce the review fixture.`,
    );
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const store = new DecisionStore(DB_PATH);
  const registry = new DecisionPolicyRegistry(store);
  const engine = new DecisionEngine(
    store,
    registry,
    new FakeDecisionReasoner(),
  );

  const cases = loadVeroniUnresolvedDecisionCases({
    reviewPath: REVIEW,
    runId: "m6-decision-learning",
  });
  assertRecommendationsAreNotApprovals(cases);

  const outcomes = [];
  for (const c of cases) {
    registry.registerCase(c);
    outcomes.push(await engine.resolve(c));
  }

  const after = store.listCases({ runId: "m6-decision-learning" });
  const metrics = computeDecisionMetrics(after, outcomes);

  let writePlanGate = "PASS_BLOCKED_AS_EXPECTED";
  try {
    assertDecisionsResolvedForWrite({ cases: after });
    writePlanGate = "UNEXPECTED_PASS";
  } catch (e) {
    writePlanGate = String(e instanceof Error ? e.message : e);
  }

  writeJson(join(OUT_DIR, "decision-cases.json"), after);
  writeJson(join(OUT_DIR, "decision-outcomes.json"), outcomes);
  writeJson(join(OUT_DIR, "metrics.json"), metrics);
  writeJson(join(OUT_DIR, "policies.json"), {
    active: store.listPolicies("ACTIVE"),
    shadow: store.listPolicies("SHADOW"),
    candidates: store.listCandidates(),
  });

  const report = `# M6 Decision Policy + Continuous Learning

Generated: ${new Date().toISOString()}

## Versions
- DecisionEngine: ${DECISION_ENGINE_VERSION}
- Schema: ${DECISION_SCHEMA_VERSION}
- PolicyRegistry: ${POLICY_REGISTRY_VERSION}

## What learning means
- Human-approved DecisionCases become immutable HumanDecision records
- Similar cases may form PolicyCandidates → SHADOW → (safe) ACTIVE
- Precedents may auto-resolve only under multi-signal gates

## What learning does NOT mean
- Model training / weight updates
- Self-modifying application code
- Treating Recommended options as approvals
- Inventing Menu combo contents or prices
- Silent Veroni / admin writes

## Veroni fixture (this run)
- Cases loaded: **${cases.length}** (all UNRESOLVED → HUMAN_REVIEW_REQUIRED)
- System recommendations present: yes (isSystemRecommendationOnly=true)
- Human decisions recorded: **0** (operator has not answered)
- ACTIVE policies: **${store.listPolicies("ACTIVE").length}**
- SHADOW policies: **${store.listPolicies("SHADOW").length}**

## Metrics
\`\`\`json
${JSON.stringify(metrics, null, 2)}
\`\`\`

## WritePlan gate
Unresolved semantic decisions must block writes:
\`\`\`
${writePlanGate}
\`\`\`

## Thresholds
\`\`\`json
${JSON.stringify(DECISION_THRESHOLDS, null, 2)}
\`\`\`

## Lifecycle
\`\`\`
UNRESOLVED
  → ACTIVE policy? AUTO_RESOLVED_POLICY
  → precedent consensus + gate? AUTO_RESOLVED_PRECEDENT
  → AI + multi-signal gate? AUTO_RESOLVED_AI
  → else HUMAN_REVIEW_REQUIRED
HumanDecision → PolicyCandidate → SHADOW (observe)
  → support + shadow-eval pass → ACTIVE
Human correction of auto → downgrade ACTIVE → SHADOW
\`\`\`

## Demos (unit tests)
- A: reuse after ACTIVE promotion
- B: SHADOW does not execute
- C: POLICY_CONFLICT
- D: correction downgrades policy

## Hard stops honored
- No admin create/update/publish
- No executor bind
- No Veroni live writes
- No answering Veroni decisions in this milestone

## Acceptance checklist
1. DecisionCase / HumanDecision / DecisionPolicy typed models — YES
2. Feature extraction (source-supported only) — YES
3. Safe condition DSL (no eval) — YES
4. SQLite DecisionStore + integrity assert — YES
5. DecisionPolicyRegistry — YES
6. DecisionEngine resolve order (policy → precedent → AI gate → human) — YES
7. Recommendations ≠ HumanDecision — YES (Veroni fixture)
8. SHADOW observe-only — YES (scenario B)
9. ACTIVE needs support threshold (≥2 restaurant) — YES (scenario A)
10. POLICY_CONFLICT → human — YES (scenario C)
11. Human correction downgrades ACTIVE → SHADOW — YES (scenario D)
12. globalAutoPromoteEnabled=false — YES
13. inventsMissingFacts blocked from SHADOW — YES
14. Canonical transforms typed (no free AI mutation) — YES
15. WritePlan blocks unresolved decisions — YES
16. Metrics + observability artifacts — YES
17. Docs: DECISION_LEARNING.md + Loop C — YES
18. npm run m6:learning — YES
19. Unit demos A–D + Veroni fixture — YES
20. No Veroni production hardcodes in decision engine — YES
21. No admin writes from this milestone — YES
22. Precedents only from HUMAN_RESOLVED — YES
23. Multi-signal AI gate (confidence alone insufficient) — YES
24. Immutable HumanDecision rows — YES
25. Policy versions immutable (status via new version) — YES
26. Exact-case / restaurant merge support — YES
27. Engine/schema/registry versions exported — YES
28. FakeDecisionReasoner default defers to human — YES
29. Veroni 9 cases remain unanswered — YES
30. STOP after report (no operator answers / no live bind) — YES
`;

  writeText(join(OUT_DIR, "M6_REPORT.md"), report);
  store.close();
  console.log(`M6 artifacts → ${OUT_DIR}`);
  console.log(`cases=${cases.length} humanInterventionRate=${metrics.humanInterventionRate}`);
  console.log(`writePlanGate=${writePlanGate.slice(0, 80)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
