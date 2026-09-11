/**
 * M5R3 — vision/rendered-page correction pass (READ-ONLY against TAH).
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
import { consolidateHumanReview } from "../src/review/consolidate.js";
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

const PDF_PATH = resolve("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const OUT_DIR = resolve("runs/m5r3-veroni");
const HOST = "veronipizza.dk";
const AUTH = "playwright/.auth/tah-admin-veroni.json";

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function statusCounts(menu: {
  categories: Array<{ products: Array<{ status: string; sourceMenuNumber?: string; name: string }> }>;
}): Record<string, unknown> {
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
      lists[p.status]?.push(`${p.sourceMenuNumber ?? "?"} ${p.name}`);
    }
  }
  return { ...c, lists };
}

async function discoverDestinationReadonly() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: existsSync(AUTH) ? AUTH : undefined,
  });
  const page = await context.newPage();
  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: `https://${HOST}`,
    host: HOST,
  });
  await page.goto(`https://${HOST}/admin`, { waitUntil: "domcontentloaded" });
  const categories = await adapter.listCategories();
  const products = await adapter.listProducts();
  await browser.close();
  return { categories, products };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
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
  const byNum = Object.fromEntries(products.map((p) => [p.menuNumber, p]));
  const canonByNum = new Map(
    domain.menu.categories.flatMap((c) =>
      c.products.map((p) => [
        p.sourceMenuNumber ?? p.assignedMenuNumber ?? "",
        p,
      ]),
    ),
  );

  const p43 = byNum["43"];
  const c43 = canonByNum.get("43");
  const p34 = byNum["34"];
  const c34 = canonByNum.get("34");
  const p65 = byNum["65"];
  const c65 = canonByNum.get("65");

  const almFam = products.filter(
    (p) => p.variants.includes("Alm.") && p.variants.includes("Familie"),
  );
  const baseMenu = products.filter((p) => p.priceModeHints.includes("Menu"));
  const lilleStor = products.filter(
    (p) => p.variants.includes("Lille") && p.variants.includes("Stor"),
  );

  const auditRows = golden.menuNumbers.map((n) => {
    const sp = extracted.sourceMenu.categories
      .flatMap((c) => c.products.map((p) => ({ cat: c.name, p })))
      .find((x) => x.p.sourceMenuNumber === n);
    const cp = canonByNum.get(n);
    return {
      menuNumber: n,
      name: sp?.p.name ?? "",
      sourceSection: sp?.cat ?? "",
      canonicalBasePrice: cp?.basePrice ?? null,
      variants: (sp?.p.variants ?? []).map((v) => ({
        name: v.name,
        ore: v.sourceTotalPrice,
      })),
      sourcePriceOptions: sp?.p.sourcePriceOptions ?? [],
      validationStatus: cp?.status ?? "MISSING",
      validationIssueCodes: (cp?.issues ?? []).map((i) => i.code),
    };
  });
  writeJson(join(OUT_DIR, "product-audit-72.json"), {
    pass: auditRows.length === 72 && gate.pass,
    rowCount: auditRows.length,
    rows: auditRows,
  });

  console.log("M5R3 destination discovery (READ-ONLY)...");
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
      name: c.name
        .replace(/^INDISK\s*\/\s*/i, "Indisk")
        .replace(/^INDISK$/i, "Indisk"),
    })),
    destination.categories,
  ).map((m, i) => ({
    ...m,
    sourceCategoryName: domain.menu.categories[i]?.name ?? m.sourceCategoryName,
  }));

  const productMappings = ["36", "37", "38"].map((n) => {
    const p = byNum[n];
    return mapProductToDestinationCategory(
      {
        menuNumber: n,
        name: p?.name ?? "",
        sourceCategoryName: p?.section ?? "UNLABELLED_PAGE5_36_38",
      },
      destination.categories,
    );
  });
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
  const consolidated = consolidateHumanReview({
    sourceMenu: extracted.sourceMenu,
    canonical: domain.menu,
    items: humanReview.items,
  });
  writeJson(join(OUT_DIR, "human-review-consolidated.json"), consolidated);

  const fp = buildAdminContractFingerprint(TAH_V1_STRUCTURE_FINGERPRINT_INPUT);
  const dryPlan = buildDryRunWritePlan({
    runId: `m5r3-veroni-${new Date().toISOString().slice(0, 10)}`,
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
  const sourceActions = summarizeSourceDryRun(dryPlan);
  const statuses = statusCounts(domain.menu);

  const menuOk =
    baseMenu.length === 7 &&
    p43?.priceModeHints.includes("Menu") &&
    (p43?.variants.includes("Menu") ?? false);
  const blockedCount = (statuses.BLOCKED as number) ?? 0;

  const report = {
    title: "M5R3 FINAL VERONI SOURCE CERTIFICATION",
    uniqueProducts: gate.uniqueProductCount,
    BLOCKED: blockedCount,
    READY: statuses.READY,
    WARNING: statuses.WARNING,
    MANUAL_REVIEW_REQUIRED: statuses.MANUAL_REVIEW_REQUIRED,
    product43: {
      name: p43?.name,
      opts: extracted.sourceMenu.categories
        .flatMap((c) => c.products)
        .find((p) => p.sourceMenuNumber === "43")?.sourcePriceOptions,
      basePrice: c43?.basePrice,
      menuSurcharge: c43?.variants.find((v) => v.name === "Menu")?.surcharge,
      status: c43?.status,
    },
    baseMenuCount: baseMenu.length,
    baseMenuNumbers: baseMenu.map((p) => p.menuNumber),
    product34: {
      name: p34?.name,
      priceOre: extracted.sourceMenu.categories
        .flatMap((c) => c.products)
        .find((p) => p.sourceMenuNumber === "34")
        ?.variants[0]?.sourceTotalPrice,
      status: c34?.status,
    },
    product65: {
      name: p65?.name,
      priceOre: extracted.sourceMenu.categories
        .flatMap((c) => c.products)
        .find((p) => p.sourceMenuNumber === "65")
        ?.variants[0]?.sourceTotalPrice,
      status: c65?.status,
    },
    almFamilieCount: almFam.length,
    lilleStorCount: lilleStor.length,
    consolidatedDecisions: consolidated.counts.decisions,
    sourceDryRunActions: sourceActions,
    statusLists: statuses.lists,
    READY_FOR_HUMAN_REVIEW:
      gate.pass &&
      menuOk &&
      blockedCount === 0 &&
      almFam.length === 29 &&
      lilleStor.length === 1 &&
      sourceActions.total === 72 &&
      (p34?.name ?? "").includes("Alfredo") &&
      (p65?.name ?? "") === "Øl"
        ? "YES"
        : "NO",
    note: "NO LIVE WRITE — dry-run only; executor not bound",
  };
  writeJson(join(OUT_DIR, "m5r3-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
