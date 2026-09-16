/**
 * Fresh certification run with clean artifacts + status accounting.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { runRawSourceCertification } from "../src/certification/runRawCertification.js";
import { MENU_CONSTITUTION_VERSION } from "../src/intelligence/constitution.js";
import {
  assertStatusAccounting,
  explainNonReadyProducts,
} from "../src/intelligence/explainNonReady.js";

const fixture = process.argv[2] ?? "veroni";
const root = process.cwd();

function commitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const configs: Record<
  string,
  { restaurantName: string; restaurantKey: string; raw: string; kind: "pdf" | "image" }
> = {
  veroni: {
    restaurantName: "Veroni Fixture",
    restaurantKey: "fixture-veroni.example",
    raw: "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
    kind: "pdf",
  },
  smash: {
    restaurantName: "Smash Fixture",
    restaurantKey: "fixture-smash.example",
    raw: "fixtures/golden/smash/raw-source.jpg",
    kind: "image",
  },
  third: {
    restaurantName: "Fixture Thai House",
    restaurantKey: "fixture-thai.example",
    raw: "fixtures/golden/third-merchant/raw-source.pdf",
    kind: "pdf",
  },
};

if (fixture === "third") {
  // Ensure rich Thai PDF exists before certification
  await import("./build-third-merchant-pdf.mts");
}

const cfg = configs[fixture];
if (!cfg) {
  console.error("Usage: cert-fresh-run.mts veroni|smash|third");
  process.exit(1);
}

const sha = commitSha();
const startedAt = new Date().toISOString();
const runId = `cert_${fixture}_${startedAt.replace(/[:.]/g, "-")}`;
const outDir = join(root, "runs", "certification", runId);
mkdirSync(outDir, { recursive: true });

const meta = {
  runId,
  commitSha: sha,
  constitutionVersion: MENU_CONSTITUTION_VERSION,
  policySnapshotVersion: "MenuConstitutionV1",
  fixture,
  rawSource: cfg.raw,
  startedAt,
};
writeFileSync(join(outDir, "run-meta.json"), JSON.stringify(meta, null, 2));

const result = await runRawSourceCertification({
  restaurantName: cfg.restaurantName,
  restaurantKey: cfg.restaurantKey,
  rawFilePath: resolve(root, cfg.raw),
  kind: cfg.kind,
  repoRoot: root,
});

assertStatusAccounting(result.intelligence.quality);
const sa = result.intelligence.quality.statusAccounting;
const nonReady = explainNonReadyProducts(
  result.targetMenu,
  result.intelligence.quality,
);

const summary = {
  ...meta,
  finishedAt: new Date().toISOString(),
  pageCount: result.pageCount,
  uniqueProductsExtract: result.uniqueProducts,
  sourceProductCount: result.sourceProductCount,
  targetProductCount: result.stats.targetProducts,
  menuVariantCount: result.menuVariantCount,
  statusAccounting: sa,
  findingCounts: result.intelligence.quality.findingCounts,
  menuStatus: result.stats.menuStatus,
  writeEligible: result.intelligence.writeEligible,
  nonReadyCount: nonReady.length,
  nonReady,
};

writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(
  join(outDir, "target-menu.json"),
  JSON.stringify(result.targetMenu, null, 2),
);
writeFileSync(
  join(outDir, "quality-report.json"),
  JSON.stringify(result.intelligence.quality, null, 2),
);
writeFileSync(
  join(outDir, "non-ready-products.json"),
  JSON.stringify(nonReady, null, 2),
);
writeFileSync(
  join(outDir, "source-menu.json"),
  JSON.stringify(result.sourceMenu, null, 2),
);

console.log(
  JSON.stringify(
    {
      outDir,
      sourceProductCount: summary.sourceProductCount,
      targetProductCount: summary.targetProductCount,
      statusAccounting: sa,
      menuVariants: summary.menuVariantCount,
      menuStatus: summary.menuStatus,
      nonReadyCount: nonReady.length,
      sampleNonReady: nonReady.slice(0, 8),
    },
    null,
    2,
  ),
);
