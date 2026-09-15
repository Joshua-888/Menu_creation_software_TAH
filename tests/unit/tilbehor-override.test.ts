import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionStore } from "../../src/decisions/store.js";
import { DecisionPolicyRegistry } from "../../src/decisions/engine.js";
import {
  distillProbabilityPolicy,
} from "../../src/learning/categoryLikelihood.js";
import {
  applyTilbehorOverrideFromAnswer,
  buildTilbehorOverrideDecisionCase,
  menuNumbersWithKeepTilbehorOverride,
  selectTilbehorOverrideTraces,
} from "../../src/learning/tilbehorOverride.js";
import { upsertVeroniTilbehorBusinessFact } from "../../src/learning/structurePolicy.js";
import {
  applyProbabilityFilterToMenu,
  fanOutRestaurantAdditions,
} from "../../src/planning/structureMapping.js";
import type { PeerMenuSnapshot } from "../../src/learning/peerMenuStructure.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import type { ProductPolicyTrace } from "../../src/planning/structureMapping.js";

function peers(): PeerMenuSnapshot[] {
  return [
    {
      host: "a.dk",
      restaurantKey: "a.dk",
      observedAt: "2026-01-01T00:00:00.000Z",
      source: "fixture",
      products: [
        {
          menuNumber: "1",
          name: "Pommes",
          variants: [],
          additions: [{ name: "Ketchup", priceOre: 1000 }],
        },
        {
          menuNumber: "2",
          name: "Nuggets",
          variants: [],
          additions: [{ name: "Ketchup", priceOre: 1000 }],
        },
        {
          menuNumber: "3",
          name: "Pommes 2",
          variants: [],
          additions: [{ name: "Remoulade", priceOre: 1000 }],
        },
        {
          menuNumber: "4",
          name: "Pizza Vesuvio",
          variants: [],
          additions: [],
        },
      ],
    },
  ];
}

function pizzaMenu(): CanonicalMenu {
  return {
    categories: [
      {
        sourceId: "c1",
        name: "Pizza",
        products: [
          {
            sourceId: "p3",
            name: "Hawaii",
            sourceMenuNumber: "3",
            status: "READY",
            variants: [],
            ingredients: [],
            addOns: [],
          },
        ],
      },
    ],
  } as unknown as CanonicalMenu;
}

describe("M77 tilbehør override feedback", () => {
  const dirs: string[] = [];
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

  it("selects traces that fan-out then strip dips", () => {
    const traces: ProductPolicyTrace[] = [
      {
        menuNumber: "3",
        sourceId: "p3",
        name: "Hawaii",
        categoryName: "Pizza",
        kind: "pizza",
        reasonCodes: ["DIP_DENY_KIND", "FANOUT_TILBEHOR"],
        additionsBefore: ["Ketchup"],
        additionsAfter: [],
        removed: [{ name: "Ketchup", reason: "DIP_DENY_KIND" }],
        fanOutTilbehor: true,
        structureNotes: [],
      },
      {
        menuNumber: "48",
        sourceId: "p48",
        name: "Pommes",
        categoryName: "Grill",
        kind: "finger_food",
        reasonCodes: ["KEPT", "FANOUT_TILBEHOR"],
        additionsBefore: ["Ketchup"],
        additionsAfter: ["Ketchup"],
        removed: [],
        fanOutTilbehor: true,
        structureNotes: [],
      },
    ];
    expect(selectTilbehorOverrideTraces(traces)).toHaveLength(1);
    expect(selectTilbehorOverrideTraces(traces)[0]?.menuNumber).toBe("3");
  });

  it("KEEP_TILBEHOR fact survives probability re-apply on pizza", () => {
    const dir = mkdtempSync(join(tmpdir(), "m77-"));
    dirs.push(dir);
    const store = new DecisionStore(join(dir, "dec.sqlite"));
    upsertVeroniTilbehorBusinessFact({
      store,
      restaurantKey: "veronipizza.dk",
    });
    const policy = distillProbabilityPolicy(peers());

    const fan = fanOutRestaurantAdditions({
      menu: pizzaMenu(),
      registry: store.facts,
      restaurantKey: "veronipizza.dk",
    });
    const stripped = applyProbabilityFilterToMenu({
      menu: fan.menu,
      policy,
      fanOutMenus: fan.fanOutMenus,
    });
    expect(stripped.traces[0]?.additionsAfter).toEqual([]);

    const dc = buildTilbehorOverrideDecisionCase({
      runId: "run1",
      restaurantKey: "veronipizza.dk",
      trace: stripped.traces[0]!,
    });
    store.upsertCase(dc);
    const registry = new DecisionPolicyRegistry(store);
    const recorded = registry.recordHumanDecision(dc, {
      decisionCaseId: dc.decisionCaseId,
      resolution: "KEEP_TILBEHOR",
      selectedOptionId: "keep_tilbehor",
      scopePreference: "APPLY_THIS_CASE_ONLY",
      operatorId: "op1",
    });
    const fact = applyTilbehorOverrideFromAnswer({
      store,
      decisionCase: dc,
      answer: {
        decisionCaseId: dc.decisionCaseId,
        resolution: "KEEP_TILBEHOR",
        selectedOptionId: "keep_tilbehor",
        scopePreference: "APPLY_THIS_CASE_ONLY",
        operatorId: "op1",
      },
      humanDecision: recorded.human,
    });
    expect(fact?.additions.map((a) => a.name)).toEqual(
      expect.arrayContaining(["Ketchup", "Remoulade", "Salatmayonnaise"]),
    );
    expect(
      menuNumbersWithKeepTilbehorOverride(store.facts, "veronipizza.dk").has(
        "3",
      ),
    ).toBe(true);

    const fan2 = fanOutRestaurantAdditions({
      menu: pizzaMenu(),
      registry: store.facts,
      restaurantKey: "veronipizza.dk",
    });
    const kept = applyProbabilityFilterToMenu({
      menu: fan2.menu,
      policy,
      fanOutMenus: fan2.fanOutMenus,
      keepTilbehorMenus: menuNumbersWithKeepTilbehorOverride(
        store.facts,
        "veronipizza.dk",
      ),
    });
    const p = kept.menu.categories[0]!.products[0]!;
    expect(p.addOns.map((a) => a.name)).toEqual(
      expect.arrayContaining(["Ketchup", "Remoulade", "Salatmayonnaise"]),
    );
    expect(kept.traces[0]?.reasonCodes).toContain("OPERATOR_KEEP_TILBEHOR");
    store.close();
  });
});
