/**
 * M5 — Veroni PDF extraction + CanonicalMenu + read-only destination discovery + dry-run WritePlan.
 * READ-ONLY against TakeAwayHero. Does NOT execute WritePlan / import / publish.
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
  process.argv[2] ??
    "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const OUT_DIR = resolve("runs/m5-veroni");
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
    throw new Error(
      "Missing TAH_ADMIN_EMAIL / TAH_ADMIN_PASSWORD for read-only Veroni discovery",
    );
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
    const products = list.map((p) => ({
      databaseId: p.databaseId ?? "",
      menuNumber: p.menuNumber ?? "",
      name: p.name,
      categoryIds: [] as string[],
      ...(p.statusText ? { listStatus: p.statusText } : {}),
    }));
    return {
      categories: categories.map((c) => ({
        databaseId: c.databaseId,
        name: c.name,
      })),
      products: products.filter((p) => p.databaseId),
    };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(PDF_PATH)) {
    console.error(`PDF not found: ${PDF_PATH}`);
    console.error("Pass the exact local path as argv[2].");
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  console.log("M5 ingest", PDF_PATH);

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
      charCount: p.rawText.length,
      imageRef: p.imageRef,
    })),
  );
  writeJson(join(OUT_DIR, "overlap-links.json"), extracted.overlapLinks);

  const domain = runDomainEngine(extracted.sourceMenu);
  writeJson(join(OUT_DIR, "canonical-menu.json"), domain.menu);
  writeJson(join(OUT_DIR, "validation-report.json"), domain.validation);

  console.log("M5 destination discovery (READ-ONLY)...");
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

  const categoryMappings = mapSourceCategoriesToDestination(
    domain.menu.categories.map((c) => ({
      sourceId: c.sourceId,
      name: c.name,
    })),
    destination.categories,
  );
  writeJson(join(OUT_DIR, "category-mapping.json"), categoryMappings);

  const humanReview = buildHumanReviewReport({
    canonical: domain.menu,
    validation: domain.validation,
    accounting: extracted.accounting,
    categoryMappings,
  });
  writeJson(join(OUT_DIR, "human-review.json"), humanReview);

  const fp = buildAdminContractFingerprint(TAH_V1_STRUCTURE_FINGERPRINT_INPUT);
  const dryPlan = buildDryRunWritePlan({
    runId: `m5-veroni-${new Date().toISOString().slice(0, 10)}`,
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
  const dryCounts = summarizeDryRun(dryPlan);
  const byCategory = domain.menu.categories.map((c) => ({
    name: c.name,
    count: c.products.length,
  }));

  const menuNumbers = domain.menu.categories.flatMap((c) =>
    c.products.map((p) => p.assignedMenuNumber ?? p.sourceMenuNumber ?? ""),
  );
  const pureInts = menuNumbers
    .filter((n) => /^\d+$/.test(n.trim()))
    .map((n) => Number(n))
    .filter((n) => n >= 1 && n <= 80)
    .sort((a, b) => a - b);
  const uniqueInts = [...new Set(pureInts)];
  const gaps: number[] = [];
  for (let i = 1; i < uniqueInts.length; i++) {
    for (let g = uniqueInts[i - 1]! + 1; g < uniqueInts[i]!; g++) gaps.push(g);
  }

  const missingCaps = [
    ...new Set(
      dryPlan.operations.flatMap((o) => o.missingCapabilities ?? []),
    ),
  ];

  const variantPatterns = new Map<string, number>();
  let additionCount = 0;
  for (const c of domain.menu.categories) {
    for (const p of c.products) {
      additionCount += p.addOns.length;
      const key = p.variants.map((v) => v.name).join("|") || "(none)";
      variantPatterns.set(key, (variantPatterns.get(key) ?? 0) + 1);
    }
  }

  const report = {
    title: "M5 VERONI EXTRACTION + DRY RUN REPORT",
    pdfPath: PDF_PATH,
    outDir: OUT_DIR,
    pagesProcessed: extracted.pageCount,
    pageClassifications: extracted.pages.map((p) => ({
      page: p.pageNumber,
      class: p.classification,
    })),
    duplicateOverlappingPages: extracted.pages
      .filter((p) => p.classification === "DUPLICATE_OR_OVERLAPPING")
      .map((p) => p.pageNumber),
    overlapLinks: extracted.overlapLinks,
    uniqueSourceProducts: extracted.uniqueProducts,
    duplicateSourceOccurrences: extracted.duplicateOccurrences,
    categories: byCategory,
    variantPatterns: Object.fromEntries(variantPatterns),
    additionCount,
    menuNumberCoverage: {
      assigned: menuNumbers.filter(Boolean).length,
      pureIntegerCount: uniqueInts.length,
      alphanumeric: menuNumbers.filter((n) => /[a-zA-Z]/.test(n)),
      apparentGapsAmongPresentIntegers: gaps,
      note: "Gaps are among observed pure integers in 1..80 only; not assumed mandatory",
    },
    validationCounts: statuses,
    humanReviewItemCount: humanReview.items.length,
    categoryMapping: categoryMappings,
    missingDestinationCategories: categoryMappings.filter(
      (m) => m.outcome === "MISSING_DESTINATION_CATEGORY",
    ),
    dryRunCounts: dryCounts,
    missingCertifiedCapabilities: missingCaps,
    sourceAccountingSummary: extracted.accounting.summary,
    destinationCanaries: canaries.map((c) => ({
      databaseId: c.databaseId,
      menuNumber: c.menuNumber,
      name: c.name,
    })),
    READY_FOR_VERONI_WRITEPLAN: true,
    READY_FOR_LIVE_IMPORT: false,
    liveImportBlockedReason:
      "M4 DestinationPort is not yet bound to certified TahAdminAdapter/Playwright and integration-tested; M5 dry-run only",
    artifactPaths: {
      sourceMenu: join(OUT_DIR, "source-menu.json"),
      canonicalMenu: join(OUT_DIR, "canonical-menu.json"),
      validationReport: join(OUT_DIR, "validation-report.json"),
      humanReview: join(OUT_DIR, "human-review.json"),
      sourceAccounting: join(OUT_DIR, "source-accounting.json"),
      dryRunWritePlan: join(OUT_DIR, "dry-run-writeplan.json"),
    },
  };

  writeJson(join(OUT_DIR, "m5-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
  console.log("\nM5 complete — STOP (no WritePlan execution).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
