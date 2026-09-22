/**
 * Portal menu-view helpers — pure presentation derivations for the /jobs/[id]
 * TargetMenu browser.
 *
 * Display-only: no business logic, no price arithmetic beyond formatting, no
 * mutation, no client persistence. Values are shown exactly as computed by the
 * domain/intelligence spine.
 */

import type {
  CanonicalMenu,
  CanonicalProduct,
} from "../domain/schema/canonical.js";
import type { SourceMenu, SourceProduct } from "../domain/schema/source.js";
import type { SourceEvidence } from "../domain/evidence.js";
import type { ValueOrigin } from "../domain/provenance.js";
import type { ValidationStatus } from "../domain/status.js";
import type {
  MenuQualityContractResult,
  MenuQualityStatus,
  ProductQualityResult,
  QualityStatus,
} from "../intelligence/types.js";

/** Coarse display bucket derived from existing status enums (never invented). */
// Re-export the canonical input types consumed by the menu-view components so
// the portal UI has a single, stable import surface for this view.
export type { CanonicalMenu } from "../domain/schema/canonical.js";
export type { SourceMenu } from "../domain/schema/source.js";
export type { MenuQualityContractResult } from "../intelligence/types.js";

export type MenuDisplayStatus = "READY" | "REVIEW" | "BLOCKED";

export type MenuStatusFilter = "ALL" | MenuDisplayStatus;

export type BadgeTone = "ok" | "warn" | "danger" | "neutral";

/**
 * Exact øre → DKK display. Integer minor units only; the value is never
 * recomputed — 12500 renders as "125,00 kr.".
 */
export function formatDkk(ore: number | null | undefined): string {
  if (ore == null || !Number.isFinite(ore)) return "—";
  return `${(ore / 100).toFixed(2).replace(".", ",")} kr.`;
}

/** Human label for the existing `ValueOrigin` enum. */
export function originLabel(origin: ValueOrigin | null | undefined): string {
  switch (origin) {
    case "SOURCE":
      return "Source";
    case "DERIVED":
      return "Derived";
    case "SYSTEM_DEFAULT":
      return "System default";
    case "HUMAN_CORRECTION":
      return "Human correction";
    default:
      return "Unknown";
  }
}

export function displayStatusLabel(status: MenuDisplayStatus): string {
  if (status === "READY") return "Ready";
  if (status === "BLOCKED") return "Blocked";
  return "Needs review";
}

export function displayStatusTone(status: MenuDisplayStatus): BadgeTone {
  if (status === "READY") return "ok";
  if (status === "BLOCKED") return "danger";
  return "warn";
}

/** Canonical domain status → display bucket. WARNING stays review-signal. */
export function validationStatusToDisplay(
  status: ValidationStatus,
): MenuDisplayStatus {
  if (status === "READY") return "READY";
  if (status === "BLOCKED") return "BLOCKED";
  return "REVIEW";
}

/** Quality contract status → display bucket. */
export function qualityStatusToDisplay(status: QualityStatus): MenuDisplayStatus {
  if (status === "QUALITY_READY") return "READY";
  if (status === "QUALITY_BLOCKED") return "BLOCKED";
  return "REVIEW";
}

/**
 * Effective product display status. The quality contract wins when present
 * (it is the exported quality decision); otherwise the canonical product
 * status is used, which keeps older jobs without a contract renderable.
 */
export function productDisplayStatus(
  product: Pick<CanonicalProduct, "status">,
  quality: ProductQualityResult | null,
): MenuDisplayStatus {
  if (quality) return qualityStatusToDisplay(quality.status);
  return validationStatusToDisplay(product.status);
}

export function menuQualityLabel(
  status: MenuQualityStatus | null | undefined,
): string {
  if (status === "MENU_QUALITY_READY") return "Menu ready";
  if (status === "MENU_QUALITY_BLOCKED") return "Menu blocked";
  if (status === "MENU_QUALITY_REVIEW") return "Menu needs review";
  return "Quality unknown";
}

