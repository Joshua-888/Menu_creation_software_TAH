/**
 * M76 — Close the learning loop:
 *   [optional --observe] → distill structure + probability → dry-run with policies
 *   → Policy Application Report → optional gated --apply
 *
 * Default: no live writes.
 *
 *   npm run m76:pipeline
 *   npm run m76:pipeline -- --observe
 *   npm run m76:pipeline -- --apply
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DecisionStore } from "../src/decisions/store.js";
import {
  distillStructurePatterns,
  type PeerMenuSnapshot,
  type StructurePatternSummary,
} from "../src/learning/peerMenuStructure.js";
import {
  distillProbabilityPolicy,
} from "../src/learning/categoryLikelihood.js";
import { distillAdditionLikelihood } from "../src/learning/additionLikelihood.js";
import {
  defaultStructurePattern,
  loadActiveStructurePattern,
  upsertStructureSemanticPolicy,
  upsertVeroniTilbehorBusinessFact,
} from "../src/learning/structurePolicy.js";
import {
  loadPeerSnapshots,
  resolvePeerObserveDir,
  writeLatestPeerObservePointer,
  writeProbabilityPolicyArtifact,
  writeAdditionLikelihoodArtifact,
  peerProbabilityPolicyPath,
  readLatestPeerObservePointer,
} from "../src/learning/peerArtifacts.js";
import { buildAndWritePolicyApplicationReport } from "../src/learning/policyApplicationReport.js";
import {
  applyProbabilityFilterToMenu,
  fanOutRestaurantAdditions,
  type ProductPolicyTrace,
} from "../src/planning/structureMapping.js";
import {
  assertStructureWriteConfirmed,
  isStructureWriteConfirmed,
} from "../src/portal/structureWriteGate.js";
import { VERONI_CANARY_TARGET } from "../src/tah/write/types.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs", "discovery", `m76-pipeline-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const CONFIRM_PATH = join(
  root,
  "runs",
  "decisions",
  "structure-write-confirm.json",
);

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(join(root, ".env"));

function loadFixturePeers(): PeerMenuSnapshot[] {
  const path = join(root, "fixtures", "peer-menus", "best-customers.json");
  return JSON.parse(readFileSync(path, "utf8")) as PeerMenuSnapshot[];
}

function loadCanonical(): CanonicalMenu | null {
  const candidates = [
    join(root, "runs", "m66-veroni-validation-cleanup", "canonical-menu.json"),
    join(root, "fixtures", "veroni", "golden-source.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      if (raw?.categories) return raw as CanonicalMenu;
      if (raw?.menu?.categories) return raw.menu as CanonicalMenu;
    } catch {
      /* try next */
    }
  }
  return null;
}

