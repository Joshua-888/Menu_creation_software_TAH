/**
 * Gated live execute path for portal jobs (Playwright + DestinationPort).
 * Only called when evaluatePortalLiveWriteGate().canLiveExecute is true.
 */
import { join } from "node:path";
import { chromium } from "playwright";
import type { CanonicalMenu } from "../domain/schema/canonical.js";
import {
  buildDryRunWritePlan,
  mapSourceCategoriesToDestination,
  type DryRunDestinationSnapshot,
} from "../planning/index.js";
import {
  createMigrationWritePlan,
  createTahPlaywrightDestinationPort,
  buildRecoveryPlan,
  executeMigrationPlan,
  type ExecuteResult,
  type MigrationWritePlan,
  type RecoveryPlan,
} from "../runner/index.js";
import { RunStore } from "../runs/sqliteStore.js";
import { M2B_ADAPTER_CAPABILITIES } from "../tah/contracts/evidence.js";
import { TahAdminAdapterV1 } from "../tah/adapters/v1/adapter.js";
import {
  isDestinationHostAllowlistedForLiveWrites,
  normalizeDestinationHost,
} from "./liveWrites.js";
import { assertStructureWriteConfirmed } from "./structureWriteGate.js";
import { existsSync, readFileSync } from "node:fs";
import type { StructurePatternSummary } from "../learning/peerMenuStructure.js";
import {
  loadProbabilityPolicyForRestaurant,
  peerStructureSummaryPath,
} from "../learning/peerArtifacts.js";
import type { IngredientLikelihoodPolicy } from "../learning/ingredientLikelihood.js";
import { resolvePortalDecisionDbPath } from "../learning/tilbehorOverride.js";
import { DecisionStore } from "../decisions/store.js";
import type { ProductPolicyTrace } from "../planning/index.js";
import { repoRoot } from "./paths.js";

function emptyDestinationSnapshot(host: string): DryRunDestinationSnapshot {
  return {
    host: normalizeDestinationHost(host),
    categories: [],
    products: [],
  };
}

/** Live catalog for dry-run: ON when admin credentials + allowlisted host.
 * Set PORTAL_DRYRUN_LIVE_DEST=0 to force empty/offline dry-run. */
export function shouldLoadLiveDestinationForDryRun(
  destinationHost: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    env.PORTAL_DRYRUN_LIVE_DEST === "0" ||
    env.PORTAL_DRYRUN_LIVE_DEST === "false"
  ) {
    return false;
  }
  if (!env.TAH_ADMIN_EMAIL?.trim() || !env.TAH_ADMIN_PASSWORD?.trim()) {
    return false;
  }
  return isDestinationHostAllowlistedForLiveWrites(destinationHost, env);
}

