/**
 * M5R — Veroni extraction repair pipeline (READ-ONLY against TAH).
 * Gates on fixtures/veroni/golden-source.json (72 products).
 * Does NOT execute WritePlan / import / publish.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, renameSync } from "node:fs";
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
  partitionDestinationProducts,
  summarizeDryRun,
} from "../src/planning/index.js";
import { buildHumanReviewReport } from "../src/review/humanReport.js";
import { ADMIN_CONTRACT_V1, ADMIN_CONTRACT_VERSION } from "../src/tah/contracts/v1.js";
import {
  buildAdminContractFingerprint,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
} from "../src/tah/contracts/fingerprint.js";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";

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

const PDF_PATH = resolve(
  process.argv[2] ?? "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const OUT_DIR = resolve("runs/m5r-veroni");
const LEGACY_DIR = resolve("runs/m5-veroni");
const HOST = "veronipizza.dk";
const BASE_URL = `https://${HOST}`;
const AUTH = "playwright/.auth/tah-admin-veroni.json";

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function statusCounts(menu: {
  categories: Array<{ products: Array<{ status: string }> }>;
}): Record<string, number> {
  const c: Record<string, number> = {
    READY: 0,
    WARNING: 0,
    MANUAL_REVIEW_REQUIRED: 0,
    BLOCKED: 0,
  };
  for (const cat of menu.categories) {
    for (const p of cat.products) {
      c[p.status] = (c[p.status] ?? 0) + 1;
    }
  }
  return c;
}

function invalidateLegacyWritePlan(): void {
  const legacy = join(LEGACY_DIR, "dry-run-writeplan.json");
  if (!existsSync(legacy)) return;
  const superseded = join(LEGACY_DIR, "dry-run-writeplan.SUPERSEDED_BY_M5R.json");
  try {
    renameSync(legacy, superseded);
  } catch {
    writeJson(superseded, {
      status: "SUPERSEDED_BY_M5R",
      note: "M5 dry-run invalidated — incorrect extraction (106 products)",
    });
  }
  writeJson(join(LEGACY_DIR, "INVALIDATED.json"), {
    status: "SUPERSEDED_BY_M5R",
    at: new Date().toISOString(),
  });
}

async function discoverDestinationReadonly(): Promise<{
  categories: Array<{ databaseId: string; name: string }>;
  products: Array<{
    databaseId: string;
    menuNumber: string;
    name: string;
    categoryIds: string[];
    listStatus?: string;
  }>;
}> {
  const email = process.env.TAH_ADMIN_EMAIL?.trim();
  const password = process.env.TAH_ADMIN_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error("Missing TAH_ADMIN_EMAIL / TAH_ADMIN_PASSWORD");
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext(
      existsSync(AUTH) ? { storageState: AUTH } : {},
    );
    const page = await ctx.newPage();
    await page.goto(new URL("/admin/menu", BASE_URL).toString(), {
      waitUntil: "domcontentloaded",
    });
    if (/\/login/i.test(page.url())) {
      await page.goto(new URL("/login", BASE_URL).toString(), {
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
      await ctx.storageState({ path: AUTH });
    }
    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: BASE_URL,
      expectedHost: HOST,
    });
    const categories = await adapter.listCategories();
    const list = await adapter.listProducts();
    return {
      categories: categories.map((c) => ({
        databaseId: c.databaseId,
        name: c.name,
      })),
      products: list
        .filter((p) => p.databaseId)
        .map((p) => ({
          databaseId: p.databaseId!,
          menuNumber: p.menuNumber ?? "",
          name: p.name,
          categoryIds: [] as string[],
          ...(p.statusText ? { listStatus: p.statusText } : {}),
        })),
    };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(PDF_PATH)) {
    console.error(`PDF not found: ${PDF_PATH}`);
    process.exit(2);
  }

  invalidateLegacyWritePlan();
  mkdirSync(OUT_DIR, { recursive: true });

  const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
  const extracted = await adapter.extractDetailed({
    kind: "pdf",
    filePath: PDF_PATH,
  });
  writeJson(join(OUT_DIR, "source-menu.json"), extracted.sourceMenu);
  writeJson(join(OUT_DIR, "source-accounting.json"), extracted.accounting);
  writeJson(
    join(OUT_DIR, "pages.json"),
    extracted.pages.map((p) => ({
      pageNumber: p.pageNumber,
      classification: p.classification,
      classificationReason: p.classificationReason,
      imageRef: p.imageRef,
    })),
  );
  writeJson(join(OUT_DIR, "overlap-links.json"), extracted.overlapLinks);

  const golden = loadVeroniGoldenFixture();
  const gate = reconcileAgainstGolden(extracted.sourceMenu, golden);
  writeJson(join(OUT_DIR, "menu-number-reconciliation.json"), {
    pass: gate.pass,
    uniqueProductCount: gate.uniqueProductCount,
    expectedCount: gate.expectedCount,
    missing: gate.missing,
    extra: gate.extra,
    structuralIssues: gate.structuralIssues,
    sectionIssues: gate.sectionIssues,
    rows: gate.rows,
  });

  if (!gate.pass) {
    const report = {
      title: "M5R VERONI EXTRACTION REPAIR REPORT",
      READY_FOR_VERONI_WRITEPLAN: false,
      uniqueProductCount: gate.uniqueProductCount,
      expected: 72,
      discrepancy: {
        missing: gate.missing,
        extra: gate.extra,
        structuralIssues: gate.structuralIssues,
        sectionIssues: gate.sectionIssues,
      },
      note: "STOPPED — uniqueProductCount != 72; no dry-run WritePlan generated",
    };
    writeJson(join(OUT_DIR, "m5r-report.json"), report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const domain = runDomainEngine(extracted.sourceMenu);
  writeJson(join(OUT_DIR, "canonical-menu.json"), domain.menu);
  writeJson(join(OUT_DIR, "validation-report.json"), domain.validation);

  console.log("M5R destination discovery (READ-ONLY)...");
  const destination = await discoverDestinationReadonly();
  const { real, canaries } = partitionDestinationProducts(destination.products);
  writeJson(join(OUT_DIR, "destination-snapshot.json"), {
    host: HOST,
    categories: destination.categories,
    realProducts: real,
    canaryProducts: canaries,
    readOnly: true,
    mutated: false,
  });

  // Map source sections → destination categories (INDISK* → Indisk)
  const categoryMappings = mapSourceCategoriesToDestination(
    domain.menu.categories.map((c) => ({
      sourceId: c.sourceId,
      name: c.name.replace(/^INDISK\s*\/\s*/i, "Indisk").replace(/^INDISK$/i, "Indisk"),
    })),
    destination.categories,
  );
  // Restore original source names in report
  const mappingsWithSourceNames = categoryMappings.map((m, i) => ({
    ...m,
    sourceCategoryName: domain.menu.categories[i]?.name ?? m.sourceCategoryName,
  }));
  writeJson(join(OUT_DIR, "category-mapping.json"), mappingsWithSourceNames);

  const humanReview = buildHumanReviewReport({
    canonical: domain.menu,
    validation: domain.validation,
    accounting: extracted.accounting,
    categoryMappings: mappingsWithSourceNames,
  });
  writeJson(join(OUT_DIR, "human-review.json"), humanReview);

  const fp = buildAdminContractFingerprint(TAH_V1_STRUCTURE_FINGERPRINT_INPUT);
  const dryPlan = buildDryRunWritePlan({
    runId: `m5r-veroni-${new Date().toISOString().slice(0, 10)}`,
    restaurant: "Veroni Pizza",
    host: HOST,
    source: PDF_PATH,
    schemaVersion: CANONICAL_MENU_SCHEMA_VERSION,
    domainRuleVersion: DOMAIN_RULE_ENGINE_VERSION,
    adapterVersion: ADMIN_CONTRACT_VERSION,
    contractFingerprint: fp.fingerprint,
    canonical: domain.menu,
    categoryMappings: mappingsWithSourceNames,
    destination: {
      host: HOST,
      categories: destination.categories,
      products: destination.products,
    },
    capabilities: ADMIN_CONTRACT_V1.capabilities,
  });
  writeJson(join(OUT_DIR, "dry-run-writeplan.json"), dryPlan);

  const products = listSourceProducts(extracted.sourceMenu);
  const statuses = statusCounts(domain.menu);
  const dryCounts = summarizeDryRun(dryPlan);
  const almFam = products.filter(
    (p) => p.variants.includes("Alm.") && p.variants.includes("Familie"),
  ).length;
  const lilleStor = products.filter(
    (p) => p.variants.includes("Lille") && p.variants.includes("Stor"),
  );
  const menuPrice = products.filter((p) => p.priceModeHints.includes("Menu")).length;

  const report = {
    title: "M5R VERONI EXTRACTION REPAIR REPORT",
    extractionApproach:
      "layout-first spatial lines; period=menu# vs comma=price; scoped variant headers; Menu as price column",
    pagesProcessed: extracted.pageCount,
    pageClassifications: extracted.pages.map((p) => ({
      page: p.pageNumber,
      class: p.classification,
    })),
    duplicatePageReconciliation: {
      overlappingPages: extracted.pages
        .filter((p) => p.classification === "DUPLICATE_OR_OVERLAPPING")
        .map((p) => p.pageNumber),
      links: extracted.overlapLinks,
      duplicateOccurrences: extracted.duplicateOccurrences,
    },
    uniqueProductCount: gate.uniqueProductCount,
    menuNumberReconciliation: gate.rows,
    sourceSections: extracted.sourceMenu.categories.map((c) => ({
      name: c.name,
      count: c.products.length,
    })),
    menuColumnInterpretation: "PRICE_COLUMN (BASE + Menu totals) — not a category",
    almFamilieProductCount: almFam,
    lilleStorProductCount: lilleStor.length,
    lilleStorMenuNumbers: lilleStor.map((p) => p.menuNumber),
    otherPriceOptionPatterns: { baseAndMenuProducts: menuPrice },
    ocrFalsePositivesRemoved: ["II5", "I15", "price-as-menu-number"],
    alphanumericPreserved: ["32b", "32C"],
    validationCounts: statuses,
    humanReviewItemCount: humanReview.items.length,
    categoryMapping: mappingsWithSourceNames,
    missingDestinationCategories: mappingsWithSourceNames.filter(
      (m) => m.outcome === "MISSING_DESTINATION_CATEGORY",
    ),
    dryRunCounts: dryCounts,
    missingCertifiedCapabilities: [
      ...new Set(dryPlan.operations.flatMap((o) => o.missingCapabilities ?? [])),
    ],
    goldenFixturePass: gate.pass,
    READY_FOR_VERONI_WRITEPLAN: true,
    READY_FOR_LIVE_IMPORT: false,
    legacyWritePlan: "SUPERSEDED_BY_M5R",
    artifactPaths: {
      sourceMenu: join(OUT_DIR, "source-menu.json"),
      canonicalMenu: join(OUT_DIR, "canonical-menu.json"),
      validationReport: join(OUT_DIR, "validation-report.json"),
      humanReview: join(OUT_DIR, "human-review.json"),
      sourceAccounting: join(OUT_DIR, "source-accounting.json"),
      reconciliation: join(OUT_DIR, "menu-number-reconciliation.json"),
      dryRunWritePlan: join(OUT_DIR, "dry-run-writeplan.json"),
    },
  };
  writeJson(join(OUT_DIR, "m5r-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
  console.log("\nM5R complete — STOP (no WritePlan execution).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