function demoCanonical(): CanonicalMenu {
  return {
    categories: [
      {
        sourceId: "cat-finger",
        name: "Tilbehør",
        products: [
          {
            sourceId: "demo-48",
            name: "Pommes",
            sourceMenuNumber: "48",
            status: "READY",
            variants: [],
            ingredients: [],
            addOns: [],
          },
        ],
      },
      {
        sourceId: "cat-sandwich",
        name: "Sandwich",
        products: [
          {
            sourceId: "demo-50",
            name: "Club Sandwich",
            sourceMenuNumber: "50",
            status: "READY",
            variants: [],
            ingredients: [],
            addOns: [],
          },
          {
            sourceId: "demo-51",
            name: "Tun Sandwich",
            sourceMenuNumber: "51",
            status: "READY",
            variants: [],
            ingredients: [],
            addOns: [],
          },
        ],
      },
      {
        sourceId: "cat-pizza",
        name: "Pizza",
        products: [
          {
            sourceId: "demo-3",
            name: "Hawaii",
            sourceMenuNumber: "3",
            status: "READY",
            variants: [],
            ingredients: [],
            addOns: [],
          },
        ],
      },
      {
        sourceId: "cat-drinks",
        name: "Drikkevarer",
        products: [
          {
            sourceId: "demo-64",
            name: "Sodavand",
            sourceMenuNumber: "64",
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

async function main() {
  const wantObserve = process.argv.includes("--observe");
  const wantApply = process.argv.includes("--apply");
  const runId = `m76-${Date.now()}`;

  if (wantObserve) {
    console.log(JSON.stringify({ phase: "observe", via: "m71:peer-observe" }));
    const r = spawnSync(
      process.execPath,
      [
        join(root, "node_modules", "tsx", "dist", "cli.mjs"),
        join(root, "scripts", "m71-peer-menu-observe.ts"),
      ],
      { cwd: root, stdio: "inherit", env: process.env },
    );
    if (r.status !== 0) {
      throw new Error("peer observe failed");
    }
  }

  let snaps = loadPeerSnapshots(root);
  let peerDir = resolvePeerObserveDir(root);
  if (snaps.length === 0) {
    snaps = loadFixturePeers();
    peerDir = join(outDir, "fixture-peers");
    mkdirSync(peerDir, { recursive: true });
    for (const s of snaps) {
      writeFileSync(
        join(peerDir, `peer-${s.host}.json`),
        JSON.stringify(s, null, 2),
      );
    }
    writeLatestPeerObservePointer(root, {
      observedAt: new Date().toISOString(),
      outDir: peerDir,
      mode: "fixture",
      hosts: snaps.map((s) => s.host),
    });
  }

  const structureSummary: StructurePatternSummary =
    snaps.length > 0
      ? distillStructurePatterns(snaps)
      : defaultStructurePattern();

  const storePath = join(root, "runs", "decisions", "peer-structure.sqlite");
  mkdirSync(dirname(storePath), { recursive: true });
  const store = new DecisionStore(storePath);
  const structurePolicy = upsertStructureSemanticPolicy({
    store,
    summary: structureSummary,
  });
  upsertVeroniTilbehorBusinessFact({
    store,
    restaurantKey: VERONI_CANARY_TARGET.host,
  });

  const probabilityPolicy = distillProbabilityPolicy(snaps);
  writeProbabilityPolicyArtifact(root, probabilityPolicy);

  const additionLikelihood = distillAdditionLikelihood(snaps);
  writeAdditionLikelihoodArtifact(root, additionLikelihood);

  const mergedFingerprint = `${structureSummary.fingerprint}::${probabilityPolicy.fingerprint}`;
  const summaryForGate: StructurePatternSummary = {
    ...structureSummary,
    fingerprint: mergedFingerprint,
  };
  writeFileSync(
    join(root, "runs", "decisions", "peer-structure-summary.json"),
    JSON.stringify(
      {
        ...summaryForGate,
        probabilityPolicy: {
          fingerprint: probabilityPolicy.fingerprint,
          dipAllowKinds: probabilityPolicy.policy.dipAllowKinds,
          dipDenyKinds: probabilityPolicy.policy.dipDenyKinds,
        },
      },
      null,
      2,
    ),
  );
  upsertStructureSemanticPolicy({ store, summary: summaryForGate });

  writeLatestPeerObservePointer(root, {
    ...(readLatestPeerObservePointer(root) ?? {
      observedAt: new Date().toISOString(),
      outDir: peerDir ?? outDir,
    }),
    structureFingerprint: mergedFingerprint,
    policyId: structurePolicy.policyId,
    storePath,
    hosts: structureSummary.hosts,
  });

  let canonical = loadCanonical() ?? demoCanonical();
  const fan = fanOutRestaurantAdditions({
    menu: canonical,
    registry: store.facts,
    restaurantKey: VERONI_CANARY_TARGET.host,
  });
  const filtered = applyProbabilityFilterToMenu({
    menu: fan.menu,
    policy: probabilityPolicy,
    fanOutMenus: fan.fanOutMenus,
  });
  const productTraces: ProductPolicyTrace[] = filtered.traces;

  const pattern =
    loadActiveStructurePattern(store) ?? summaryForGate;

  const { report, jsonPath, mdPath } = buildAndWritePolicyApplicationReport(
    root,
    {
      runId,
      restaurantKey: VERONI_CANARY_TARGET.host,
      host: VERONI_CANARY_TARGET.host,
      structurePattern: pattern,
      probabilityPolicy,
      productTraces,
      businessFacts: [
        {
          name: "Veroni Tilbehør",
          detail:
            "Salatmayonnaise, Remoulade, Ketchup @ 10 kr — RESTAURANT BUSINESS_FACT (not peer-copied)",
        },
      ],
      probabilityPolicyPath: peerProbabilityPolicyPath(root),
      structureSummaryPath: join(
        root,
        "runs",
        "decisions",
        "peer-structure-summary.json",
      ),
    },
  );

  writeFileSync(join(outDir, "policy-application.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(outDir, "policy-application.md"),
    readFileSync(mdPath, "utf8"),
  );
  writeFileSync(
    join(outDir, "dry-run-additions-sample.json"),
    JSON.stringify(
      productTraces
        .filter(
          (t) =>
            t.removed.length > 0 ||
            t.fanOutTilbehor ||
            /pommes|sandwich|soda|hawaii/i.test(t.name),
        )
        .slice(0, 40),
      null,
      2,
    ),
  );

  const gate = isStructureWriteConfirmed({
    restaurantKey: VERONI_CANARY_TARGET.host,
    fingerprint: pattern.fingerprint,
    confirmFilePath: CONFIRM_PATH,
  });

  let applyResult: Record<string, unknown> | null = null;
  if (wantApply) {
    try {
      assertStructureWriteConfirmed({
        restaurantKey: VERONI_CANARY_TARGET.host,
        fingerprint: pattern.fingerprint,
        confirmFilePath: CONFIRM_PATH,
      });
      console.log(
        JSON.stringify({
          phase: "apply",
          via: "m74:prob-reconcile",
          note: "structure confirm OK — running probability reconcile",
        }),
      );
      const r = spawnSync(
        "npm",
        ["run", "m74:prob-reconcile"],
        { cwd: root, stdio: "inherit", shell: true, env: process.env },
      );
      applyResult = {
        status: r.status === 0 ? "APPLIED" : "APPLY_FAILED",
        exitCode: r.status,
      };
    } catch (err) {
      applyResult = {
        status: "BLOCKED",
        reason: err instanceof Error ? err.message : String(err),
        howToConfirm:
          "npx tsx scripts/m71-veroni-structure-dryrun.ts --write-confirm-only",
        confirmPath: CONFIRM_PATH,
        fingerprint: pattern.fingerprint,
      };
    }
  }

  const summary = {
    milestone: "M76_LEARNING_PIPELINE",
    status: wantApply
      ? applyResult?.status === "APPLIED"
        ? "VERIFIED"
        : "DRY_RUN_WITH_APPLY_BLOCKED"
      : "DRY_RUN_READY",
    runId,
    peerDir,
    peers: snaps.length,
    structureFingerprint: pattern.fingerprint,
    probabilityFingerprint: probabilityPolicy.fingerprint,
    fanOutMenus: fan.appliedMenus.length,
    productsTraced: productTraces.length,
    productsWithRemovals: productTraces.filter((t) => t.removed.length).length,
    policyReportJson: jsonPath,
    policyReportMd: mdPath,
    liveWriteGate: gate,
    apply: applyResult,
    ownerAudit: "npm run m76:policy-report",
    outDir,
  };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(summary, null, 2));
  store.close();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
