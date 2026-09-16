import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyProductKind,
  distillProbabilityPolicy,
  filterAdditionsWithTrace,
} from "../../src/learning/categoryLikelihood.js";
import {
  buildPolicyApplicationReport,
  formatPolicyApplicationMarkdown,
} from "../../src/learning/policyApplicationReport.js";
import { upsertVeroniTilbehorBusinessFact } from "../../src/learning/structurePolicy.js";
import { applyApprovedFactsToMenu } from "../../src/intelligence/applyApprovedFacts.js";
import { DecisionStore } from "../../src/decisions/store.js";
import type { PeerMenuSnapshot } from "../../src/learning/peerMenuStructure.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";

function snap(
  host: string,
  products: Array<{ name: string; additions: string[] }>,
): PeerMenuSnapshot {
  return {
    host,
    restaurantKey: host,
    observedAt: "2026-01-01T00:00:00.000Z",
    source: "fixture",
    products: products.map((p, i) => ({
      menuNumber: String(i + 1),
      name: p.name,
      variants: [{ name: "Alm.", priceOre: 0 }],
      additions: p.additions.map((name) => ({ name, priceOre: 1000 })),
    })),
  };
}

function miniMenu(): CanonicalMenu {
  return {
    categories: [
      {
        sourceId: "c1",
        name: "Sandwich",
        products: [
          {
            sourceId: "p50",
            name: "Club Sandwich",
            sourceMenuNumber: "50",
            status: "READY",
            variants: [],
            ingredients: [],
            addOns: [],
          },
          {
            sourceId: "p48",
            name: "Pommes",
            sourceMenuNumber: "48",
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

describe("policy application + probability in planning", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop()!;
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore windows file locks */
      }
    }
  });

  it("strips dips from sandwich after fan-out; keeps dips on pommes", () => {
    const dir = mkdtempSync(join(tmpdir(), "policy-app-"));
    dirs.push(dir);
    const store = new DecisionStore(join(dir, "decisions.sqlite"));
    const prevSeed = process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
    process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = "veronipizza.dk";
    try {
      upsertVeroniTilbehorBusinessFact({
        store,
        restaurantKey: "veronipizza.dk",
      });

      const peers = [
        snap("a.dk", [
          { name: "Pommes frites", additions: ["Ketchup"] },
          { name: "Nuggets", additions: ["Ketchup"] },
          { name: "Pommes stor", additions: ["Remoulade"] },
          { name: "Club Sandwich", additions: ["Ketchup"] },
          { name: "Pizza Vesuvio", additions: [] },
          { name: "Pizza Hawaii", additions: [] },
          { name: "Pizza Pepperoni", additions: [] },
        ]),
      ];
      const policy = distillProbabilityPolicy(peers);

      // Fan-out + probability live under applyApprovedFactsToMenu (not dryRun).
      const applied = applyApprovedFactsToMenu({
        menu: miniMenu(),
        restaurantKey: "veronipizza.dk",
        decisionStore: store,
        probabilityPolicy: policy,
      });
      expect(applied.fanOutMenus).toContain("50");
      expect(applied.fanOutMenus).toContain("48");

      const sandwich = applied.policyTraces.find((t) => t.menuNumber === "50")!;
      const pommes = applied.policyTraces.find((t) => t.menuNumber === "48")!;
      expect(sandwich.kind).toBe("sandwich_grill");
      expect(sandwich.additionsAfter).toEqual([]);
      expect(sandwich.reasonCodes).toContain("DIP_DENY_KIND");
      expect(pommes.kind).toBe("finger_food");
      expect(pommes.additionsAfter.length).toBeGreaterThan(0);
      expect(pommes.reasonCodes).toContain("FANOUT_TILBEHOR");

      const report = buildPolicyApplicationReport({
        runId: "test-run",
        restaurantKey: "veronipizza.dk",
        structurePattern: {
          restaurantsAnalyzed: 1,
          hosts: ["a.dk"],
          meatChoiceWithoutSize: "variants",
          meatChoiceWithSize: "additions",
          sharedAdditionCoverage: 0,
          tilbehorScope: "RESTAURANT",
          categoryVariantFanOut: {
            enabled: true,
            mode: "SOURCE_CATEGORY",
            peerSizeCoverage: 0,
            peerEnableMinCoverage: 0.35,
            fanOutKinds: [
              "alm",
              "familie",
              "deep",
              "glutenfri",
              "fuldkorn",
              "hjemmelavet",
            ],
          },
          fingerprint: "test-struct",
          evidence: {
            typeVariantProducts: 0,
            sizeVariantProducts: 0,
            sharedAdditionSets: [],
          },
        },
        probabilityPolicy: policy,
        productTraces: applied.policyTraces,
        businessFacts: [
          { name: "Veroni Tilbehør", detail: "mayo dips @ 10kr" },
        ],
      });

      expect(report.knowledge.structureSemanticRule?.knowledgeKind).toBe(
        "SEMANTIC_RULE",
      );
      expect(report.knowledge.probabilityPolicy?.fingerprint).toBeTruthy();
      expect(report.knowledge.restaurantBusinessFacts[0]?.knowledgeKind).toBe(
        "BUSINESS_FACT",
      );
      const md = formatPolicyApplicationMarkdown(report);
      expect(md).toContain("SEMANTIC_RULE");
      expect(md).toContain("BUSINESS_FACT");
      expect(md).toContain("Club Sandwich");
    } finally {
      if (prevSeed === undefined) delete process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
      else process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = prevSeed;
      store.close();
    }
  });

  it("filterAdditionsWithTrace records DIP_DENY_KIND", () => {
    const policy = distillProbabilityPolicy([
      snap("a.dk", [
        { name: "Pommes", additions: ["Ketchup"] },
        { name: "Nuggets", additions: ["Ketchup"] },
        { name: "Pommes 2", additions: ["Ketchup"] },
      ]),
    ]);
    expect(classifyProductKind({ name: "Club Sandwich" })).toBe(
      "sandwich_grill",
    );
    const trace = filterAdditionsWithTrace({
      name: "Club Sandwich",
      additions: [{ name: "Ketchup", priceOre: 1000 }],
      policy,
    });
    expect(trace.removed[0]?.reason).toBe("DIP_DENY_KIND");
  });
});
