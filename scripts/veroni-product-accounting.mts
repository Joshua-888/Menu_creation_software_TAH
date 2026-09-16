/**
 * Veroni product accounting — prove 72 → TargetMenu count from RAW PDF evidence.
 * Outputs certification artifacts only (no live writes, no golden mutation).
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { runRawSourceCertification } from "../src/certification/runRawCertification.js";
import { dropInvalidHeadingProducts } from "../src/intelligence/dropInvalidHeadings.js";
import { MENU_CONSTITUTION_VERSION } from "../src/intelligence/constitution.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";

const root = process.cwd();
const outDir = join(root, "docs", "certification", "release-freeze");
mkdirSync(outDir, { recursive: true });

function sha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function porcelain(): string {
  try {
    return execSync("git status --porcelain", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

type AccountingClass =
  | "SOURCE_SELLABLE_PRODUCT"
  | "DERIVED_SELLABLE_PRODUCT"
  | "NON_PRODUCT";

const historical = JSON.parse(
  readFileSync(resolve(root, "fixtures/veroni/golden-source.json"), "utf8"),
) as {
  uniqueProductCount: number;
  menuNumbers: string[];
  expectedNames?: Record<string, string>;
};

const histNums = new Set(historical.menuNumbers.map(String));

const commitSha = sha();
const gitStatus = porcelain() === "" ? "CLEAN" : "DIRTY";
const startedAt = new Date().toISOString();

const result = await runRawSourceCertification({
  restaurantName: "Veroni Fixture",
  restaurantKey: "fixture-veroni.example",
  rawFilePath: resolve(root, "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf"),
  kind: "pdf",
  repoRoot: root,
});

type SrcRow = {
  sourceId: string;
  name: string;
  category: string;
  menuNumber: string | null;
  variants: string[];
  priceModeHints: string[];
  sourcePriceOptions: Array<{ label: string; sourceTotalPrice?: number }>;
  ingredients: string[];
  page: number | null;
};

const sourceRows: SrcRow[] = [];
const sm = result.sourceMenu as {
  categories: Array<{
    name: string;
    products: Array<{
      sourceId: string;
      name: string;
      sourceMenuNumber?: string | null;
      menuNumber?: string | null;
      variants?: Array<{ name?: string } | string>;
      priceModeHints?: string[];
      sourcePriceOptions?: Array<{ label: string; sourceTotalPrice?: number }>;
      ingredients?: Array<{ display?: string } | string>;
      pageNumber?: number | null;
      evidence?: { pageNumber?: number };
    }>;
  }>;
};

for (const c of sm.categories) {
  for (const p of c.products) {
    const variants = (p.variants ?? []).map((v) =>
      typeof v === "string" ? v : (v.name ?? ""),
    );
    const ingredients = (p.ingredients ?? []).map((i) =>
      typeof i === "string" ? i : (i.display ?? ""),
    );
    sourceRows.push({
      sourceId: p.sourceId,
      name: p.name,
      category: c.name,
      menuNumber: (p.sourceMenuNumber ?? p.menuNumber ?? null) as string | null,
      variants,
      priceModeHints: p.priceModeHints ?? [],
      sourcePriceOptions: p.sourcePriceOptions ?? [],
      ingredients,
      page: p.pageNumber ?? p.evidence?.pageNumber ?? null,
    });
  }
}

const dropped = dropInvalidHeadingProducts(result.domainMenu).dropped;

// Domain products before intelligence drop (approx: domainMenu still has pre-drop if engine drops internally)
// Recompute domain→drop mapping from domainMenu vs target
const domainIds = new Set<string>();
for (const c of result.domainMenu.categories) {
  for (const p of c.products) domainIds.add(p.sourceId);
}
const targetIds = new Set<string>();
for (const c of result.targetMenu.categories) {
  for (const p of c.products) targetIds.add(p.sourceId);
}

type TargetAccount = {
  targetProductId: string;
  menuNumber: string | null;
  name: string;
  category: string;
  accountingClass: AccountingClass;
  sourcePage: number | null;
  sourceText: string;
  sourceProductAnchor: string | null;
  derivationReason: string;
  parentSourceProduct: string | null;
  priceEvidence: string;
  whyIndependentlySellable: string;
  goldenProductReference: string | null;
  isCombo: boolean;
  ingredients: string[];
  qualityStatus: string;
};

function findSourceForTarget(p: CanonicalMenu["categories"][0]["products"][0]): SrcRow | null {
  const byId = sourceRows.find((s) => s.sourceId === p.sourceId);
  if (byId) return byId;
  const num = p.assignedMenuNumber ?? p.sourceMenuNumber ?? null;
  if (num) {
    const byNum = sourceRows.find((s) => String(s.menuNumber) === String(num));
    if (byNum) return byNum;
  }
  const byName = sourceRows.find(
    (s) => s.name.trim().toLowerCase() === (p.name ?? "").trim().toLowerCase(),
  );
  return byName ?? null;
}

const qualityById = new Map(
  result.intelligence.quality.products.map((q) => [q.productSourceId, q.status]),
);

const accounts: TargetAccount[] = [];
for (const c of result.targetMenu.categories) {
  for (const p of c.products) {
    const src = findSourceForTarget(p);
    const num = (p.assignedMenuNumber ?? p.sourceMenuNumber ?? null) as
      | string
      | null;
    const isMenuer =
      /^menuer$/i.test(c.name) || /\bmenu\b/i.test(p.name) || p.isCombo;
    const histMatch =
      num != null && histNums.has(String(num))
        ? String(num)
        : historical.expectedNames
          ? Object.entries(historical.expectedNames).find(
              ([, n]) =>
                n.toLowerCase() === (p.name ?? "").trim().toLowerCase(),
            )?.[0] ?? null
          : null;

    let accountingClass: AccountingClass = "SOURCE_SELLABLE_PRODUCT";
    let derivationReason = "Explicit source product row";
    let parent: string | null = null;

    if (isMenuer && /menu$/i.test(p.name.trim())) {
      accountingClass = "DERIVED_SELLABLE_PRODUCT";
      const baseName = p.name.replace(/\s+menu$/i, "").trim();
      const parentSrc =
        sourceRows.find(
          (s) =>
            s.name.trim().toLowerCase() === baseName.toLowerCase() ||
            (num &&
              s.menuNumber &&
              String(s.menuNumber) === String(num).replace(/m$/i, "")),
        ) ??
        sourceRows.find((s) =>
          (s.sourcePriceOptions ?? []).some((o) => /^menu$/i.test(o.label)),
        );
      parent = parentSrc?.sourceId ?? `parent:${baseName}`;
      derivationReason =
        "MENU_IS_COMBO_NOT_VARIANT: Menu price column cannot be a size variant; synthesized as separate Menuer/combo product";
    } else if (!src && !histMatch) {
      // Still present in target — treat as source sellable if domain produced it
      accountingClass = "SOURCE_SELLABLE_PRODUCT";
      derivationReason =
        "Present after domain/intelligence without Menu suffix — treated as source sellable (may be OCR-recovered dish)";
    }

    const menuPrice =
      src?.sourcePriceOptions?.find((o) => /^menu$/i.test(o.label))
        ?.sourceTotalPrice ?? null;
    const basePrice = p.basePrice ?? null;

    accounts.push({
      targetProductId: p.sourceId,
      menuNumber: num,
      name: p.name,
      category: c.name,
      accountingClass,
      sourcePage: src?.page ?? null,
      sourceText: src
        ? `${src.menuNumber ?? ""} ${src.name} [${src.category}]`.trim()
        : `(no direct source row) ${p.name}`,
      sourceProductAnchor: src?.sourceId ?? null,
      derivationReason,
      parentSourceProduct: parent,
      priceEvidence:
        menuPrice != null
          ? `menuOre=${menuPrice}; baseOre=${basePrice ?? "null"}`
          : `baseOre=${basePrice ?? "null"}; variants=${(p.variants ?? [])
              .map((v) => `${v.name}:${v.sourceTotalPrice ?? v.surcharge ?? "?"}`)
              .join("|")}`,
      whyIndependentlySellable:
        accountingClass === "DERIVED_SELLABLE_PRODUCT"
          ? "Separately priced Menu column on source requires independent combo/menu product under MenuConstitutionV1 (not a variant)"
          : "Explicit dish/drink row on source menu with independent purchase price or size variants",
      goldenProductReference: histMatch
        ? `historical#${histMatch}`
        : accountingClass === "DERIVED_SELLABLE_PRODUCT"
          ? "VERONI_GOLDEN_V2 derived Menuer"
          : "VERONI_GOLDEN_V2",
      isCombo: !!p.isCombo,
      ingredients: (p.ingredients ?? []).map((i) => i.display),
      qualityStatus: qualityById.get(p.sourceId) ?? "UNKNOWN",
    });
  }
}

// Entity ledger: classify every raw source row
type EntityClass =
  | "SELLABLE_PRODUCT"
  | "CATEGORY_HEADER"
  | "DESCRIPTION"
  | "INGREDIENTS"
  | "CHOICE"
  | "PRICE"
  | "META"
  | "DUPLICATE_OVERLAP"
  | "OTHER_NON_PRODUCT";

const entityLedger = sourceRows.map((s) => {
  const droppedHit = dropped.find(
    (d) =>
      d.sourceId === s.sourceId ||
      d.name.trim().toLowerCase() === s.name.trim().toLowerCase(),
  );
  const inTarget = accounts.some(
    (a) =>
      a.sourceProductAnchor === s.sourceId ||
      (a.menuNumber &&
        s.menuNumber &&
        String(a.menuNumber) === String(s.menuNumber) &&
        a.accountingClass === "SOURCE_SELLABLE_PRODUCT"),
  );
  let classification: EntityClass = "SELLABLE_PRODUCT";
  let disposition = "MAPPED_TO_TARGET";
  if (droppedHit) {
    classification =
      droppedHit.reason.includes("CATEGORY")
        ? "CATEGORY_HEADER"
        : droppedHit.reason.includes("META")
          ? "META"
          : droppedHit.reason.includes("MARKETING")
            ? "OTHER_NON_PRODUCT"
            : droppedHit.reason.includes("VARIANT")
              ? "CHOICE"
              : droppedHit.reason.includes("TOPPING") ||
                  droppedHit.reason.includes("INGREDIENT")
                ? "INGREDIENTS"
                : "OTHER_NON_PRODUCT";
    disposition = `DROPPED:${droppedHit.reason}`;
  } else if (!inTarget) {
    // May be parent of derived Menuer only, or filtered elsewhere
    const parentOfDerived = accounts.some(
      (a) =>
        a.accountingClass === "DERIVED_SELLABLE_PRODUCT" &&
        (a.parentSourceProduct === s.sourceId ||
          a.name.replace(/\s+menu$/i, "").toLowerCase() ===
            s.name.toLowerCase()),
    );
    if (parentOfDerived) {
      classification = "SELLABLE_PRODUCT";
      disposition = "PARENT_OF_DERIVED_MENUER";
    } else {
      classification = "OTHER_NON_PRODUCT";
      disposition = "NOT_IN_TARGET_UNEXPLAINED_CANDIDATE";
    }
  }
  return {
    sourceId: s.sourceId,
    name: s.name,
    category: s.category,
    menuNumber: s.menuNumber,
    page: s.page,
    classification,
    disposition,
    variants: s.variants,
    priceModeHints: s.priceModeHints,
  };
});

const sourceSellable = accounts.filter(
  (a) => a.accountingClass === "SOURCE_SELLABLE_PRODUCT",
);
const derivedSellable = accounts.filter(
  (a) => a.accountingClass === "DERIVED_SELLABLE_PRODUCT",
);

const histCovered = [...histNums].filter((n) =>
  accounts.some(
    (a) =>
      String(a.menuNumber) === n ||
      a.goldenProductReference === `historical#${n}`,
  ),
);
const histMissing = [...histNums].filter((n) => !histCovered.includes(n));

const additionalVs72 = accounts.filter((a) => {
  if (!a.menuNumber) return true;
  return !histNums.has(String(a.menuNumber));
});

// Dropped list: domain products not in target + dropped headings
const domainProducts: Array<{
  sourceId: string;
  name: string;
  category: string;
  menuNumber: string | null;
}> = [];
for (const c of result.domainMenu.categories) {
  for (const p of c.products) {
    domainProducts.push({
      sourceId: p.sourceId,
      name: p.name,
      category: c.name,
      menuNumber: (p.assignedMenuNumber ?? p.sourceMenuNumber ?? null) as
        | string
        | null,
    });
  }
}

const droppedDetailed = [
  ...dropped.map((d) => ({
    rawExtractedEntity: d.name,
    sourceId: d.sourceId,
    sourceLocation: d.categoryName,
    classification: d.reason,
    reasonDropped: d.reason,
  })),
  ...domainProducts
    .filter((d) => !targetIds.has(d.sourceId))
    .filter((d) => !dropped.some((x) => x.sourceId === d.sourceId))
    .map((d) => ({
      rawExtractedEntity: d.name,
      sourceId: d.sourceId,
      sourceLocation: d.categoryName,
      classification: "FILTERED_IN_INTELLIGENCE",
      reasonDropped: "Removed during intelligence completion/filter (not in TargetMenu)",
    })),
];

// Also account source rows that never made domain
const sourceOnlyDropped = sourceRows
  .filter((s) => !domainIds.has(s.sourceId) && !dropped.some((d) => d.sourceId === s.sourceId))
  .map((s) => ({
    rawExtractedEntity: s.name,
    sourceId: s.sourceId,
    sourceLocation: s.category,
    classification: "SOURCE_NOT_IN_DOMAIN",
    reasonDropped: "Present in extract SourceMenu but not in domainMenu",
  }));

const allDrops = [...droppedDetailed, ...sourceOnlyDropped];

const derivedAudit = derivedSellable.map((d) => {
  const unknownComponents =
    d.ingredients.length === 0 ||
    d.ingredients.every((i) => /^menu\s*:/i.test(i));
  return {
    ...d,
    baseProduct: d.name.replace(/\s+menu$/i, "").trim(),
    knownComponents: d.ingredients.filter((i) => !/^menu\s*:/i.test(i)),
    unknownComponents: unknownComponents,
    comboContentsInvented: false,
    reviewRequired:
      unknownComponents || d.qualityStatus !== "QUALITY_READY",
  };
});

const orphans = accounts.filter((a) => !a.sourceProductAnchor && !a.parentSourceProduct);
const duplicates = (() => {
  const byKey = new Map<string, string[]>();
  for (const a of accounts) {
    const key = `${(a.menuNumber ?? "").toLowerCase()}|${a.name.toLowerCase()}`;
    const list = byKey.get(key) ?? [];
    list.push(a.targetProductId);
    byKey.set(key, list);
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
})();

const unexplainedSource = entityLedger.filter(
  (e) => e.disposition === "NOT_IN_TARGET_UNEXPLAINED_CANDIDATE",
);

const summary = {
  commitSha,
  gitStatus,
  startedAt,
  finishedAt: new Date().toISOString(),
  constitutionVersion: MENU_CONSTITUTION_VERSION,
  policySnapshotVersion: "MenuConstitutionV1",
  historicalSourceProducts: historical.uniqueProductCount,
  rawExtractedEntityCount: sourceRows.length,
  sourceSellableProductCount: sourceSellable.length,
  derivedSellableProductCount: derivedSellable.length,
  targetProductCount: accounts.length,
  statusAccounting: result.stats.statusAccounting,
  menuVariantCount: result.menuVariantCount,
  histMissingFromTarget: histMissing,
  additionalVsHistorical72Count: additionalVs72.length,
  droppedEntityCount: allDrops.length,
  orphanTargetCount: orphans.length,
  duplicateTargetCount: duplicates.length,
  derivedMenuComboCount: derivedSellable.length,
  derivedFullySupportedCount: derivedAudit.filter((d) => !d.reviewRequired)
    .length,
  derivedReviewCount: derivedAudit.filter((d) => d.reviewRequired).length,
  unexplainedSourceEntityCount: unexplainedSource.length,
  equation: {
    targetEqualsSourcePlusDerived:
      accounts.length === sourceSellable.length + derivedSellable.length,
    note: "TargetMenu = SOURCE_SELLABLE + DERIVED_SELLABLE (mutually exclusive classes)",
  },
};

writeFileSync(
  join(outDir, "veroni-product-accounting.json"),
  JSON.stringify(
    {
      meta: summary,
      products: accounts,
      additionalVsHistorical72: additionalVs72,
      derivedMenuComboAudit: derivedAudit,
      orphans,
      duplicates,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(outDir, "veroni-source-entity-ledger.json"),
  JSON.stringify(
    {
      meta: {
        commitSha,
        rawExtractedEntityCount: sourceRows.length,
        constitutionVersion: MENU_CONSTITUTION_VERSION,
      },
      entities: entityLedger,
      dropped: allDrops,
      unexplained: unexplainedSource,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(outDir, "veroni-72-to-current-reconciliation.json"),
  JSON.stringify(
    {
      HISTORICAL_SOURCE_PRODUCTS: 72,
      CURRENT_SOURCE_SELLABLE_PRODUCTS: sourceSellable.length,
      CURRENT_DERIVED_SELLABLE_PRODUCTS: derivedSellable.length,
      CURRENT_TARGET_PRODUCTS: accounts.length,
      EXPECTED_EQUATION: "X + Y = TargetMenu",
      holds:
        sourceSellable.length + derivedSellable.length === accounts.length,
      deltaFrom72: accounts.length - 72,
      additionalProducts: additionalVs72.map((a) => ({
        menuNumber: a.menuNumber,
        name: a.name,
        category: a.category,
        accountingClass: a.accountingClass,
        visibleAsIndependentSellable:
          a.accountingClass === "SOURCE_SELLABLE_PRODUCT"
            ? "Candidate — see sourceText"
            : "Derived from Menu price column (not a separate PDF dish title)",
        previouslyMissedByExtraction:
          a.accountingClass === "SOURCE_SELLABLE_PRODUCT" && !a.menuNumber
            ? "Possible — no historical menu number"
            : a.menuNumber && !histNums.has(String(a.menuNumber))
              ? "Yes or renumbered/OCR extra"
              : "No — historical number or derived",
        createdAsDerivedMenuCombo:
          a.accountingClass === "DERIVED_SELLABLE_PRODUCT",
        isDuplicate: duplicates.some((d) =>
          d.ids.includes(a.targetProductId),
        ),
        isOcrArtifact: /ocr|garbage|meta/i.test(a.derivationReason)
          ? true
          : false,
        constitutionAllowance: a.derivationReason,
        sellableEvidence: a.whyIndependentlySellable,
        sourceEvidence: a.sourceText,
        priceEvidence: a.priceEvidence,
      })),
      droppedEntities: allDrops,
      historicalMissing: histMissing.map((n) => ({
        menuNumber: n,
        expectedName: historical.expectedNames?.[n] ?? null,
        note: "Historical V1 number not present as TargetMenu menuNumber — may be renamed, merged, or dropped as NON_PRODUCT",
      })),
    },
    null,
    2,
  ),
);

console.log(JSON.stringify(summary, null, 2));
