/**
 * Gated live execute path for portal jobs (Playwright + DestinationPort).
 * Only called when evaluatePortalLiveWriteGate().canLiveExecute is true.
 */
import { join } from "node:path";
import type { CanonicalMenu } from "../domain/schema/canonical.js";
import type { DryRunDestinationSnapshot } from "../planning/index.js";
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
import { TahAdminAdapterV1 } from "../tah/adapters/v1/adapter.js";
import {
  isDestinationHostAllowlistedForLiveWrites,
  normalizeDestinationHost,
} from "./liveWrites.js";
import { loginDiagnosticError, loginTahAdmin } from "./adminLogin.js";
import { assertStructureWriteConfirmed } from "./structureWriteGate.js";
import { existsSync, readFileSync } from "node:fs";
import type { StructurePatternSummary } from "../learning/peerMenuStructure.js";
import { peerStructureSummaryPath } from "../learning/peerArtifacts.js";
import { repoRoot } from "./paths.js";
import {
  assertApprovedPlanEqualsExecutedPlan,
  evaluatePreWriteGate,
  getWorkerBrowserRuntime,
  sha256Canonical,
  validateExecutionBundle,
  type ExecutionBundleV1,
} from "../runtime/index.js";
import type { DestinationSnapshotResult } from "../runtime/destinationSnapshot.js";
import { probeAdminContract } from "../tah/probe/contractProbe.js";
import {
  buildAdminContractFingerprint,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
} from "../tah/contracts/fingerprint.js";
import { resolveDeployCommitSha } from "./deployProvenance.js";
import type { Page } from "playwright";

