/**
 * M6.1 — Compare frozen vs live review packs + readiness facts (read-only).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  loadVeroniUnresolvedDecisionCases,
  assertRecommendationsAreNotApprovals,
} from "../src/decisions/veroniFixture.js";
import { DecisionStore } from "../src/decisions/store.js";
import { DecisionEngine, DecisionPolicyRegistry } from "../src/decisions/engine.js";
import { FakeDecisionReasoner } from "../src/decisions/precedents.js";

const OUT = resolve("runs/m61-veroni-live");
const FROZEN = resolve("fixtures/veroni/m6-human-review-final.json");
const LIVE = resolve("runs/m5h-veroni/human-review-final.json");
const DEST = resolve("runs/m5h-veroni/destination-snapshot.json");
const MAP = resolve("runs/m5h-veroni/category-mapping.json");
const SRC = resolve("runs/m5h-veroni/source-menu.json");
const AUTH_REPORT = resolve("runs/m61-veroni-live/auth-refresh.json");
const M5H = resolve("runs/m5h-veroni/m5h-report.json");

type Dec = {
  id: string;
  type: string;
  title: string;
  recommendedOptionId: string | null;
  affectedProducts: Array<{ menuNumber: string; name: string }>;
  options: unknown[];
  currentInterpretation?: string;
};

function loadDecisions(path: string): Dec[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { decisions: Dec[] };
  return raw.decisions;
}

function fingerprint(d: Dec): string {
  return JSON.stringify({
    id: d.id,
    type: d.type,
    title: d.title,
    recommendedOptionId: d.recommendedOptionId,
    affected: d.affectedProducts.map((p) => `${p.menuNumber}:${p.name}`),
    optionIds: (d.options as Array<{ id: string }>).map((o) => o.id),
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const frozen = loadDecisions(FROZEN);
  const live = loadDecisions(LIVE);
  const dest = JSON.parse(readFileSync(DEST, "utf8")) as {
    categories: Array<{ databaseId: string; name: string }>;
    realProducts: unknown[];
    canaryProducts: unknown[];
    authenticated?: boolean;
  };
  const mapping = JSON.parse(readFileSync(MAP, "utf8")) as {
    categoryMappings: Array<{
      sourceCategoryName: string;
      status: string;
      destinationCategoryId?: string | null;
      destinationCategoryName?: string | null;
    }>;
    productLevelMappings: Array<{
      menuNumber: string;
      status: string;
      destinationCategoryId?: string | null;
      destinationCategoryName?: string | null;
      candidates?: Array<{ id: string; name: string }>;
    }>;
  };
  const source = JSON.parse(readFileSync(SRC, "utf8")) as {
    categories: Array<{
      products: Array<{
        sourceMenuNumber?: string;
        name: string;
        variants: Array<{ name: string; sourceTotalPrice?: number }>;
        sourcePriceOptions?: Array<{ name: string }>;
      }>;
    }>;
  };
  const auth = existsSync(AUTH_REPORT)
    ? JSON.parse(readFileSync(AUTH_REPORT, "utf8"))
    : null;
  const m5h = JSON.parse(readFileSync(M5H, "utf8"));

  const frozenIds = new Set(frozen.map((d) => d.id));
  const liveIds = new Set(live.map((d) => d.id));
  const added = live.filter((d) => !frozenIds.has(d.id)).map((d) => d.id);
  const removed = frozen.filter((d) => !liveIds.has(d.id)).map((d) => d.id);
  const changed: string[] = [];
  for (const f of frozen) {
    const l = live.find((x) => x.id === f.id);
    if (l && fingerprint(f) !== fingerprint(l)) changed.push(f.id);
  }

  const pasta = dest.categories.find((c) => /^pasta$/i.test(c.name.trim()));
  const cats36_38 = mapping.productLevelMappings.filter((m) =>
    ["36", "37", "38"].includes(m.menuNumber),
  );

  // Load live pack as UNRESOLVED cases — prove recommendations ≠ approvals
  const cases = loadVeroniUnresolvedDecisionCases({
    reviewPath: LIVE,
    runId: "m61-verify",
  });
  assertRecommendationsAreNotApprovals(cases);
  const dbPath = join(OUT, "decision-verify.sqlite");
  const store = new DecisionStore(dbPath);
  const registry = new DecisionPolicyRegistry(store);
  const engine = new DecisionEngine(store, registry, new FakeDecisionReasoner());
  for (const c of cases) {
    registry.registerCase(c);
    await engine.resolve(c);
  }
  const after = store.listCases({ runId: "m61-verify" });
  const activeFromRecs = store.listPolicies("ACTIVE");
  const humanDecisions = store.listHumanDecisions();
  store.close();

  const products = source.categories.flatMap((c) => c.products);
  const byNum = Object.fromEntries(
    products.map((p) => [p.sourceMenuNumber ?? "", p]),
  );
  const alm = products.filter((p) => {
    const names = p.variants.map((v) => v.name);
    return names.includes("Alm.") && names.includes("Familie");
  }).length;
  const baseMenu = products.filter((p) =>
    (p.sourcePriceOptions ?? p.variants).some((v) => /menu/i.test(v.name)),
  ).length;
  const lilleStor = products.filter((p) => {
    const names = p.variants.map((v) => v.name);
    return names.includes("Lille") && names.includes("Stor");
  });

  const report = {
    title: "M6.1 VERONI LIVE REVIEW READINESS REPORT",
    authRefreshed: auth?.authRefreshed === true ? "YES" : "NO",
    adminAuthenticated:
      auth?.adminAuthenticated === true && dest.categories.length > 0
        ? "YES"
        : "NO",
    authMethod: auth?.authMethod ?? null,
    liveCategoryCount: dest.categories.length,
    liveCategories: dest.categories.map((c) => ({
      id: c.databaseId,
      name: c.name,
    })),
    realDestinationProductCount: dest.realProducts.length,
    canaryCount: dest.canaryProducts.length,
    freshHumanReviewDecisionCount: live.length,
    frozenHumanReviewDecisionCount: frozen.length,
    decisionDifferences: { added, removed, changed },
    pastaDestinationExists: pasta ? "YES" : "NO",
    pastaCategory: pasta ?? null,
    product36_38Mappings: cats36_38,
    categoryMappingsMissing: mapping.categoryMappings.filter(
      (m) =>
        m.status === "MISSING_DESTINATION_CATEGORY" ||
        /missing|unmapped|create/i.test(m.status),
    ),
    sourceInvariants: {
      uniqueProducts: products.length,
      almFamilie: alm,
      baseMenu,
      lilleStor: lilleStor.map((p) => p.sourceMenuNumber),
      product65: {
        name: byNum["65"]?.name,
        priceOre: byNum["65"]?.variants[0]?.sourceTotalPrice,
      },
      product66: {
        name: byNum["66"]?.name,
        priceOre: byNum["66"]?.variants[0]?.sourceTotalPrice,
      },
      golden: m5h.golden,
    },
    decisionApprovalStatus: after.map((c) => ({
      decisionCaseId: c.decisionCaseId,
      sourceId: c.sourceId,
      status: c.status,
      isSystemRecommendationOnly: c.isSystemRecommendationOnly,
      recommendedOptionId: c.recommendedOptionId,
      humanApproved: false,
      humanDecisionId: null,
      resolutionMethod: c.resolutionMethod,
    })),
    VERONI_HUMAN_APPROVED_DECISIONS: humanDecisions.length,
    ACTIVE_POLICIES_FROM_VERONI_RECOMMENDATIONS: activeFromRecs.length,
    m5hReadyFlag: m5h.READY_FOR_HUMAN_DECISIONS,
    note: "Frozen pack entries are accepted REVIEW CASES / fixtures only — not human resolutions.",
  };

  writeFileSync(join(OUT, "m61-readiness.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
