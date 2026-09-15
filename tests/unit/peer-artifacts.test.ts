import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolvePeerObserveDir,
  writeLatestPeerObservePointer,
  peerStructureSummaryPath,
  peerProbabilityPolicyPath,
  loadProbabilityPolicy,
  writeProbabilityPolicyArtifact,
} from "../../src/learning/peerArtifacts.js";
import { distillProbabilityPolicy } from "../../src/learning/categoryLikelihood.js";
import type { PeerMenuSnapshot } from "../../src/learning/peerMenuStructure.js";
import { buildPolicyApplicationReport } from "../../src/learning/policyApplicationReport.js";

describe("peerArtifacts", () => {
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

  it("resolves latest peer observe pointer over discovery scan", () => {
    const root = mkdtempSync(join(tmpdir(), "peer-art-"));
    dirs.push(root);
    const outDir = join(root, "runs", "discovery", "m71-peer-observe-999");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, "peer-a.dk.json"),
      JSON.stringify({
        host: "a.dk",
        restaurantKey: "a.dk",
        observedAt: "2026-01-01T00:00:00.000Z",
        source: "fixture",
        products: [],
      } satisfies PeerMenuSnapshot),
    );
    writeLatestPeerObservePointer(root, {
      observedAt: "2026-01-01T00:00:00.000Z",
      outDir,
      structureFingerprint: "fp-test",
    });
    expect(resolvePeerObserveDir(root)).toBe(outDir);
    expect(peerStructureSummaryPath(root)).toContain("peer-structure-summary.json");
    expect(peerProbabilityPolicyPath(root)).toContain(
      "peer-probability-policy.json",
    );
  });

  it("loads probability policy from stable artifact path", () => {
    const root = mkdtempSync(join(tmpdir(), "peer-prob-"));
    dirs.push(root);
    const policy = distillProbabilityPolicy([
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
            name: "Pommes stor",
            variants: [],
            additions: [{ name: "Remoulade", priceOre: 1000 }],
          },
        ],
      },
    ]);
    writeProbabilityPolicyArtifact(root, policy);
    const loaded = loadProbabilityPolicy(root);
    expect(loaded?.fingerprint).toBe(policy.fingerprint);
  });
});

describe("portal policy application payload", () => {
  it("builds a report portal can render (structure + probability + facts)", () => {
    const report = buildPolicyApplicationReport({
      runId: "portal-job-1",
      restaurantKey: "veronipizza.dk",
      host: "veronipizza.dk",
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
        fingerprint: "struct-fp",
        evidence: {
          typeVariantProducts: 0,
          sizeVariantProducts: 0,
          sharedAdditionSets: [],
        },
      },
      probabilityPolicy: distillProbabilityPolicy([
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
              additions: [{ name: "Ketchup", priceOre: 1000 }],
            },
          ],
        },
      ]),
      productTraces: [
        {
          menuNumber: "50",
          sourceId: "p50",
          name: "Club Sandwich",
          categoryName: "Sandwich",
          kind: "sandwich_grill",
          reasonCodes: ["DIP_DENY_KIND", "FANOUT_TILBEHOR"],
          additionsBefore: ["Ketchup"],
          additionsAfter: [],
          removed: [{ name: "Ketchup", reason: "DIP_DENY_KIND" }],
          fanOutTilbehor: true,
          structureNotes: [],
        },
      ],
      businessFacts: [
        { name: "Veroni Tilbehør", detail: "mayo dips @ 10kr" },
      ],
    });
    expect(report.knowledge.structureSemanticRule?.knowledgeKind).toBe(
      "SEMANTIC_RULE",
    );
    expect(report.knowledge.restaurantBusinessFacts[0]?.knowledgeKind).toBe(
      "BUSINESS_FACT",
    );
    expect(report.summary.withRemovals).toBe(1);
  });
});