export function menuQualityTone(
  status: MenuQualityStatus | null | undefined,
): BadgeTone {
  if (status === "MENU_QUALITY_READY") return "ok";
  if (status === "MENU_QUALITY_BLOCKED") return "danger";
  if (status === "MENU_QUALITY_REVIEW") return "warn";
  return "neutral";
}

/** Displayed menu number — assigned wins over source; null when absent. */
export function menuNumberLabel(product: CanonicalProduct): string | null {
  const number = product.assignedMenuNumber ?? product.sourceMenuNumber;
  return number && number.trim().length > 0 ? number : null;
}

/** Search across name, both menu numbers, description and ingredients. */
export function productMatchesQuery(
  product: CanonicalProduct,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = [
    product.name,
    product.assignedMenuNumber ?? "",
    product.sourceMenuNumber ?? "",
    product.description ?? "",
    ...product.ingredients.map((ingredient) => ingredient.display),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

export function productMatchesFilter(
  status: MenuDisplayStatus,
  filter: MenuStatusFilter,
): boolean {
  return filter === "ALL" || filter === status;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Lookup index over a SourceMenu — stable `sourceId` first, name fallback. */
export type SourceProductIndex = {
  byId: Map<string, SourceProduct>;
  byName: Map<string, SourceProduct[]>;
};

export function buildSourceProductIndex(
  sourceMenu: SourceMenu | null,
): SourceProductIndex {
  const byId = new Map<string, SourceProduct>();
  const byName = new Map<string, SourceProduct[]>();
  for (const category of sourceMenu?.categories ?? []) {
    for (const product of category.products ?? []) {
      byId.set(product.sourceId, product);
      const key = normalizeName(product.name);
      const bucket = byName.get(key);
      if (bucket) {
        bucket.push(product);
      } else {
        byName.set(key, [product]);
      }
    }
  }
  return { byId, byName };
}

/**
 * Match a canonical product back to its source product using stable identity:
 * exact `sourceId`, then menu number + name, then an unambiguous name match.
 * Ambiguous matches resolve to null — the UI never guesses provenance.
 */
export function lookupSourceProduct(
  index: SourceProductIndex,
  product: CanonicalProduct,
): SourceProduct | null {
  const direct = index.byId.get(product.sourceId);
  if (direct) return direct;
  const candidates = index.byName.get(normalizeName(product.name)) ?? [];
  if (candidates.length === 0) return null;
  if (product.sourceMenuNumber) {
    const numbered = candidates.find(
      (candidate) => candidate.sourceMenuNumber === product.sourceMenuNumber,
    );
    if (numbered) return numbered;
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

export type MenuProductView = {
  product: CanonicalProduct;
  quality: ProductQualityResult | null;
  status: MenuDisplayStatus;
  statusLabel: string;
  tone: BadgeTone;
  menuNumber: string | null;
  priceLabel: string;
  sourceProduct: SourceProduct | null;
};

export type MenuCategoryView = {
  sourceId: string;
  name: string;
  productCount: number;
  statusCounts: Record<MenuDisplayStatus, number>;
  products: MenuProductView[];
};

function indexQualityProducts(
  contract: MenuQualityContractResult | null,
): Map<string, ProductQualityResult> {
  const map = new Map<string, ProductQualityResult>();
  for (const product of contract?.products ?? []) {
    map.set(product.productSourceId, product);
  }
  return map;
}

function emptyStatusCounts(): Record<MenuDisplayStatus, number> {
  return { READY: 0, REVIEW: 0, BLOCKED: 0 };
}

/**
 * Derive the category → product render tree for a TargetMenu, applying the
 * search/filter state. Category headers keep the counts of the full category;
 * filtered-out categories are dropped so the tree stays readable.
 */
export function buildMenuSections({
  targetMenu,
  qualityContract,
  sourceMenu,
  query,
  statusFilter,
}: {
  targetMenu: CanonicalMenu | null;
  qualityContract: MenuQualityContractResult | null;
  sourceMenu: SourceMenu | null;
  query?: string;
  statusFilter?: MenuStatusFilter;
}): MenuCategoryView[] {
  if (!targetMenu) return [];
  const qualityByProduct = indexQualityProducts(qualityContract);
  const sourceIndex = buildSourceProductIndex(sourceMenu);
  const needle = (query ?? "").trim();
  const filter: MenuStatusFilter = statusFilter ?? "ALL";
  const narrowing = needle.length > 0 || filter !== "ALL";

  const sections: MenuCategoryView[] = [];
  for (const category of targetMenu.categories ?? []) {
    const statusCounts = emptyStatusCounts();
    const all: MenuProductView[] = [];
    for (const product of category.products ?? []) {
      const quality = qualityByProduct.get(product.sourceId) ?? null;
      const status = productDisplayStatus(product, quality);
      statusCounts[status] += 1;
      all.push({
        product,
        quality,
        status,
        statusLabel: displayStatusLabel(status),
        tone: displayStatusTone(status),
        menuNumber: menuNumberLabel(product),
        priceLabel: formatDkk(product.basePrice ?? null),
        sourceProduct: lookupSourceProduct(sourceIndex, product),
      });
    }
    const products = all.filter(
      (view) =>
        productMatchesFilter(view.status, filter) &&
        productMatchesQuery(view.product, needle),
    );
    if (narrowing && products.length === 0) continue;
    sections.push({
      sourceId: category.sourceId,
      name: category.name,
      productCount: all.length,
      statusCounts,
      products,
    });
  }
  return sections;
}

export type ProvenanceEvidenceView = {
  sourceUrl: string | null;
  sourceFile: string | null;
  pageNumber: number | null;
  sourceSection: string | null;
  rawText: string | null;
  confidence: number | null;
  origin: string | null;
};

export type ProvenanceFieldView = {
  field: string;
  value: string;
  origin: ValueOrigin | null;
};

export type ProvenanceDiffView = {
  field: string;
  source: string | null;
  target: string | null;
  changed: boolean;
};

export type ProvenanceCheckView = {
  id: string;
  pass: boolean;
  detail: string | null;
};

export type ProvenanceIssueView = {
  code: string;
  message: string;
  severity: string;
  field: string | null;
};

export type ProvenanceView = {
  evidence: ProvenanceEvidenceView | null;
  fields: ProvenanceFieldView[];
  diffs: ProvenanceDiffView[];
  checks: ProvenanceCheckView[];
  blockers: string[];
  completenessWarnings: string[];
  issues: ProvenanceIssueView[];
};

function toEvidenceView(
  evidence: SourceEvidence | null | undefined,
): ProvenanceEvidenceView | null {
  if (!evidence) return null;
  return {
    sourceUrl: evidence.sourceUrl ?? null,
    sourceFile: evidence.sourceFile ?? null,
    pageNumber: evidence.pageNumber ?? null,
    sourceSection: evidence.sourceSection ?? null,
    rawText: evidence.rawText ?? null,
    confidence: evidence.confidence ?? null,
    origin: evidence.origin ?? null,
  };
}

function sourcePriceLabels(source: SourceProduct): string[] {
  const labels: string[] = [];
  for (const option of source.sourcePriceOptions ?? []) {
    if (option.sourceTotalPrice != null) {
      labels.push(`${option.label} ${formatDkk(option.sourceTotalPrice)}`);
    }
  }
  if (labels.length === 0) {
    for (const variant of source.variants ?? []) {
      if (variant.sourceTotalPrice != null) {
        labels.push(`${variant.name} ${formatDkk(variant.sourceTotalPrice)}`);
      }
    }
  }
  return labels;
}

function joinOrNull(values: readonly string[]): string | null {
  const present = values.filter((value) => value.length > 0);
  return present.length > 0 ? present.join(", ") : null;
}

function diffRow(
  field: string,
  source: string | null,
  target: string | null,
): ProvenanceDiffView {
  return {
    field,
    source,
    target,
    changed: (source ?? "") !== (target ?? ""),
  };
}

function buildFieldOrigins(product: CanonicalProduct): ProvenanceFieldView[] {
  const fields: ProvenanceFieldView[] = [];
  if (product.basePrice != null) {
    fields.push({
      field: "Base price",
      value: formatDkk(product.basePrice),
      origin: product.basePriceOrigin ?? null,
    });
  }
  for (const ingredient of product.ingredients ?? []) {
    fields.push({
      field: `Ingredient — ${ingredient.display}`,
      value: ingredient.display,
      origin: ingredient.origin ?? null,
    });
  }
  for (const variant of product.variants ?? []) {
    fields.push({
      field: `Variant name — ${variant.name}`,
      value: variant.name,
      origin: variant.nameOrigin ?? null,
    });
    fields.push({
      field: `Variant surcharge — ${variant.name}`,
      value: formatDkk(variant.surcharge),
      origin: variant.surchargeOrigin ?? null,
    });
  }
  for (const addOn of product.addOns ?? []) {
    fields.push({
      field: `Tilbehør — ${addOn.name}`,
      value: addOn.price != null ? formatDkk(addOn.price) : "—",
      origin: addOn.origin ?? null,
    });
  }
  return fields;
}

function buildDiffs(
  product: CanonicalProduct,
  source: SourceProduct | null,
): ProvenanceDiffView[] {
  if (!source) return [];
  const sourcePrices = sourcePriceLabels(source);
  return [
    diffRow("Name", source.name, product.name),
    diffRow(
      "Menu number",
      source.sourceMenuNumber ?? null,
      menuNumberLabel(product),
    ),
    diffRow(
      "Description",
      source.description ?? null,
      product.description ?? null,
    ),
    diffRow(
      "Price",
      sourcePrices.length > 0 ? sourcePrices.join(" · ") : null,
      product.basePrice != null ? formatDkk(product.basePrice) : null,
    ),
    diffRow(
      "Ingredients",
      joinOrNull((source.ingredients ?? []).map((item) => item.display)),
      joinOrNull((product.ingredients ?? []).map((item) => item.display)),
    ),
    diffRow(
      "Variants",
      joinOrNull(
        (source.variants ?? []).map((variant) => {
          return variant.sourceTotalPrice != null
            ? `${variant.name} ${formatDkk(variant.sourceTotalPrice)}`
            : variant.name;
        }),
      ),
      joinOrNull(
        (product.variants ?? []).map((variant) => {
          return variant.surcharge > 0
            ? `${variant.name} +${formatDkk(variant.surcharge)}`
            : variant.name;
        }),
      ),
    ),
    diffRow(
      "Tilbehør",
      joinOrNull(
        (source.addOns ?? []).map((addOn) => {
          return addOn.price != null
            ? `${addOn.name} ${formatDkk(addOn.price)}`
            : addOn.name;
        }),
      ),
      joinOrNull(
        (product.addOns ?? []).map((addOn) => {
          return addOn.price != null
            ? `${addOn.name} ${formatDkk(addOn.price)}`
            : addOn.name;
        }),
      ),
    ),
  ];
}

/**
 * Assemble the provenance modal model: source evidence, field origins,
 * source↔target diff and quality-contract checks. Pure derivation — the UI
 * renders exactly what the pipeline recorded.
 */
export function buildProvenanceView({
  product,
  sourceProduct,
  qualityProduct,
}: {
  product: CanonicalProduct;
  sourceProduct: SourceProduct | null;
  qualityProduct: ProductQualityResult | null;
}): ProvenanceView {
  return {
    evidence:
      toEvidenceView(product.evidence ?? null) ??
      toEvidenceView(sourceProduct?.evidence ?? null),
    fields: buildFieldOrigins(product),
    diffs: buildDiffs(product, sourceProduct),
    checks: (qualityProduct?.checks ?? []).map((check) => ({
      id: check.id,
      pass: check.pass,
      detail: check.detail ?? null,
    })),
    blockers: qualityProduct?.blockers ?? [],
    completenessWarnings: qualityProduct?.completenessWarnings ?? [],
    issues: (product.issues ?? []).map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
      field: issue.field ?? null,
    })),
  };
}
