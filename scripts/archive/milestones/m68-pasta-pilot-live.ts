/**
 * Scoped live pilot: create Pasta category + hidden products #33–35 on Veroni.
 * Does NOT bulk-import the full menu. Requires .env TAH_ADMIN_*.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import {
  createMigrationWritePlan,
  createTahPlaywrightDestinationPort,
  executeMigrationPlan,
} from "../src/runner/index.js";
import { RunStore } from "../src/runs/sqliteStore.js";
import {
  assertVeroniTargetLock,
  blockWriteUnlessTargetLocked,
} from "../src/tah/write/targetLock.js";
import { VERONI_CANARY_TARGET } from "../src/tah/write/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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

const PRODUCTS = [
  {
    sourceId: "src:33:spaghettibolognese",
    menuNumber: "33",
    name: "Spaghetti Bolognese",
    description: "Klassisk italiensk kødsovs",
    basePriceOre: 13000,
    ingredients: ["Klassisk italiensk kødsovs"],
  },
  {
    sourceId: "src:34:pastaalfredomedkylling",
    menuNumber: "34",
    name: "Pasta Alfredo med Kylling",
    description: "Klassisk ret med Penne, flødesovs, parmesan og kylling",
    basePriceOre: 13000,
    ingredients: ["Penne", "flødesovs", "parmesan", "kylling"],
  },
  {
    sourceId: "src:35:pastaaigamberi",
    menuNumber: "35",
    name: "Pasta Ai Gamberi",
    description: "Penne, tigerrejer, spinat, flødesovs, parmesan",
    basePriceOre: 13000,
    ingredients: ["Penne", "tigerrejer", "spinat", "flødesovs", "parmesan"],
  },
] as const;

const outDir = join(root, "runs", "discovery", `m68-pasta-pilot-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function finish(status: string, body: Record<string, unknown>, code = 0): never {
  const report = { milestone: "M68_PASTA_PILOT", status, ...body };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(code);
}

async function main() {
  const lock = assertVeroniTargetLock({
    hostname: VERONI_CANARY_TARGET.host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    url: VERONI_CANARY_TARGET.baseUrl,
  });
  blockWriteUnlessTargetLocked(lock);

  const email = process.env.TAH_ADMIN_EMAIL;
  const password = process.env.TAH_ADMIN_PASSWORD;
  if (!email || !password) {
    finish("BLOCKED", { reason: "missing_TAH_ADMIN_credentials" }, 1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('input[type="email"]').first().fill(email!);
    await page.locator('input[type="password"]').first().fill(password!);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);

    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
    });
    const beforeCats = await adapter.listCategories();
    const pasta = beforeCats.find(
      (c) => c.name.trim().toLowerCase() === "pasta",
    );
    const pastaId =
      pasta?.databaseId ??
      (
        await adapter.createCategory({
          name: "Pasta",
          order: 50,
          allowCustomerCategory: true,
        })
      ).destinationId;

    const port = createTahPlaywrightDestinationPort({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
    });

    const runId = `m68-pasta-${Date.now()}`;
    const plan = createMigrationWritePlan({
      runId,
      restaurant: "Veroni Pizza",
      host: VERONI_CANARY_TARGET.host,
      source: "m68-pasta-pilot",
      schemaVersion: "1",
      domainRuleVersion: "1",
      adapterVersion: "1",
      contractFingerprint: "m68-pasta-pilot",
      dryRun: false,
      operations: PRODUCTS.map((p, i) => ({
        operationId: `pasta-prod-${i + 1}`,
        entityType: "product" as const,
        action: "CREATE" as const,
        identity: {
          sourceId: p.sourceId,
          menuNumber: p.menuNumber,
          name: p.name,
          categoryHint: pastaId,
        },
        expectedPayload: {
          sourceId: p.sourceId,
          menuNumber: p.menuNumber,
          name: p.name,
          description: p.description,
          basePriceOre: p.basePriceOre,
          categoryIds: [pastaId],
          variants: [{ name: "Alm.", surchargeOre: 0 }],
          ingredients: [...p.ingredients],
          additions: [],
          intendedHidden: true,
        },
      })),
    });

    const store = new RunStore(join(outDir, "runs.sqlite"));
    const result = await executeMigrationPlan({
      plan,
      store,
      destination: port,
      gate: {
        hostOk: true,
        contractMatch: true,
        host: VERONI_CANARY_TARGET.host,
        expectedHost: VERONI_CANARY_TARGET.host,
      },
    });
    store.close();

    const afterCats = await adapter.listCategories();
    const afterProducts = await adapter.listProducts();
    const created = PRODUCTS.map((p) => {
      const hit = afterProducts.find(
        (x) =>
          x.menuNumber?.trim() === p.menuNumber ||
          x.name.trim().toLowerCase() === p.name.toLowerCase(),
      );
      return {
        menuNumber: p.menuNumber,
        name: p.name,
        databaseId: hit?.databaseId ?? null,
        statusText: hit?.statusText ?? null,
      };
    });

    finish(result.failed + result.blocked > 0 ? "PARTIAL" : "VERIFIED", {
      pastaCategoryId: pastaId,
      pastaExistedBefore: Boolean(pasta),
      categoriesAfter: afterCats.map((c) => ({
        id: c.databaseId,
        name: c.name,
      })),
      result,
      created,
      notes: [
        "Hidden CREATE only (Aktiv? unchecked)",
        "Scoped to Pasta + #33–35 — not full menu",
      ],
    }, result.failed > 0 ? 1 : 0);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  finish(
    "FAILED",
    { reason: "uncaught", error: err instanceof Error ? err.message : String(err) },
    1,
  );
});