const SNAPSHOT_TIMEOUT_MS = 240_000;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function launchJobPage(): Promise<{
  page: Page;
  close: () => Promise<void>;
}> {
  const runtime = getWorkerBrowserRuntime();
  const context = await runtime.newJobContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  return {
    page,
    close: async () => {
      await context.close().catch(() => undefined);
    },
  };
}

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
  source: "live" | "empty" | "failed";
  status: DestinationSnapshotResult["status"];
  error?: string;
  meta?: { pagesRead: number; complete: boolean; errors: string[] };
}> {
  const env = input.env ?? process.env;
  const host = normalizeDestinationHost(input.destinationHost);
  const empty = emptyDestinationSnapshot(host);
  if (!shouldLoadLiveDestinationForDryRun(host, env)) {
    return {
      destination: empty,
      source: "empty",
      status: "OFFLINE_EXPLICIT",
      error: "OFFLINE_EXPLICIT: live destination load not enabled",
    };
  }
  const baseUrl = `https://${host}`;
  let session: { page: Page; close: () => Promise<void> } | undefined;
  try {
    session = await launchJobPage();
    const page = session.page;
    return await withTimeout(
      (async () => {
        await adminLogin(page, baseUrl);
        const loaded = await loadRealDestinationSnapshot({
          baseUrl,
          page,
          deep: input.deep === true,
        });
        return {
          destination: loaded.snapshot,
          source: loaded.status === "LIVE_COMPLETE" ? ("live" as const) : ("failed" as const),
          status: loaded.status,
          ...(loaded.errors.length
            ? { error: loaded.errors.join("; ") }
            : {}),
          meta: {
            pagesRead: loaded.pagesRead,
            complete: loaded.complete,
            errors: loaded.errors,
          },
        };
      })(),
      SNAPSHOT_TIMEOUT_MS,
      "Create live destination snapshot",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = /BROWSER_RUNTIME_UNAVAILABLE|Executable doesn't exist/i.test(
      message,
    )
      ? "BROWSER_RUNTIME_UNAVAILABLE"
      : /timeout/i.test(message)
        ? "TIMEOUT"
        : /login/i.test(message)
          ? "LOGIN_FAILED"
          : "UNKNOWN";
    return {
      destination: empty,
      source: "failed",
      status: "FAILED",
      error: `${code}: ${message}`,
    };
  } finally {
    await session?.close().catch(() => undefined);
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

async function adminLogin(page: Page, baseUrl: string): Promise<void> {
  const email = process.env.TAH_ADMIN_EMAIL;
  const password = process.env.TAH_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("live execute requires TAH_ADMIN_EMAIL and TAH_ADMIN_PASSWORD");
  }
  const diag = await loginTahAdmin({ page, baseUrl, email, password });
  if (diag.classification === "LOGIN_OK") return;
  throw new Error(loginDiagnosticError(diag));
}

export async function loadRealDestinationSnapshot(input: {
  baseUrl: string;
  page: Page;
  /** When true, readProduct each row for QA reconcile depth. */
  deep?: boolean;
}): Promise<{
  snapshot: DryRunDestinationSnapshot;
  status: "LIVE_COMPLETE" | "LIVE_PARTIAL_WITH_ERRORS";
  pagesRead: number;
  complete: boolean;
  errors: string[];
}> {
  const adapter = new TahAdminAdapterV1({
    page: input.page,
    baseUrl: input.baseUrl,
    expectedHost: normalizeDestinationHost(input.baseUrl),
  });
  const categories = await adapter.listCategories();
  const listed = await adapter.listProductsDetailed();
  if (listed.truncated) {
    throw new Error(
      `SNAPSHOT_TRUNCATED pagesRead=${listed.pagesRead} productCount=${listed.products.length}`,
    );
  }
  const mapped = [];
  const errors: string[] = [];
  for (const p of listed.products) {
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
      const full = await adapter.readProduct(p.databaseId, { listRow: p });
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
    } catch (err) {
      errors.push(
        `readProduct ${p.databaseId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const snapshot = {
    host: normalizeDestinationHost(input.baseUrl),
    categories: categories.map((c) => ({
      databaseId: c.databaseId,
      name: c.name,
    })),
    products: mapped,
  };
  const complete = errors.length === 0;
  return {
    snapshot,
    status: complete ? "LIVE_COMPLETE" : "LIVE_PARTIAL_WITH_ERRORS",
    pagesRead: listed.pagesRead,
    complete,
    errors,
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
  canonical?: CanonicalMenu;
  runsDbPath: string;
  workflow?: "CREATE_MENU" | "QA_RECONCILE";
  executionBundle: ExecutionBundleV1;
}): Promise<{
  livePlan: MigrationWritePlan;
  result: ExecuteResult;
  destination: DryRunDestinationSnapshot;
  recoveryPlan: RecoveryPlan;
}> {
  const host = normalizeDestinationHost(input.destinationHost);
  const baseUrl = `https://${host}`;
  const productionSha = resolveDeployCommitSha({});
  const bundleCheck = validateExecutionBundle({
    bundle: input.executionBundle,
    productionSha,
    destinationHost: host,
    destinationSnapshotHash: input.executionBundle.destinationSnapshotHash,
  });
  if (host !== input.executionBundle.destinationHost) {
    throw new Error(
      `STALE_EXECUTION_BUNDLE destinationHost expected=${input.executionBundle.destinationHost} actual=${host}`,
    );
  }
  if (!bundleCheck.ok) {
    throw new Error(`${bundleCheck.code}: ${bundleCheck.reason}`);
  }

  const root = repoRoot();
  const isQa = input.workflow === "QA_RECONCILE";
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

  const session = await launchJobPage();
  const page = session.page;
  try {
    await adminLogin(page, baseUrl);
    const probe = await probeAdminContract({
      page,
      baseUrl,
      expectedHost: host,
    });
    if (probe.authentication !== "PASS") {
      throw new Error("AUTH_CREDENTIALS_REJECTED: contract probe is not authenticated");
    }
    const observedFingerprint = buildAdminContractFingerprint(
      TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
    ).fingerprint;
    const loaded = await loadRealDestinationSnapshot({
      baseUrl,
      page,
      deep: isQa,
    });
    if (loaded.status !== "LIVE_COMPLETE") {
      throw new Error(
        `SNAPSHOT incomplete (${loaded.status}): ${loaded.errors.join("; ") || "not LIVE_COMPLETE"}`,
      );
    }
    const destination = loaded.snapshot;
    const observedSnapshotHash = sha256Canonical({
      host: destination.host,
      categories: destination.categories,
      products: destination.products,
    });
    const freshness = validateExecutionBundle({
      bundle: input.executionBundle,
      productionSha,
      destinationHost: host,
      destinationSnapshotHash: observedSnapshotHash,
    });
    if (!freshness.ok) {
      throw new Error(`${freshness.code}: ${freshness.reason}`);
    }
    const gate = evaluatePreWriteGate({
      bundle: input.executionBundle,
      pageUrl: page.url(),
      authenticated: true,
      observedContractFingerprint: observedFingerprint,
      observedSnapshotHash,
      productionSha,
    });
    if (!gate.ok) {
      throw new Error(`${gate.code}: ${gate.reason}`);
    }

    const livePlan = createMigrationWritePlan({
      runId: input.runId,
      restaurant: input.restaurant,
      host: input.executionBundle.destinationHost,
      source: input.source,
      schemaVersion: input.schemaVersion,
      domainRuleVersion: input.domainRuleVersion,
      adapterVersion: input.adapterVersion,
      contractFingerprint: input.executionBundle.contractFingerprint,
      dryRun: false,
      operations: input.executionBundle.operations.map((o) => ({ ...o })),
      preserveOperationOrder: true,
    });
    assertApprovedPlanEqualsExecutedPlan({
      approvedOperations: input.executionBundle.operations,
      executedOperations: livePlan.operations,
    });

    const store = new RunStore(input.runsDbPath);
    try {
      const destinationPort = createTahPlaywrightDestinationPort({
        page,
        baseUrl,
        expectedHost: host,
        restaurantKey: input.restaurant,
      });
      const result = await executeMigrationPlan({
        plan: livePlan,
        store,
        destination: destinationPort,
        workflow: input.workflow ?? "CREATE_MENU",
        gate: {
          hostOk: gate.ok,
          contractMatch:
            observedFingerprint === input.executionBundle.contractFingerprint,
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
    await session.close();
  }
}

export function portalLiveRunsDbPath(dataDir: string): string {
  return join(dataDir, "live-runs.sqlite");
}
