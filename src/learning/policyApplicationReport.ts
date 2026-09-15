/**
 * Owner-facing Policy Application Report — what SEMANTIC_RULE / BUSINESS_FACT /
 * probability decisions shaped a menu plan.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { StructurePatternSummary } from "./peerMenuStructure.js";
import type { ProbabilityPolicyMap } from "./categoryLikelihood.js";
import type { IngredientLikelihoodPolicy } from "./ingredientLikelihood.js";
import type { ProductPolicyTrace } from "../planning/structureMapping.js";
import {
  decisionsDir,
  LATEST_POLICY_APPLICATION_FILENAME,
  readLatestPeerObservePointer,
  type LatestPeerObservePointer,
} from "./peerArtifacts.js";

export type PolicyApplicationReport = {
  runId: string;
  createdAt: string;
  restaurantKey: string;
  host?: string;
  knowledge: {
    structureSemanticRule: {
      knowledgeKind: "SEMANTIC_RULE";
      fingerprint: string;
      meatChoiceWithoutSize: string;
      meatChoiceWithSize: string;
      tilbehorScope: string;
      categoryVariantFanOut: {
        enabled: boolean;
        mode: string;
        fanOutKinds: string[];
        peerSizeCoverage: number;
      } | null;
      peerHosts: string[];
      restaurantsAnalyzed: number;
    } | null;
    probabilityPolicy: {
      knowledgeKind: "SEMANTIC_RULE";
      fingerprint: string;
      thresholds: ProbabilityPolicyMap["thresholds"];
      dipAllowKinds: string[];
      dipDenyKinds: string[];
      neverTilbehorKinds: string[];
      neverMeatAddKinds: string[];
      hardPriors: string[];
      rules: string[];
    } | null;
    ingredientLikelihood: {
      knowledgeKind: "SEMANTIC_RULE";
      fingerprint: string;
      restaurantsAnalyzed: number;
      subtypeBuckets: Array<{
        id: string;
        nProducts: number;
        allowCount: number;
        topAllow: string[];
      }>;
      rules: string[];
    } | null;
    restaurantBusinessFacts: Array<{
      knowledgeKind: "BUSINESS_FACT";
      name: string;
      detail: string;
    }>;
  };
  provenance: {
    peerObserve: LatestPeerObservePointer | null;
    probabilityPolicyPath?: string;
    structureSummaryPath?: string;
  };
  products: ProductPolicyTrace[];
  summary: {
    productCount: number;
    withRemovals: number;
    byKind: Record<string, number>;
    reasonCodeCounts: Record<string, number>;
  };
};

export function buildPolicyApplicationReport(input: {
  runId: string;
  restaurantKey: string;
  host?: string;
  structurePattern?: StructurePatternSummary | null;
  probabilityPolicy?: ProbabilityPolicyMap | null;
  ingredientLikelihood?: IngredientLikelihoodPolicy | null;
  productTraces: ProductPolicyTrace[];
  businessFacts?: Array<{ name: string; detail: string }>;
  peerObserve?: LatestPeerObservePointer | null;
  probabilityPolicyPath?: string;
  structureSummaryPath?: string;
}): PolicyApplicationReport {
  const byKind: Record<string, number> = {};
  const reasonCodeCounts: Record<string, number> = {};
  let withRemovals = 0;
  for (const t of input.productTraces) {
    byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
    if (t.removed.length) withRemovals += 1;
    for (const code of t.reasonCodes) {
      reasonCodeCounts[code] = (reasonCodeCounts[code] ?? 0) + 1;
    }
  }

  const structure = input.structurePattern ?? null;
  const prob = input.probabilityPolicy ?? null;
  const ing = input.ingredientLikelihood ?? null;

  return {
    runId: input.runId,
    createdAt: new Date().toISOString(),
    restaurantKey: input.restaurantKey,
    ...(input.host ? { host: input.host } : {}),
    knowledge: {
      structureSemanticRule: structure
        ? {
            knowledgeKind: "SEMANTIC_RULE",
            fingerprint: structure.fingerprint,
            meatChoiceWithoutSize: structure.meatChoiceWithoutSize,
            meatChoiceWithSize: structure.meatChoiceWithSize,
            tilbehorScope: structure.tilbehorScope,
            categoryVariantFanOut: structure.categoryVariantFanOut
              ? {
                  enabled: structure.categoryVariantFanOut.enabled,
                  mode: structure.categoryVariantFanOut.mode,
                  fanOutKinds: structure.categoryVariantFanOut.fanOutKinds,
                  peerSizeCoverage:
                    structure.categoryVariantFanOut.peerSizeCoverage,
                }
              : null,
            peerHosts: structure.hosts,
            restaurantsAnalyzed: structure.restaurantsAnalyzed,
          }
        : null,
      probabilityPolicy: prob
        ? {
            knowledgeKind: "SEMANTIC_RULE",
            fingerprint: prob.fingerprint,
            thresholds: prob.thresholds,
            dipAllowKinds: prob.policy.dipAllowKinds,
            dipDenyKinds: prob.policy.dipDenyKinds,
            neverTilbehorKinds: prob.policy.neverTilbehorKinds,
            neverMeatAddKinds: prob.policy.neverMeatAddKinds,
            hardPriors: [
              "Drinks never receive Tilbehør",
              "Vegetarian never receives meat additions",
              "Sandwich/burger dips only when menu-with-fries",
            ],
            rules: prob.rules,
          }
        : null,
      ingredientLikelihood: ing
        ? {
            knowledgeKind: "SEMANTIC_RULE",
            fingerprint: ing.fingerprint,
            restaurantsAnalyzed: ing.restaurantsAnalyzed,
            subtypeBuckets: Object.entries(ing.bySubtype).map(
              ([id, bucket]) => ({
                id,
                nProducts: bucket!.nProducts,
                allowCount: bucket!.ingredients.filter(
                  (i) => i.decision === "ALLOW",
                ).length,
                topAllow: bucket!.ingredients
                  .filter((i) => i.decision === "ALLOW")
                  .slice(0, 6)
                  .map((i) => i.displayName),
              }),
            ),
            rules: ing.rules,
          }
        : null,
      restaurantBusinessFacts: (input.businessFacts ?? []).map((f) => ({
        knowledgeKind: "BUSINESS_FACT" as const,
        name: f.name,
        detail: f.detail,
      })),
    },
    provenance: {
      peerObserve: input.peerObserve ?? null,
      ...(input.probabilityPolicyPath
        ? { probabilityPolicyPath: input.probabilityPolicyPath }
        : {}),
      ...(input.structureSummaryPath
        ? { structureSummaryPath: input.structureSummaryPath }
        : {}),
    },
    products: input.productTraces,
    summary: {
      productCount: input.productTraces.length,
      withRemovals,
      byKind,
      reasonCodeCounts,
    },
  };
}

export function formatPolicyApplicationMarkdown(
  report: PolicyApplicationReport,
): string {
  const lines: string[] = [
    `# Policy application report`,
    ``,
    `- **Run:** ${report.runId}`,
    `- **Restaurant:** ${report.restaurantKey}${report.host ? ` (${report.host})` : ""}`,
    `- **Created:** ${report.createdAt}`,
    ``,
    `## SEMANTIC_RULE — menu structure`,
  ];
  const s = report.knowledge.structureSemanticRule;
  if (!s) {
    lines.push(`_None loaded (defaults may apply)._`, ``);
  } else {
    lines.push(
      `- Fingerprint: \`${s.fingerprint}\``,
      `- Meat choice without size → **${s.meatChoiceWithoutSize}**`,
      `- Meat choice with size → **${s.meatChoiceWithSize}**`,
      `- Tilbehør scope: **${s.tilbehorScope}**`,
      `- Peers (${s.restaurantsAnalyzed}): ${s.peerHosts.join(", ") || "(none)"}`,
      ``,
    );
    if (s.categoryVariantFanOut) {
      const cv = s.categoryVariantFanOut;
      lines.push(
        `### Category structural-variant fan-out`,
        `- Enabled: **${cv.enabled}** (mode: **${cv.mode}**)`,
        `- Kinds: ${cv.fanOutKinds.join(", ") || "(none)"}`,
        `- Peer size coverage: ${(cv.peerSizeCoverage * 100).toFixed(0)}%`,
        `- Eligible categories: pizza (+ pizza-named), burger, durum, pita, sandwich, indbagt`,
        `- Excluded: drinks, dip / diverse`,
        ``,
      );
    }
  }

  lines.push(`## SEMANTIC_RULE — category probability`);
  const p = report.knowledge.probabilityPolicy;
  if (!p) {
    lines.push(`_No probability policy loaded._`, ``);
  } else {
    lines.push(
      `- Fingerprint: \`${p.fingerprint}\``,
      `- Dip allow kinds: ${p.dipAllowKinds.join(", ") || "(none)"}`,
      `- Dip deny kinds: ${p.dipDenyKinds.join(", ") || "(none)"}`,
      `- Never Tilbehør: ${p.neverTilbehorKinds.join(", ")}`,
      `- Never meat add: ${p.neverMeatAddKinds.join(", ")}`,
      `- Hard priors:`,
      ...p.hardPriors.map((h) => `  - ${h}`),
      ``,
    );
  }

  lines.push(`## SEMANTIC_RULE — peer ingredient + beskrivelse`);
  const ing = report.knowledge.ingredientLikelihood;
  if (!ing) {
    lines.push(`_No ingredient likelihood loaded (domain prior may apply)._`, ``);
  } else {
    lines.push(
      `- Fingerprint: \`${ing.fingerprint}\``,
      `- Peers analyzed: ${ing.restaurantsAnalyzed}`,
      `- Precedence: PEER_SUBTYPE → PEER_KIND → DOMAIN_PRIOR`,
      ``,
    );
    for (const b of ing.subtypeBuckets) {
      lines.push(
        `- **${b.id}** n=${b.nProducts} ALLOW=${b.allowCount}: ${b.topAllow.join(", ") || "(none)"}`,
      );
    }
    lines.push(``);
  }

  lines.push(`## BUSINESS_FACT — restaurant`);
  if (!report.knowledge.restaurantBusinessFacts.length) {
    lines.push(`_None recorded for this run._`, ``);
  } else {
    for (const f of report.knowledge.restaurantBusinessFacts) {
      lines.push(`- **${f.name}:** ${f.detail}`);
    }
    lines.push(``);
  }

  lines.push(
    `## Summary`,
    `- Products traced: ${report.summary.productCount}`,
    `- Products with removals: ${report.summary.withRemovals}`,
    `- By kind: ${JSON.stringify(report.summary.byKind)}`,
    `- Reason codes: ${JSON.stringify(report.summary.reasonCodeCounts)}`,
    ``,
    `## Per-product decisions`,
  );

  const interesting = report.products.filter(
    (t) =>
      t.removed.length > 0 ||
      t.fanOutTilbehor ||
      t.reasonCodes.some((c) => c.startsWith("STRUCTURE_")),
  );
  const sample =
    interesting.length > 0 ? interesting.slice(0, 40) : report.products.slice(0, 20);
  for (const t of sample) {
    const menu = t.menuNumber ? `#${t.menuNumber}` : t.sourceId;
    lines.push(
      `- **${menu} ${t.name}** (${t.kind}): ${t.reasonCodes.join(", ") || "—"}`,
    );
    if (t.additionsBefore.length || t.additionsAfter.length) {
      lines.push(
        `  - additions: [${t.additionsBefore.join(", ")}] → [${t.additionsAfter.join(", ")}]`,
      );
    }
    for (const r of t.removed) {
      lines.push(`  - removed ${r.name} (${r.reason})`);
    }
  }
  if (report.products.length > sample.length) {
    lines.push(
      ``,
      `_… ${report.products.length - sample.length} more products in JSON._`,
    );
  }

  if (report.provenance.peerObserve?.outDir) {
    lines.push(
      ``,
      `## Provenance`,
      `- Peer observe: \`${report.provenance.peerObserve.outDir}\``,
      `- Structure fingerprint: \`${report.provenance.peerObserve.structureFingerprint ?? "?"}\``,
    );
  }

  return lines.join("\n");
}

export function writePolicyApplicationArtifacts(
  repoRoot: string,
  report: PolicyApplicationReport,
): { jsonPath: string; mdPath: string; latestPath: string } {
  const dir = join(decisionsDir(repoRoot), "policy-application");
  mkdirSync(dir, { recursive: true });
  const safeId = report.runId.replace(/[^\w.-]+/g, "_");
  const jsonPath = join(dir, `${safeId}.json`);
  const mdPath = join(dir, `${safeId}.md`);
  const latestPath = join(decisionsDir(repoRoot), LATEST_POLICY_APPLICATION_FILENAME);
  const md = formatPolicyApplicationMarkdown(report);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, md);
  writeFileSync(latestPath, JSON.stringify(report, null, 2));
  writeFileSync(
    join(decisionsDir(repoRoot), "latest-policy-application.md"),
    md,
  );
  return { jsonPath, mdPath, latestPath };
}

export function readLatestPolicyApplication(
  repoRoot: string,
): PolicyApplicationReport | null {
  const path = join(decisionsDir(repoRoot), LATEST_POLICY_APPLICATION_FILENAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PolicyApplicationReport;
  } catch {
    return null;
  }
}

/** Helper for pipeline: build report using latest peer pointer from disk. */
export function buildAndWritePolicyApplicationReport(
  repoRoot: string,
  input: Omit<
    Parameters<typeof buildPolicyApplicationReport>[0],
    "peerObserve"
  > & { peerObserve?: LatestPeerObservePointer | null },
): {
  report: PolicyApplicationReport;
  jsonPath: string;
  mdPath: string;
  latestPath: string;
} {
  const report = buildPolicyApplicationReport({
    ...input,
    peerObserve:
      input.peerObserve ?? readLatestPeerObservePointer(repoRoot),
  });
  const paths = writePolicyApplicationArtifacts(repoRoot, report);
  return { report, ...paths };
}
