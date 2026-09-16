import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionEngine, DecisionPolicyRegistry } from "../../src/decisions/engine.js";
import { DecisionStore } from "../../src/decisions/store.js";
import {
  assertDecisionsResolvedForWrite,
  mapResolutionToTransform,
} from "../../src/decisions/transforms.js";
import {
  assertRecommendationsAreNotApprovals,
  loadVeroniUnresolvedDecisionCases,
} from "../../src/decisions/veroniFixture.js";
import { computeDecisionMetrics } from "../../src/decisions/metrics.js";
import { FakeDecisionReasoner } from "../../src/decisions/precedents.js";
import { DECISION_THRESHOLDS } from "../../src/decisions/versions.js";
import { makeDecisionCase } from "./helpers/decisionFixtures.js";

const dirs: string[] = [];

function openStore(): DecisionStore {
  const dir = mkdtempSync(join(tmpdir(), "m6-dec-"));
  dirs.push(dir);
  return new DecisionStore(join(dir, "decisions.sqlite"));
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("M6 decision learning", () => {
  it("A — reuse: two consistent restaurant decisions → ACTIVE → third auto-resolves", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);

    const base = {
      decisionType: "PRODUCT_CHOICE",
      restaurantKey: "reuse.dk",
      sourceText: "ambiguous filling list without choose words",
      options: [
        { id: "product-choice", label: "Product choice", effect: "choice" },
        { id: "ingredient", label: "Ingredient", effect: "ingredient" },
      ],
      sourceCategory: "Burgers",
    };

    const c1 = makeDecisionCase({
      ...base,
      decisionCaseId: "dc_a1",
      menuNumber: "36",
      productName: "Burger A",
    });
    const c2 = makeDecisionCase({
      ...base,
      decisionCaseId: "dc_a2",
      menuNumber: "37",
      productName: "Burger B",
    });
    const c3 = makeDecisionCase({
      ...base,
      decisionCaseId: "dc_a3",
      menuNumber: "39",
      productName: "Burger C",
    });

    registry.registerCase(c1);
    registry.registerCase(c2);
    registry.registerCase(c3);

    // First resolve → human review (no policy yet)
    const o1 = await engine.resolve(c1);
    expect(o1.status).toBe("HUMAN_REVIEW_REQUIRED");

    registry.recordHumanDecision(store.getCase(c1.decisionCaseId)!, {
      decisionCaseId: c1.decisionCaseId,
      resolution: "PRODUCT_CHOICE",
      selectedOptionId: "product-choice",
      scopePreference: "APPLY_TO_THIS_RESTAURANT",
      operatorId: "op1",
    });

    expect(store.listPolicies("ACTIVE")).toHaveLength(0);
    expect(store.listPolicies("SHADOW").length).toBeGreaterThanOrEqual(1);

    // Second consistent decision → promote to ACTIVE
    await engine.resolve(store.getCase(c2.decisionCaseId)!);
    registry.recordHumanDecision(store.getCase(c2.decisionCaseId)!, {
      decisionCaseId: c2.decisionCaseId,
      resolution: "PRODUCT_CHOICE",
      selectedOptionId: "product-choice",
      scopePreference: "APPLY_TO_THIS_RESTAURANT",
      operatorId: "op1",
    });

    const active = store.listPolicies("ACTIVE");
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active[0]!.createdFromDecisionIds.length).toBeGreaterThanOrEqual(
      DECISION_THRESHOLDS.restaurantPolicyMinSupport,
    );

    // Third case auto-resolves via ACTIVE policy
    const o3 = await engine.resolve(store.getCase(c3.decisionCaseId)!);
    expect(o3.status).toBe("AUTO_RESOLVED_POLICY");
    expect(o3.method).toBe("ACTIVE_POLICY");
    expect(o3.optionId).toBe("product-choice");
    store.close();
  });

  it("B — SHADOW stays non-executing until support threshold", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);
    const c1 = makeDecisionCase({
      decisionCaseId: "dc_b1",
      decisionType: "PRODUCT_CHOICE",
      sourceText: "optional filling list without strong choose words",
    });
    registry.registerCase(c1);
    await engine.resolve(c1);
    registry.recordHumanDecision(store.getCase(c1.decisionCaseId)!, {
      decisionCaseId: c1.decisionCaseId,
      resolution: "PRODUCT_CHOICE",
      selectedOptionId: "product-choice",
      scopePreference: "APPLY_TO_THIS_RESTAURANT",
    });
    expect(store.listPolicies("SHADOW").length).toBeGreaterThanOrEqual(1);
    expect(store.listPolicies("ACTIVE")).toHaveLength(0);

    const twin = makeDecisionCase({
      decisionCaseId: "dc_b2",
      decisionType: "PRODUCT_CHOICE",
      menuNumber: "11",
      productName: "Other",
      sourceText: "optional filling list without strong choose words",
    });
    registry.registerCase(twin);
    const o = await engine.resolve(twin);
    // Still review — SHADOW must not execute
    expect(o.status).toBe("HUMAN_REVIEW_REQUIRED");
    store.close();
  });

  it("C — POLICY_CONFLICT when two ACTIVE policies disagree", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);

    // Manually insert two conflicting ACTIVE policies with same specificity
    store.insertPolicyVersion({
      policyId: "pol_conflict_a",
      policyVersion: 1,
      decisionType: "PRODUCT_CHOICE",
      scope: "GLOBAL",
      scopeRestaurant: null,
      scopeCategory: null,
      conditions: {
        all: [{ field: "decisionType", op: "eq", value: "PRODUCT_CHOICE" }],
      },
      resolution: "PRODUCT_CHOICE",
      resolutionOptionId: "product-choice",
      status: "ACTIVE",
      createdFromDecisionIds: ["hd_x"],
      confidenceEvidence: null,
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
      deprecatedAt: null,
      createdBy: "test",
      validationSummary: null,
      inventsMissingFacts: false,
    });
    store.insertPolicyVersion({
      policyId: "pol_conflict_b",
      policyVersion: 1,
      decisionType: "PRODUCT_CHOICE",
      scope: "GLOBAL",
      scopeRestaurant: null,
      scopeCategory: null,
      conditions: {
        all: [{ field: "decisionType", op: "eq", value: "PRODUCT_CHOICE" }],
      },
      resolution: "INGREDIENT",
      resolutionOptionId: "ingredient",
      status: "ACTIVE",
      createdFromDecisionIds: ["hd_y"],
      confidenceEvidence: null,
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
      deprecatedAt: null,
      createdBy: "test",
      validationSummary: null,
      inventsMissingFacts: false,
    });

    const c = makeDecisionCase({
      decisionCaseId: "dc_c1",
      sourceText: "skinke/kebab only slash",
    });
    registry.registerCase(c);
    const o = await engine.resolve(c);
    expect(o.status).toBe("POLICY_CONFLICT");
    store.close();
  });

  it("D — human correction downgrades ACTIVE policy to SHADOW", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(store, registry);

    const opts = [
      { id: "product-choice", label: "Choice", effect: "c" },
      { id: "ingredient", label: "Ing", effect: "i" },
    ];
    const mk = (id: string, num: string) =>
      makeDecisionCase({
        decisionCaseId: id,
        menuNumber: num,
        productName: `P${num}`,
        sourceText: "Vælg mellem x eller y",
        options: opts,
        restaurantKey: "corr.dk",
      });

    const a = mk("dc_d1", "1");
    const b = mk("dc_d2", "2");
    registry.registerCase(a);
    registry.registerCase(b);
    await engine.resolve(a);
    registry.recordHumanDecision(store.getCase(a.decisionCaseId)!, {
      decisionCaseId: a.decisionCaseId,
      resolution: "PRODUCT_CHOICE",
      selectedOptionId: "product-choice",
      scopePreference: "APPLY_TO_THIS_RESTAURANT",
    });
    await engine.resolve(store.getCase(b.decisionCaseId)!);
    registry.recordHumanDecision(store.getCase(b.decisionCaseId)!, {
      decisionCaseId: b.decisionCaseId,
      resolution: "PRODUCT_CHOICE",
      selectedOptionId: "product-choice",
      scopePreference: "APPLY_TO_THIS_RESTAURANT",
    });

    const activeBefore = store.listPolicies("ACTIVE");
    expect(activeBefore.length).toBeGreaterThanOrEqual(1);
    const pol = activeBefore[0]!;

    const c3 = mk("dc_d3", "3");
    registry.registerCase(c3);
    const auto = await engine.resolve(c3);
    expect(auto.status).toBe("AUTO_RESOLVED_POLICY");

    // Operator corrects the auto outcome
    registry.recordHumanDecision(
      store.getCase(c3.decisionCaseId)!,
      {
        decisionCaseId: c3.decisionCaseId,
        resolution: "INGREDIENT",
        selectedOptionId: "ingredient",
        scopePreference: "APPLY_THIS_CASE_ONLY",
        comment: "wrong auto",
      },
      {
        correctionOfAuto: {
          method: auto.method,
          policyId: auto.policyId,
          policyVersion: auto.policyVersion,
        },
      },
    );

    const latest = store.latestPolicy(pol.policyId);
    expect(latest?.status).toBe("SHADOW");
    store.close();
  });

  it("safety — recommendations are never human approvals; invents-facts blocked", () => {
    const cases = loadVeroniUnresolvedDecisionCases({
      reviewPath: "fixtures/veroni/m6-human-review-final.json",
      runId: "m6-test-veroni",
    });
    expect(cases.length).toBe(9);
    assertRecommendationsAreNotApprovals(cases);
    for (const c of cases) {
      expect(c.status).toBe("UNRESOLVED");
      expect(c.isSystemRecommendationOnly).toBe(true);
    }
    expect(mapResolutionToTransform("MENU_AS_VARIANT", "variant")).toBe(
      "MENU_IS_COMBO_NOT_VARIANT",
    );
  });

  it("WritePlan blocks unresolved decisions", () => {
    expect(() =>
      assertDecisionsResolvedForWrite({
        cases: [{ decisionCaseId: "x", status: "UNRESOLVED" }],
      }),
    ).toThrow(/WRITEPLAN_BLOCKED_UNRESOLVED_DECISIONS/);
  });

  it("Veroni fixture: recommendations are not approvals; engine may deterministically resolve strong language", async () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);
    const engine = new DecisionEngine(
      store,
      registry,
      new FakeDecisionReasoner(),
    );
    const cases = loadVeroniUnresolvedDecisionCases({
      reviewPath: "fixtures/veroni/m6-human-review-final.json",
      runId: "m6-metrics",
    });
    const outcomes = [];
    for (const c of cases) {
      registry.registerCase(c);
      outcomes.push(await engine.resolve(c));
    }
    const after = store.listCases({ runId: "m6-metrics" });
    const metrics = computeDecisionMetrics(after, outcomes);
    expect(metrics.decisionCases).toBe(9);
    expect(metrics.resolvedByActivePolicy).toBe(0);
    expect(store.listHumanDecisions()).toHaveLength(0);
    expect(store.listPolicies("ACTIVE")).toHaveLength(0);
    // Strong source language may AUTO_RESOLVED_DETERMINISTIC; remainder needs human
    expect(metrics.humanInterventionRate).toBeGreaterThan(0);
    expect(
      after.every(
        (c) =>
          c.status === "HUMAN_REVIEW_REQUIRED" ||
          c.status === "AUTO_RESOLVED_DETERMINISTIC",
      ),
    ).toBe(true);
    store.close();
  });
});
