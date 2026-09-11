/**
 * M5R2 — Veroni final source audit (READ-ONLY against TAH).
 * Regenerates SourceMenu / CanonicalMenu via full pipeline.
 * NO live writes / import / publish / executor bind.
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

const PDF_PATH = resolve(
  process.argv[2] ?? "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const OUT_DIR = resolve("runs/m5r2-veroni");
const HOST = "veronipizza.dk";
const BASE_URL = `https://${HOST}`;
const AUTH = "playwright/.auth/tah-admin-veroni.json";

const ALM_FAM_EXPECTED = [
  ...Array.from({ length: 21 }, (_, i) => String(i + 1)),
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "32b",
  "32C",
];
const BASE_MENU_EXPECTED = ["36", "37", "39", "40", "41", "42", "43"];

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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: existsSync(AUTH) ? AUTH : undefined,
  });
  const page = await context.newPage();
  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: BASE_URL,
    host: HOST,
  });
  await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
  const categories = await adapter.listCategories();
  const products = await adapter.listProducts();
  await browser.close();
  return { categories, products };
}

function oreToKr(ore: number | undefined): number | null {
  if (ore === undefined) return null;
  return ore / 100;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("M5R2 extraction (deterministic pipeline)...");
  const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
  const extracted = await adapter.extractDetailed({
    kind: "pdf",
    filePath: PDF_PATH,
  });
  writeJson(join(OUT_DIR, "source-menu.json"), extracted.sourceMenu);
  writeJson(join(OUT_DIR, "source-accounting.json"), extracted.accounting);

  const golden = loadVeroniGoldenFixture();
  const gate = reconcileAgainstGolden(extracted.sourceMenu, golden);
  writeJson(join(OUT_DIR, "menu-number-reconciliation.json"), {
    uniqueProductCount: gate.uniqueProductCount,
    expected: 72,
    pass: gate.pass,
    missing: gate.missing,
    extra: gate.extra,
    structuralIssues: gate.structuralIssues,
    sectionIssues: gate.sectionIssues,
    rows: gate.rows,
  });

  const domain = runDomainEngine(extracted.sourceMenu);
  writeJson(join(OUT_DIR, "canonical-menu.json"), domain.menu);
  writeJson(join(OUT_DIR, "validation-report.json"), domain.validation);

  // --- 72-row product audit ---
  const sourceByNum = new Map(
    extracted.sourceMenu.categories.flatMap((c) =>
      c.products.map((p) => [
        p.sourceMenuNumber ?? "",
        { cat: c.name, product: p },
      ]),
    ),
  );
  const canonByNum = new Map(
    domain.menu.categories.flatMap((c) =>
      c.products.map((p) => [
        p.sourceMenuNumber ?? p.assignedMenuNumber ?? "",
        { cat: c.name, product: p },
      ]),
    ),
  );

  const auditRows = [];
  for (const n of golden.menuNumbers) {
    const src = sourceByNum.get(n);
    const can = canonByNum.get(n);
    const sp = src?.product;
    const cp = can?.product;
    const issues = (cp?.issues ?? []).map((i) => i.code);
    let validationStatus = cp?.status ?? "MISSING";
    const validationIssueCodes = [...issues];
    if (!sp) {
      validationStatus = "MISSING";
      validationIssueCodes.push("SOURCE_PRODUCT_MISSING");
    }
    auditRows.push({
      menuNumber: n,
      name: sp?.name ?? cp?.name ?? golden.expectedNames[n] ?? "",
      sourcePage: sp?.evidence?.pageNumber ?? null,
      sourceSection: src?.cat ?? "",
      descriptionIngredients: (sp?.ingredients ?? [])
        .map((i) => i.display)
        .join(", "),
      rawPriceStructure: {
        variants: (sp?.variants ?? []).map((v) => ({
          name: v.name,
          sourceTotalPriceOre: v.sourceTotalPrice,
        })),
        sourcePriceOptions: sp?.sourcePriceOptions ?? [],
      },
      rawVariantsOptions: {
        variants: (sp?.variants ?? []).map((v) => v.name),
        choices: (sp?.productChoices ?? []).map((c) => c.prompt),
        addOns: (sp?.addOns ?? []).map((a) => a.name),
      },
      canonicalBasePrice: cp?.basePrice ?? null,
      canonicalVariants: (cp?.variants ?? []).map((v) => ({
        name: v.name,
        surcharge: v.surcharge,
      })),
      canonicalAdditions: (cp?.addOns ?? []).map((a) => a.name),
      canonicalCategoryCandidate: can?.cat ?? src?.cat ?? "",
      validationStatus,
      validationIssueCodes,
    });
  }

  const auditPass =
    auditRows.length === 72 &&
    gate.pass &&
    new Set(auditRows.map((r) => r.menuNumber)).size === 72;
  writeJson(join(OUT_DIR, "product-audit-72.json"), {
    pass: auditPass,
    rowCount: auditRows.length,
    uniqueMenuNumbers: new Set(auditRows.map((r) => r.menuNumber)).size,
    rows: auditRows,
  });

  // --- Alm./Familie reconciliation ---
  const almFamRows = [];
  const almFamDiscrepancies: string[] = [];
  for (const n of ALM_FAM_EXPECTED) {
    const can = canonByNum.get(n)?.product;
    const src = sourceByNum.get(n)?.product;
    const alm = src?.variants.find((v) => /^alm/i.test(v.name));
    const fam = src?.variants.find((v) => /^familie/i.test(v.name));
    const base = can?.basePrice;
    const almSur =
      can?.variants.find((v) => /^alm/i.test(v.name))?.surcharge ?? null;
    const famSur =
      can?.variants.find((v) => /^familie/i.test(v.name))?.surcharge ?? null;
    const almTotal = alm?.sourceTotalPrice;
    const famTotal = fam?.sourceTotalPrice;
    const ok =
      almTotal !== undefined &&
      famTotal !== undefined &&
      base === almTotal &&
      almSur === 0 &&
      base !== undefined &&
      famSur !== null &&
      base + famSur === famTotal;
    if (!ok) {
      almFamDiscrepancies.push(
        `#${n} name=${src?.name ?? "?"} alm=${oreToKr(almTotal)} fam=${oreToKr(famTotal)} base=${oreToKr(base ?? undefined)} almSur=${oreToKr(almSur ?? undefined)} famSur=${oreToKr(famSur ?? undefined)}`,
      );
    }
    almFamRows.push({
      menuNumber: n,
      name: src?.name ?? "",
      almTotalPrice: oreToKr(almTotal),
      familieTotalPrice: oreToKr(famTotal),
      canonicalBasePrice: oreToKr(base ?? undefined),
      canonicalAlmSurcharge: oreToKr(almSur ?? undefined),
      canonicalFamilieSurcharge: oreToKr(famSur ?? undefined),
      ok,
    });
  }
  writeJson(join(OUT_DIR, "alm-familie-reconciliation.json"), {
    expectedCount: 29,
    actualWithBothVariants: almFamRows.filter((r) => r.ok).length,
    rows: almFamRows,
    discrepancies: almFamDiscrepancies,
    pass: almFamDiscrepancies.length === 0,
  });

  // --- BASE+Menu reconciliation ---
  const menuRows = [];
  const menuDisc: string[] = [];
  for (const n of BASE_MENU_EXPECTED) {
    const src = sourceByNum.get(n)?.product;
    const opts = src?.sourcePriceOptions ?? [];
    const base = opts.find((o) => o.label === "BASE");
    const menu = opts.find((o) => o.label === "Menu");
    const ok =
      base?.sourceTotalPrice !== undefined &&
      menu?.sourceTotalPrice !== undefined;
    if (!ok) {
      menuDisc.push(
        `#${n} name=${src?.name ?? "?"} opts=${JSON.stringify(opts)} variants=${JSON.stringify(src?.variants.map((v) => [v.name, v.sourceTotalPrice]))}`,
      );
    }
    menuRows.push({
      menuNumber: n,
      name: src?.name ?? "",
      baseOre: base?.sourceTotalPrice ?? null,
      menuOre: menu?.sourceTotalPrice ?? null,
      ok,
    });
  }
  writeJson(join(OUT_DIR, "base-menu-reconciliation.json"), {
    expectedCount: 7,
    actualWithBoth: menuRows.filter((r) => r.ok).length,
    rows: menuRows,
    discrepancies: menuDisc,
    pass: menuDisc.length === 0,
  });

  console.log("M5R2 destination discovery (READ-ONLY)...");
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
  );
  const mappingsWithSourceNames = categoryMappings.map((m, i) => ({
    ...m,
    sourceCategoryName: domain.menu.categories[i]?.name ?? m.sourceCategoryName,
  }));

  const productMappings = ["36", "37", "38"].map((n) => {
    const p = sourceByNum.get(n);
    return mapProductToDestinationCategory(
      {
        menuNumber: n,
        name: p?.product.name ?? "",
        sourceCategoryName: p?.cat ?? "UNLABELLED_PAGE5_36_38",
      },
      destination.categories,
    );
  });
  writeJson(join(OUT_DIR, "category-mapping.json"), {
    categoryMappings: mappingsWithSourceNames,
    productLevelMappings: productMappings,
  });

  const humanReview = buildHumanReviewReport({
    canonical: domain.menu,
    validation: domain.validation,
    accounting: extracted.accounting,
    categoryMappings: mappingsWithSourceNames,
  });
  writeJson(join(OUT_DIR, "human-review.json"), humanReview);

  const consolidated = consolidateHumanReview({
    sourceMenu: extracted.sourceMenu,
    canonical: domain.menu,
    items: humanReview.items,
  });
  writeJson(join(OUT_DIR, "human-review-consolidated.json"), consolidated);

  const consolidatedTable = consolidated.decisions
    .map(
      (d) =>
        `| ${d.menuNumber} | ${d.productName} | ${d.exactAmbiguity.replace(/\|/g, "/")} | ${d.recommendedOptions[0] ?? ""} |`,
    )
    .join("\n");
  writeFileSync(
    join(OUT_DIR, "human-review-consolidated.md"),
    `# Consolidated human review\n\n| # | Product | Ambiguity | Recommended |\n|---|---|---|---|\n${consolidatedTable}\n`,
    "utf8",
  );

  const fp = buildAdminContractFingerprint(TAH_V1_STRUCTURE_FINGERPRINT_INPUT);
  const dryPlan = buildDryRunWritePlan({
    runId: `m5r2-veroni-${new Date().toISOString().slice(0, 10)}`,
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

  const sourceActions = summarizeSourceDryRun(dryPlan);
  const statuses = statusCounts(domain.menu);
  const products = listSourceProducts(extracted.sourceMenu);
  const almFamCount = products.filter(
    (p) => p.variants.includes("Alm.") && p.variants.includes("Familie"),
  ).length;
  const baseMenuCount = products.filter((p) =>
    p.priceModeHints.includes("Menu"),
  ).length;
  const p48 = products.find((p) => p.menuNumber === "48");
  const p48can = canonByNum.get("48")?.product;

  const pastaMissing = mappingsWithSourceNames.some(
    (m) =>
      m.sourceCategoryName === "Pasta" &&
      m.outcome === "MISSING_DESTINATION_CATEGORY",
  );
  const unlabelledMissing = mappingsWithSourceNames.some(
    (m) =>
      /^UNLABELLED/i.test(m.sourceCategoryName) &&
      m.outcome === "MISSING_DESTINATION_CATEGORY",
  );

  const report = {
    title: "M5R2 VERONI FINAL SOURCE AUDIT",
    uniqueProducts: gate.uniqueProductCount,
    audit72: auditPass ? "PASS" : "FAIL",
    almFamilieCount: almFamCount,
    almFamilieExpected: 29,
    almFamilieReconciliation: almFamDiscrepancies.length === 0 ? "PASS" : "FAIL",
    almFamilieDiscrepancies: almFamDiscrepancies,
    baseMenuCount,
    baseMenuExpected: 7,
    baseMenuReconciliation: menuDisc.length === 0 ? "PASS" : "FAIL",
    baseMenuDiscrepancies: menuDisc,
    lilleStor: {
      onlyProduct48: products.filter(
        (p) => p.variants.includes("Lille") && p.variants.includes("Stor"),
      ).length === 1,
      product48: {
        name: p48?.name,
        variants: p48?.variants,
        lilleOre: p48can?.variants.find((v) => v.name === "Lille")
          ? (p48can.basePrice ?? 0)
          : null,
        storSurcharge: p48can?.variants.find((v) => v.name === "Stor")
          ?.surcharge,
        totals: sourceByNum.get("48")?.product.variants.map((v) => ({
          name: v.name,
          ore: v.sourceTotalPrice,
        })),
      },
    },
    sourceSections: extracted.sourceMenu.categories.map((c) => ({
      name: c.name,
      count: c.products.length,
    })),
    destinationCategoryMapping: mappingsWithSourceNames.map((m) => ({
      source: m.sourceCategoryName,
      outcome: m.outcome,
      destination: m.destinationCategoryName ?? null,
    })),
    product36: productMappings[0],
    product37: productMappings[1],
    product38: productMappings[2],
    pastaCategoryStatus: pastaMissing
      ? "MISSING_DESTINATION_CATEGORY"
      : "MAPPED_OR_ABSENT",
    unlabelledAsMissingDestination: unlabelledMissing,
    statuses,
    consolidatedDecisions: consolidated.counts.decisions,
    sourceDryRunActions: sourceActions,
    READY_FOR_HUMAN_REVIEW:
      gate.pass &&
      auditPass &&
      almFamDiscrepancies.length === 0 &&
      menuDisc.length === 0 &&
      sourceActions.total === 72 &&
      !unlabelledMissing
        ? "YES"
        : "NO",
    blockersForHumanReviewGate: [
      ...(almFamDiscrepancies.length
        ? [`Alm./Familie discrepancies: ${almFamDiscrepancies.length}`]
        : []),
      ...(menuDisc.length
        ? [`BASE+Menu discrepancies: ${menuDisc.join("; ")}`]
        : []),
      ...(sourceActions.total !== 72
        ? [`source action total ${sourceActions.total} != 72`]
        : []),
      ...(unlabelledMissing
        ? ["UNLABELLED placeholder incorrectly flagged MISSING_DESTINATION_CATEGORY"]
        : []),
    ],
    note: "NO LIVE WRITE — dry-run only; executor not bound",
  };
  writeJson(join(OUT_DIR, "m5r2-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
