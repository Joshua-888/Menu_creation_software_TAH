/**
 * M71b — Distill peer structure + seed Veroni Tilbehør BUSINESS_FACT + dry-run
 * writeplan with choice→variant/addition mapping. Live apply requires confirm.
 *
 *   npx tsx scripts/m71-veroni-structure-dryrun.ts
 *   STRUCTURE_WRITE_CONFIRMED=1 npx tsx scripts/m71-veroni-structure-dryrun.ts --write-confirm-only
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DecisionStore } from "../src/decisions/store.js";
import {
  distillStructurePatterns,
  type PeerMenuSnapshot,
} from "../src/learning/peerMenuStructure.js";
import {
  defaultStructurePattern,
  upsertStructureSemanticPolicy,
  upsertVeroniTilbehorBusinessFact,
  loadActiveStructurePattern,
} from "../src/learning/structurePolicy.js";
import { fanOutRestaurantAdditions } from "../src/planning/structureMapping.js";
import { mapProductChoicesToWriteFields } from "../src/planning/structureMapping.js";
import {
  assertStructureWriteConfirmed,
  isStructureWriteConfirmed,
  type StructureWriteConfirm,
} from "../src/portal/structureWriteGate.js";
import { VERONI_CANARY_TARGET } from "../src/tah/write/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs", "discovery", `m71-veroni-structure-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const CONFIRM_PATH = join(
  root,
  "runs",
  "decisions",
  "structure-write-confirm.json",
);

function loadPeerSnaps(): PeerMenuSnapshot[] {
  const path = join(root, "fixtures", "peer-menus", "best-customers.json");
  return JSON.parse(readFileSync(path, "utf8")) as PeerMenuSnapshot[];
}

async function main() {
  const writeConfirmOnly = process.argv.includes("--write-confirm-only");
  const storePath = join(root, "runs", "decisions", "peer-structure.sqlite");
  mkdirSync(dirname(storePath), { recursive: true });
  const store = new DecisionStore(storePath);

  const snaps = loadPeerSnaps();
  // Merge any live observe summary if present
  const liveSummaryPath = join(
    root,
    "runs",
    "decisions",
    "peer-structure-summary.json",
  );
  let summary = existsSync(liveSummaryPath)
    ? (JSON.parse(readFileSync(liveSummaryPath, "utf8")) as ReturnType<
        typeof distillStructurePatterns
      >)
    : distillStructurePatterns(snaps);

  if (!summary.fingerprint || summary.fingerprint === "empty") {
    summary = distillStructurePatterns(snaps);
  }
  if (!summary.restaurantsAnalyzed) {
    summary = defaultStructurePattern();
  }

  upsertStructureSemanticPolicy({ store, summary });
  upsertVeroniTilbehorBusinessFact({
    store,
    restaurantKey: VERONI_CANARY_TARGET.host,
  });

  if (writeConfirmOnly) {
    const confirm: StructureWriteConfirm = {
      confirmed: true,
      restaurantKey: VERONI_CANARY_TARGET.host,
      fingerprint: summary.fingerprint,
      confirmedAt: new Date().toISOString(),
      operatorId: "cli",
    };
    writeFileSync(CONFIRM_PATH, JSON.stringify(confirm, null, 2));
    console.log(
      JSON.stringify({
        milestone: "M71_STRUCTURE_CONFIRM",
        status: "WRITTEN",
        confirm: CONFIRM_PATH,
        fingerprint: summary.fingerprint,
      }),
    );
    store.close();
    return;
  }

  const canonPath = join(
    root,
    "runs",
    "m66-veroni-validation-cleanup",
    "canonical-menu.json",
  );
  if (!existsSync(canonPath)) {
    throw new Error(`missing canonical menu at ${canonPath}`);
  }
  const canonical = JSON.parse(readFileSync(canonPath, "utf8"));

  const fan = fanOutRestaurantAdditions({
    menu: canonical,
    registry: store.facts,
    restaurantKey: VERONI_CANARY_TARGET.host,
  });

  const pattern =
    loadActiveStructurePattern(store) ?? summary ?? defaultStructurePattern();

  const sampleMapped: Array<Record<string, unknown>> = [];
  for (const cat of fan.menu.categories) {
    for (const p of cat.products) {
      if (!p.productChoices?.length && !(p.addOns?.length > 0)) continue;
      const mapped = mapProductChoicesToWriteFields(p, pattern);
      if (p.productChoices?.length || mapped.additions.length) {
        sampleMapped.push({
          menu: p.sourceMenuNumber ?? p.assignedMenuNumber,
          name: p.name,
          choices: (p.productChoices ?? []).map(
            (c: { prompt: string; options: Array<{ label: string }> }) => ({
              prompt: c.prompt,
              options: c.options.map((o) => o.label),
            }),
          ),
          variants: mapped.variants,
          additions: mapped.additions,
          notes: mapped.mappingNotes,
        });
      }
    }
  }

  const gate = isStructureWriteConfirmed({
    restaurantKey: VERONI_CANARY_TARGET.host,
    fingerprint: pattern.fingerprint,
    confirmFilePath: CONFIRM_PATH,
  });

  const report = {
    milestone: "M71_VERONI_STRUCTURE_DRYRUN",
    status: "DRY_RUN_READY",
    structurePattern: pattern,
    tilbehorFanOutCount: fan.appliedMenus.length,
    tilbehorFanOutMenus: fan.appliedMenus.slice(0, 40),
    fanNotes: fan.notes.slice(0, 20),
    choiceMappedSamples: sampleMapped.slice(0, 30),
    liveWriteGate: gate,
    confirmPath: CONFIRM_PATH,
    howToConfirm:
      "Review dry-run samples, then: npx tsx scripts/m71-veroni-structure-dryrun.ts --write-confirm-only",
    storePath,
  };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  // Demonstrate gate blocks until confirm
  if (!gate.ok) {
    try {
      assertStructureWriteConfirmed({
        restaurantKey: VERONI_CANARY_TARGET.host,
        fingerprint: pattern.fingerprint,
        confirmFilePath: CONFIRM_PATH,
      });
    } catch {
      /* expected */
    }
  }

  store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