export async function loadDestinationSnapshotForDryRun(input: {
  destinationHost: string;
  env?: NodeJS.ProcessEnv;
  deep?: boolean;
}): Promise<{
  destination: DryRunDestinationSnapshot;
  source: "live" | "empty";
  error?: string;
}> {
  const env = input.env ?? process.env;
  const host = normalizeDestinationHost(input.destinationHost);
  const empty = emptyDestinationSnapshot(host);
  if (!shouldLoadLiveDestinationForDryRun(host, env)) {
    return { destination: empty, source: "empty" };
  }
  const baseUrl = `https://${host}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await adminLogin(page, baseUrl);
    const destination = await loadRealDestinationSnapshot({
      baseUrl,
      page,
      deep: input.deep === true,
    });
    return { destination, source: "live" };
  } catch (err) {
    return {
      destination: empty,
      source: "empty",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser.close();
  }
}

function loadStructureFingerprint(root = repoRoot()): {
  fingerprint: string;
  confirmPath: string;
} | null {
  const summaryPath = peerStructureSummaryPath(root);
  const confirmPath = join(root, "runs", "decisions", "structure-write-confirm.json");
  if (!existsSync(summaryPath)) return null;
  try {
    const summary = JSON.parse(
      readFileSync(summaryPath, "utf8"),
    ) as StructurePatternSummary;
    if (!summary.fingerprint) return null;
    return { fingerprint: summary.fingerprint, confirmPath };
  } catch {
    return null;
  }
}

async function adminLogin(
  page: import("playwright").Page,
  baseUrl: string,
): Promise<void> {
  const email = process.env.TAH_ADMIN_EMAIL;
  const password = process.env.TAH_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("live execute requires TAH_ADMIN_EMAIL and TAH_ADMIN_PASSWORD");
  }
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
}

export async function loadRealDestinationSnapshot(input: {
  baseUrl: string;
  page: import("playwright").Page;
  /** When true, readProduct each row for QA reconcile depth. */
  deep?: boolean;
}): Promise<DryRunDestinationSnapshot> {
  const adapter = new TahAdminAdapterV1({
    page: input.page,
    baseUrl: input.baseUrl,
    expectedHost: normalizeDestinationHost(input.baseUrl),
  });
  const categories = await adapter.listCategories();
  const products = await adapter.listProducts();
  const mapped = [];
  for (const p of products) {
    if (!p.databaseId) continue;
    if (!input.deep) {
      mapped.push({
        databaseId: p.databaseId,
        menuNumber: p.menuNumber ?? "",
        name: p.name,
        categoryIds: [] as string[],
        listStatus: (p.statusText || "").trim(),
      });
      continue;
    }
    try {
      const full = await adapter.readProduct(p.databaseId);
      mapped.push({
        databaseId: p.databaseId,
        menuNumber: full.menuNumber ?? p.menuNumber ?? "",
        name: full.name ?? p.name,
        categoryIds: full.categoryIds ?? [],
        listStatus: (p.statusText || "").trim(),
        description: full.description ?? "",
        basePriceOre: full.basePriceOre ?? 0,
        variants: full.variants.map((v) => ({
          name: v.name,
          priceOre: v.priceOre ?? 0,
        })),
        ingredients: full.ingredients.map((i) => i.name),
        additions: full.additions.map((a) => ({
          name: a.name,
          priceOre: a.priceOre ?? 0,
        })),
      });
    } catch {
      mapped.push({
        databaseId: p.databaseId,
        menuNumber: p.menuNumber ?? "",
        name: p.name,
        categoryIds: [] as string[],
        listStatus: (p.statusText || "").trim(),
      });
    }
  }
  return {
    host: normalizeDestinationHost(input.baseUrl),
    categories: categories.map((c) => ({
      databaseId: c.databaseId,
      name: c.name,
    })),
    products: mapped,
  };
}

export async function executePortalLiveWrites(input: {
  runId: string;
  restaurant: string;
  destinationHost: string;
  source: string;
  schemaVersion: string;
  domainRuleVersion: string;
  adapterVersion: string;
  contractFingerprint: string;
  canonical: CanonicalMenu;
  runsDbPath: string;
  /** QA_RECONCILE enables UPDATE ops + deep snapshot. */
  workflow?: "CREATE_MENU" | "QA_RECONCILE";
  /** Must match dry-run intelligence path — no divergent live replan. */
  ingredientLikelihood?: IngredientLikelihoodPolicy | null;
}): Promise<{
  livePlan: MigrationWritePlan;
  result: ExecuteResult;
  destination: DryRunDestinationSnapshot;
  recoveryPlan: RecoveryPlan;
}> {
  const host = normalizeDestinationHost(input.destinationHost);
  const baseUrl = `https://${host}`;
  const root = repoRoot();
  const isQa = input.workflow === "QA_RECONCILE";

  // Peer structure confirm is optional for multi-merchant create path.
  // Set STRUCTURE_WRITE_REQUIRED=1 to enforce fingerprint confirm before live writes.
  const structure = loadStructureFingerprint(root);
  const requireStructure =
    process.env.STRUCTURE_WRITE_REQUIRED === "1" ||
    process.env.STRUCTURE_WRITE_REQUIRED === "true";
  if (structure && requireStructure) {
    assertStructureWriteConfirmed({
      restaurantKey: host,
      fingerprint: structure.fingerprint,
      confirmFilePath: structure.confirmPath,
    });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await adminLogin(page, baseUrl);
    const destination = await loadRealDestinationSnapshot({
      baseUrl,
      page,
      deep: isQa,
    });
    const categoryMappings = mapSourceCategoriesToDestination(
      input.canonical.categories.map((c) => ({
        sourceId: c.sourceId,
        name: c.name,
      })),
      destination.categories,
    );
    const policyTraces: ProductPolicyTrace[] = [];
    const probabilityPolicy = loadProbabilityPolicyForRestaurant(
      root,
      input.restaurant,
    );
    const decisionDbPath = resolvePortalDecisionDbPath(root);
    const decisionStore = existsSync(decisionDbPath)
      ? new DecisionStore(decisionDbPath)
      : null;
    try {
      const dry = buildDryRunWritePlan({
        runId: input.runId,
        restaurant: input.restaurant,
        host,
        source: input.source,
        schemaVersion: input.schemaVersion,
        domainRuleVersion: input.domainRuleVersion,
        adapterVersion: input.adapterVersion,
        contractFingerprint: input.contractFingerprint,
        canonical: input.canonical,
        categoryMappings,
        destination,
        capabilities: M2B_ADAPTER_CAPABILITIES,
        ...(decisionStore ? { decisionStore } : {}),
        ...(probabilityPolicy ? { probabilityPolicy } : {}),
        ...(input.ingredientLikelihood
          ? { ingredientLikelihood: input.ingredientLikelihood }
          : {}),
        policyTraces,
        ...(isQa ? { emitReconcileUpdates: true } : {}),
      });
      // CREATE path: only CREATE ops. QA path: UPDATE (+ CREATE for missing).
      const ops = isQa
        ? dry.operations.filter(
            (o) => o.action === "UPDATE" || o.action === "CREATE",
          )
        : dry.operations.filter((o) => o.action === "CREATE");
      const livePlan = createMigrationWritePlan({
        runId: dry.runId,
        restaurant: dry.restaurant,
        host: dry.host,
        source: dry.source,
        schemaVersion: dry.schemaVersion,
        domainRuleVersion: dry.domainRuleVersion,
        adapterVersion: dry.adapterVersion,
        contractFingerprint: dry.contractFingerprint,
        dryRun: false,
        operations: ops.map((o) => ({ ...o })),
      });

      const store = new RunStore(input.runsDbPath);
      try {
        const destinationPort = createTahPlaywrightDestinationPort({
          page,
          baseUrl,
          expectedHost: host,
          restaurantKey: input.restaurant,
          ...(decisionStore ? { decisionStore } : {}),
        });
        const result = await executeMigrationPlan({
          plan: livePlan,
          store,
          destination: destinationPort,
          workflow: input.workflow ?? "CREATE_MENU",
          gate: {
            hostOk: true,
            contractMatch: true,
            host,
            expectedHost: host,
          },
        });
        const recoveryPlan = buildRecoveryPlan({
          plan: livePlan,
          operationRecords: store.listOperations(livePlan.runId),
          destinationSnapshot: destination,
        });
        return { livePlan, result, destination, recoveryPlan };
      } finally {
        store.close();
      }
    } finally {
      decisionStore?.close();
    }
  } finally {
    await browser.close();
  }
}

export function portalLiveRunsDbPath(dataDir: string): string {
  return join(dataDir, "live-runs.sqlite");
}
