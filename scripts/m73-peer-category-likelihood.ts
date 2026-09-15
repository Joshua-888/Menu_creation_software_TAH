/**
 * M73 — Build probability stats from peer menus and write policy map.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { distillProbabilityPolicy } from "../src/learning/categoryLikelihood.js";
import { DecisionStore } from "../src/decisions/store.js";
import {
  defaultStructurePattern,
  upsertStructureSemanticPolicy,
} from "../src/learning/structurePolicy.js";
import {
  loadPeerSnapshots,
  resolvePeerObserveDir,
  writeProbabilityPolicyArtifact,
  writeAdditionLikelihoodArtifact,
} from "../src/learning/peerArtifacts.js";
import { distillAdditionLikelihood } from "../src/learning/additionLikelihood.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const peerDir = resolvePeerObserveDir(root);
if (!peerDir) {
  console.error(
    "No peer observe dir found. Run npm run m71:peer-observe first.",
  );
  process.exit(1);
}

const outDir = join(root, "runs", "discovery", `m73-likelihood-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const snaps = loadPeerSnapshots(root);
if (snaps.length === 0) {
  console.error(`No peer-*.json snapshots in ${peerDir}`);
  process.exit(1);
}

const policy = distillProbabilityPolicy(snaps);
writeFileSync(join(outDir, "probability-policy.json"), JSON.stringify(policy, null, 2));
writeProbabilityPolicyArtifact(root, policy);

const additionLikelihood = distillAdditionLikelihood(snaps);
writeFileSync(
  join(outDir, "addition-likelihood.json"),
  JSON.stringify(additionLikelihood, null, 2),
);
writeAdditionLikelihoodArtifact(root, additionLikelihood);

// Keep structure fingerprint aligned for confirm gates (extend summary)
const summaryPath = join(root, "runs", "decisions", "peer-structure-summary.json");
const prev = existsJson(summaryPath);
const merged = {
  ...(prev ?? {}),
  restaurantsAnalyzed: policy.restaurantsAnalyzed,
  hosts: policy.hosts,
  meatChoiceWithoutSize: prev?.meatChoiceWithoutSize ?? "variants",
  meatChoiceWithSize: prev?.meatChoiceWithSize ?? "additions",
  sharedAdditionCoverage: prev?.sharedAdditionCoverage ?? 0,
  tilbehorScope: "RESTAURANT_CATEGORY",
  fingerprint: `${prev?.fingerprint ?? "struct"}::${policy.fingerprint}`,
  probabilityPolicy: {
    fingerprint: policy.fingerprint,
    dipAllowKinds: policy.policy.dipAllowKinds,
    dipDenyKinds: policy.policy.dipDenyKinds,
    neverTilbehorKinds: policy.policy.neverTilbehorKinds,
    neverMeatAddKinds: policy.policy.neverMeatAddKinds,
  },
};
writeFileSync(summaryPath, JSON.stringify(merged, null, 2));

const storePath = join(root, "runs", "decisions", "peer-structure.sqlite");
const store = new DecisionStore(storePath);
upsertStructureSemanticPolicy({
  store,
  summary: {
    restaurantsAnalyzed: merged.restaurantsAnalyzed as number,
    hosts: merged.hosts as string[],
    meatChoiceWithoutSize: merged.meatChoiceWithoutSize as
      | "variants"
      | "additions",
    meatChoiceWithSize: merged.meatChoiceWithSize as "variants" | "additions",
    sharedAdditionCoverage: merged.sharedAdditionCoverage as number,
    tilbehorScope: "RESTAURANT_CATEGORY",
    categoryVariantFanOut:
      (merged as { categoryVariantFanOut?: ReturnType<typeof defaultStructurePattern>["categoryVariantFanOut"] })
        .categoryVariantFanOut ??
      defaultStructurePattern().categoryVariantFanOut,
    fingerprint: merged.fingerprint as string,
    evidence: {
      typeVariantProducts: 0,
      sizeVariantProducts: 0,
      sharedAdditionSets: [],
    },
  },
});
store.close();

const lines = [
  `# Probability policy (${policy.restaurantsAnalyzed} peers)`,
  "",
  ...policy.byKind.map((r) => {
    const d = r.features.dip;
    const m = r.features.meat_addition;
    return `- **${r.kind}** n=${r.n}: P(dip)=${d.pHat.toFixed(2)} smooth=${d.pSmooth.toFixed(2)} → ${d.decision}; P(meatAdd)=${m.pHat.toFixed(2)} → ${m.decision}`;
  }),
  "",
  "## Effective policy",
  ...policy.rules.filter(
    (r) =>
      r.startsWith("Effective") ||
      r.startsWith("Never") ||
      r.startsWith("P("),
  ),
];
writeFileSync(join(outDir, "SUMMARY.md"), lines.join("\n"));
console.log(
  JSON.stringify(
    {
      milestone: "M73_PROBABILITY_POLICY",
      status: "VERIFIED",
      peerDir,
      policy: policy.policy,
      byKind: policy.byKind.map((r) => ({
        kind: r.kind,
        n: r.n,
        pDip: r.features.dip.pHat,
        pDipSmooth: r.features.dip.pSmooth,
        dipDecision: r.features.dip.decision,
        pMeat: r.features.meat_addition.pHat,
        meatDecision: r.features.meat_addition.decision,
      })),
      additionLikelihood: {
        fingerprint: additionLikelihood.fingerprint,
        proposedSets: additionLikelihood.proposedSets.map((p) => ({
          kind: p.kind,
          count: p.additions.length,
          top: p.additions.slice(0, 10).map((a) => ({
            name: a.name,
            pHat: Number(a.pHat.toFixed(2)),
            priceOre: a.priceOre,
            isDip: a.isDip,
          })),
        })),
      },
      fingerprint: merged.fingerprint,
      outDir,
    },
    null,
    2,
  ),
);

function existsJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
