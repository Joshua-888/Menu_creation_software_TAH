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
  executeMigrationPlan,
  type ExecuteResult,
  type MigrationWritePlan,
} from "../runner/index.js";
import { RunStore } from "../runs/sqliteStore.js";
import { M2B_ADAPTER_CAPABILITIES } from "../tah/contracts/evidence.js";
import { TahAdminAdapterV1 } from "../tah/adapters/v1/adapter.js";
import { normalizeDestinationHost } from "./liveWrites.js";

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
}): Promise<DryRunDestinationSnapshot> {
  const adapter = new TahAdminAdapterV1({
    page: input.page,
    baseUrl: input.baseUrl,
    expectedHost: normalizeDestinationHost(input.baseUrl),
  });
  const categories = await adapter.listCategories();
  const products = await adapter.listProducts();
  return {
    host: normalizeDestinationHost(input.baseUrl),
    categories: categories.map((c) => ({
      databaseId: c.databaseId,
      name: c.name,
    })),
    products: products
      .filter((p) => p.databaseId)
      .map((p) => ({
        databaseId: p.databaseId!,
        menuNumber: p.menuNumber ?? "",
        name: p.name,
        categoryIds: [] as string[],
        listStatus: (p.statusText || "").trim(),
      })),
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
}): Promise<{
  livePlan: MigrationWritePlan;
  result: ExecuteResult;
  destination: DryRunDestinationSnapshot;
}> {
  const host = normalizeDestinationHost(input.destinationHost);
  const baseUrl = `https://${host}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await adminLogin(page, baseUrl);
    const destination = await loadRealDestinationSnapshot({ baseUrl, page });
    const categoryMappings = mapSourceCategoriesToDestination(
      input.canonical.categories.map((c) => ({
        sourceId: c.sourceId,
        name: c.name,
      })),
      destination.categories,
    );
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
    });
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
      operations: dry.operations.map((o) => ({ ...o })),
    });

    const store = new RunStore(input.runsDbPath);
    const destinationPort = createTahPlaywrightDestinationPort({
      page,
      baseUrl,
      expectedHost: host,
    });
    const result = await executeMigrationPlan({
      plan: livePlan,
      store,
      destination: destinationPort,
      gate: {
        hostOk: true,
        contractMatch: true,
        host,
        expectedHost: host,
      },
    });
    store.close();
    return { livePlan, result, destination };
  } finally {
    await browser.close();
  }
}

export function portalLiveRunsDbPath(dataDir: string): string {
  return join(dataDir, "live-runs.sqlite");
}
