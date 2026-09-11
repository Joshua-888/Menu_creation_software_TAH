/**
 * M5H — Veroni human-review preparation (no admin writes).
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { runDomainEngine } from "../src/domain/engine.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../src/domain/versions.js";
import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import {
  loadVeroniGoldenFixture,
  reconcileAgainstGolden,
  listSourceProducts,
} from "../src/extraction/pdf/veroniGate.js";
import {
  buildDryRunWritePlan,
  mapSourceCategoriesToDestination,
  mapProductToDestinationCategory,
  partitionDestinationProducts,
  summarizeSourceDryRun,
} from "../src/planning/index.js";
import { buildHumanReviewReport } from "../src/review/humanReport.js";
import {
  assertReviewConsistentWithMenus,
  buildFinalHumanReview,
} from "../src/review/finalReview.js";
import { ADMIN_CONTRACT_V1, ADMIN_CONTRACT_VERSION } from "../src/tah/contracts/v1.js";
import {
  buildAdminContractFingerprint,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
} from "../src/tah/contracts/fingerprint.js";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import * as renderedFallback from "../src/extraction/pdf/renderedFallback.js";

function loadEnv(p: string): void {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env");

const PDF_PATH = resolve("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const OUT_DIR = resolve("runs/m5h-veroni");
const HOST = "veronipizza.dk";
const AUTH = "playwright/.auth/tah-admin-veroni.json";

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function statusCounts(menu: {
  categories: Array<{
    products: Array<{ status: string; sourceMenuNumber?: string; name: string }>;
  }>;
}) {
  const c: Record<string, number> = {
    READY: 0,
    WARNING: 0,
    MANUAL_REVIEW_REQUIRED: 0,
    BLOCKED: 0,
  };
  const lists: Record<string, string[]> = {
    READY: [],
    WARNING: [],
    MANUAL_REVIEW_REQUIRED: [],
    BLOCKED: [],
  };
  for (const cat of menu.categories) {
    for (const p of cat.products) {
      c[p.status] = (c[p.status] ?? 0) + 1;
      lists[p.status]!.push(`${p.sourceMenuNumber ?? "?"} ${p.name}`);
    }
  }
  return { counts: c, lists };
}

async function discoverDestinationReadonly() {
  const email = process.env.TAH_ADMIN_EMAIL?.trim();
  const password = process.env.TAH_ADMIN_PASSWORD?.trim();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(
      existsSync(AUTH) ? { storageState: AUTH } : {},
    );
    const page = await context.newPage();
    await page.goto(`https://${HOST}/admin/menu`, {
      waitUntil: "domcontentloaded",
    });
    if (/\/login/i.test(page.url())) {
      if (!email || !password) {
        throw new Error(
          "Admin session expired and TAH_ADMIN_EMAIL / TAH_ADMIN_PASSWORD missing — run scripts/m61-veroni-auth-refresh.ts",
        );
      }
      await page.goto(`https://${HOST}/login`, {
        waitUntil: "domcontentloaded",
      });
      const cookie = page.getByRole("button", { name: /allow cookies/i });
      if ((await cookie.count()) > 0) {
        await cookie.click({ timeout: 3000 }).catch(() => undefined);
      }
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole("button", { name: /^login$/i }).click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1500);
      if (/\/login/i.test(page.url())) {
        throw new Error("Veroni login failed during read-only discovery");
      }
      mkdirSync(dirname(AUTH), { recursive: true });
      await context.storageState({ path: AUTH });
    }

    // Confirm authenticated admin surfaces (read-only)
    await page.goto(`https://${HOST}/admin/menu`, {
      waitUntil: "domcontentloaded",
    });
    if (/\/login/i.test(page.url())) {
      throw new Error("Not authenticated on /admin/menu");
    }
    await page.goto(`https://${HOST}/admin/categories`, {
      waitUntil: "domcontentloaded",
    });
    if (/\/login/i.test(page.url())) {
      throw new Error("Not authenticated on /admin/categories");
    }

    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: `https://${HOST}`,
      expectedHost: HOST,
    });
    const categories = await adapter.listCategories();
    const products = await adapter.listProducts();
    return {
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
          ...(p.statusText ? { listStatus: p.statusText } : {}),
        })),
      authenticated: true as const,
    };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const hardcoding =
    "loadVisionCorrections" in renderedFallback
      ? "YES"
      : "NO";

  const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
  const extracted = await adapter.extractDetailed({
    kind: "pdf",
    filePath: PDF_PATH,
  });
  writeJson(join(OUT_DIR, "source-menu.json"), extracted.sourceMenu);
  writeJson(join(OUT_DIR, "source-accounting.json"), extracted.accounting);

  const golden = loadVeroniGoldenFixture();
  const gate = reconcileAgainstGolden(extracted.sourceMenu, golden);
  writeJson(join(OUT_DIR, "menu-number-reconciliation.json"), gate);

  const domain = runDomainEngine(extracted.sourceMenu);
  writeJson(join(OUT_DIR, "canonical-menu.json"), domain.menu);
  writeJson(join(OUT_DIR, "validation-report.json"), domain.validation);

  const products = listSourceProducts(extracted.sourceMenu);
  const bySrc = Object.fromEntries(
    extracted.sourceMenu.categories.flatMap((c) =>
      c.products.map((p) => [p.sourceMenuNumber ?? "", p]),
    ),
  );
  const p44 = bySrc["44"];
  const p45 = bySrc["45"];

  const destination = await discoverDestinationReadonly();
  if (destination.categories.length === 0) {
    writeJson(join(OUT_DIR, "destination-snapshot.json"), {
      host: HOST,
      categories: [],
      realProducts: [],
      canaryProducts: [],
      readOnly: true,
      mutated: false,
      authenticated: destination.authenticated,
      STOP: "EMPTY_DESTINATION_SNAPSHOT",
    });
    console.error(
      "STOP: destination category count = 0 — refusing to generate human-review decisions from an empty snapshot. Refresh auth via scripts/m61-veroni-auth-refresh.ts",
    );
    process.exit(2);
  }
  const { real, canaries } = partitionDestinationProducts(destination.products);
  writeJson(join(OUT_DIR, "destination-snapshot.json"), {
    host: HOST,
    categories: destination.categories,
    realProducts: real,
    canaryProducts: canaries,
    readOnly: true,
    mutated: false,
    authenticated: destination.authenticated,
  });

  const categoryMappings = mapSourceCategoriesToDestination(
    domain.menu.categories.map((c) => ({
      sourceId: c.sourceId,
      name: c.name
        .replace(/^INDISK\s*\/\s*/i, "Indisk")
        .replace(/^INDISK$/i, "Indisk"),
    })),
    destination.categories,
  ).map((m, i) => ({
    ...m,
    sourceCategoryName: domain.menu.categories[i]?.name ?? m.sourceCategoryName,
  }));

  const productMappings = ["36", "37", "38"].map((n) =>
    mapProductToDestinationCategory(
      {
        menuNumber: n,
        name: bySrc[n]?.name ?? "",
        sourceCategoryName: products.find((p) => p.menuNumber === n)?.section ?? "",
      },
      destination.categories,
    ),
  );
  writeJson(join(OUT_DIR, "category-mapping.json"), {
    categoryMappings,
    productLevelMappings: productMappings,
  });

  const humanReview = buildHumanReviewReport({
    canonical: domain.menu,
    validation: domain.validation,
    accounting: extracted.accounting,
    categoryMappings,
  });
  writeJson(join(OUT_DIR, "human-review.json"), humanReview);

  const finalReview = buildFinalHumanReview({
    sourceMenu: extracted.sourceMenu,
    canonical: domain.menu,
    categoryMappings,
    productMappings,
  });
  assertReviewConsistentWithMenus({
    decisions: finalReview.decisions,
    sourceMenu: extracted.sourceMenu,
    canonical: domain.menu,
  });
  writeJson(join(OUT_DIR, "human-review-final.json"), finalReview);
  writeFileSync(join(OUT_DIR, "human-review-final.md"), finalReview.markdown, "utf8");

  const fp = buildAdminContractFingerprint(TAH_V1_STRUCTURE_FINGERPRINT_INPUT);
  const dryPlan = buildDryRunWritePlan({
    runId: `m5h-veroni-${new Date().toISOString().slice(0, 10)}`,
    restaurant: "Veroni Pizza",
    host: HOST,
    source: PDF_PATH,
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
    adapterVersion: ADMIN_CONTRACT_VERSION,
    contractFingerprint: fp.fingerprint,
    canonical: domain.menu,
    categoryMappings,
    destination: {
      host: HOST,
      categories: destination.categories,
      products: destination.products,
    },
    capabilities: ADMIN_CONTRACT_V1.capabilities,
  });
  writeJson(join(OUT_DIR, "dry-run-writeplan.json"), dryPlan);

  const statuses = statusCounts(domain.menu);
  const sourceActions = summarizeSourceDryRun(dryPlan);
  const almFam = products.filter(
    (p) => p.variants.includes("Alm.") && p.variants.includes("Familie"),
  ).length;
  const baseMenu = products.filter((p) => p.priceModeHints.includes("Menu"));
  const p65 = bySrc["65"];

  const report = {
    title: "VERONI FINAL HUMAN REVIEW PACK",
    VERONI_RUNTIME_HARDCODING: hardcoding,
    product44: { name: p44?.name, status: "see statuses" },
    product45: { name: p45?.name, status: "see statuses" },
    statuses: statuses.counts,
    statusLists: statuses.lists,
    consolidatedHumanDecisions: finalReview.decisions.length,
    decisions: finalReview.decisions.map((d) => ({
      id: d.id,
      type: d.type,
      title: d.title,
      affected: d.affectedProducts.map((p) => p.menuNumber),
      recommended: d.recommendedOptionId,
    })),
    almFamilieCount: almFam,
    baseMenuCount: baseMenu.length,
    product65: { name: p65?.name, priceOre: p65?.variants[0]?.sourceTotalPrice },
    sourceDryRunActions: sourceActions,
    golden: gate.pass ? "PASS" : "FAIL",
    READY_FOR_HUMAN_DECISIONS:
      hardcoding === "NO" &&
      gate.pass &&
      statuses.counts.BLOCKED === 0 &&
      (p44?.name ?? "").toLowerCase().includes("kebab") &&
      (p45?.name ?? "").toLowerCase().includes("pøl") &&
      p65?.variants[0]?.sourceTotalPrice === 2500 &&
      bySrc["66"]?.variants[0]?.sourceTotalPrice === 4500
        ? "YES"
        : "NO",
    note: "NO LIVE WRITE — human decisions only; executor not bound",
  };
  writeJson(join(OUT_DIR, "m5h-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
