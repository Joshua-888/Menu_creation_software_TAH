/**
 * QA menu reconcile — diff intended (canonical + policies) vs live destination
 * and propose certified Opdater field updates.
 */

import { createHash } from "node:crypto";
import type { AdapterCapabilities } from "../tah/contracts/evidence.js";
import type { PlannedProductPayload } from "../runner/writePlan.js";
import { formatProductName } from "../domain/textNormalize.js";
import {
  isStructuralCategoryVariantName,
} from "../learning/categorySizeVariantPolicy.js";

export type ReconcileField =
  | "name"
  | "description"
  | "ingredients"
  | "additions"
  | "variants"
  | "basePrice";

export type ReconcileReasonCode =
  | "NAME_HEADER_LIKE"
  | "NAME_MISMATCH"
  | "DESC_PRICE_LEAK"
  | "DESC_MISMATCH"
  | "INGREDIENTS_DRIFT"
  | "ADDITIONS_DRIFT"
  | "VARIANTS_DRIFT"
  | "BASE_PRICE_DRIFT";

export type ReconcileFieldDelta = {
  field: ReconcileField;
  before: unknown;
  after: unknown;
  reasons: ReconcileReasonCode[];
};

export type ProductReconcileDiff = {
  menuNumber: string;
  sourceId: string;
  destinationDatabaseId: string;
  liveName: string;
  intendedName: string;
  deltas: ReconcileFieldDelta[];
  /** Caps required to apply all deltas via certified Opdater path. */
  requiredCapabilities: string[];
  missingCapabilities: string[];
  canUpdate: boolean;
};

export type MenuReconcileReport = {
  createdAt: string;
  restaurantKey: string;
  host?: string;
  fingerprint: string;
  productCount: number;
  withDiffs: number;
  updatable: number;
  blocked: number;
  products: ProductReconcileDiff[];
};

export type LiveProductSnapshot = {
  databaseId: string;
  menuNumber: string;
  name: string;
  description?: string;
  basePriceOre?: number;
  variants?: Array<{ name: string; priceOre: number }>;
  ingredients?: string[];
  additions?: Array<{ name: string; priceOre: number }>;
};

const CATEGORY_HEADER_RE =
  /^(pizza|salatpizza|vegetarpizza|burgers?|durum|pita|sandwich|indbagt|calzone|ufo)\b/i;

/** True when name looks like a size-column / category header, not a dish. */
export function looksLikeCategoryHeaderName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (CATEGORY_HEADER_RE.test(n) && /\b(alm\.?|fam\.?|familie|deep)\b/i.test(n)) {
    return true;
  }
  if (/^(pizza|salatpizza|vegetarpizza|burgers?|durum|pita|sandwich|indbagt)$/i.test(n)) {
    return true;
  }
  // "PIZZA Alm. Familie" style after light cleanup
  const tokens = n.split(/\s+/);
  if (
    tokens.length >= 2 &&
    CATEGORY_HEADER_RE.test(tokens[0]!) &&
    tokens.slice(1).every(
      (t) => isStructuralCategoryVariantName(t) || /^(menu|lille|stor)$/i.test(t),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Pull dish name from Beskrivelse like "Margarita 77, Tomat og, ost".
 */
export function recoverDishNameFromDescription(
  description: string,
): string | null {
  const raw = description.trim();
  if (!raw) return null;
  const firstClause = raw.split(/[,;|]/)[0]?.trim() ?? "";
  if (!firstClause) return null;
  // Strip trailing price glued to name: "Margarita 77"
  const cleaned = firstClause
    .replace(/\s+\d{2,4}([.,]\d{1,2})?\s*$/u, "")
    .replace(/^\d{2,4}\s+/, "")
    .trim();
  if (cleaned.length < 2) return null;
  if (/^\d+$/.test(cleaned)) return null;
  if (looksLikeCategoryHeaderName(cleaned)) return null;
  if (isStructuralCategoryVariantName(cleaned)) return null;
  return formatProductName(cleaned);
}

/** Strip leaked menu prices from description text. */
export function stripPriceLeakFromDescription(description: string): string {
  return description
    .replace(/\b\d{2,4}([.,]\d{1,2})?\s*(kr\.?)?\b/gi, " ")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/^\s*,\s*|\s*,\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Repair labels for reconcile: header names → dish from description;
 * strip price leaks from description.
 */
export function recoverProductLabelsForReconcile(input: {
  name: string;
  description?: string | null;
  ingredients?: readonly string[];
}): {
  name: string;
  description: string;
  reasons: ReconcileReasonCode[];
} {
  const reasons: ReconcileReasonCode[] = [];
  let name = input.name.trim();
  let description = (input.description ?? "").trim();

  if (looksLikeCategoryHeaderName(name)) {
    const recovered =
      recoverDishNameFromDescription(description) ||
      (input.ingredients?.[0]
        ? formatProductName(input.ingredients[0])
        : null);
    if (recovered) {
      reasons.push("NAME_HEADER_LIKE");
      name = recovered;
      // Drop recovered name token from description if it leads
      const strippedLead = description.replace(
        new RegExp(
          `^${recovered.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\d*\\s*,?\\s*`,
          "i",
        ),
        "",
      );
      if (strippedLead !== description) description = strippedLead.trim();
    }
  }

  const cleanedDesc = stripPriceLeakFromDescription(description);
  if (cleanedDesc !== description && description) {
    reasons.push("DESC_PRICE_LEAK");
    description = cleanedDesc;
  }

  return { name, description, reasons };
}

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function sortedNameList(items: string[]): string[] {
  return [...items].map(normKey).filter(Boolean).sort();
}

function variantSig(
  variants: Array<{ name: string; priceOre?: number }>,
): string {
  return variants
    .map((v) => `${normKey(v.name)}:${v.priceOre ?? 0}`)
    .sort()
    .join("|");
}

function additionSig(
  additions: Array<{ name: string; priceOre?: number }>,
): string {
  return additions
    .map((a) => `${normKey(a.name)}:${a.priceOre ?? 0}`)
    .sort()
    .join("|");
}

/** Map reconcile fields → certified capability names (never full updateProduct). */
export function capabilitiesForReconcileFields(
  fields: ReconcileField[],
): string[] {
  const caps = new Set<string>();
  if (fields.length === 0) return [];
  caps.add("updateExistingProductForm");
  for (const f of fields) {
    if (f === "description") caps.add("updateProductDescription");
    if (f === "name" || f === "basePrice") caps.add("updateScalarProductField");
    // ingredients / additions / variants also go through Opdater form
    if (f === "ingredients" || f === "additions" || f === "variants") {
      caps.add("updateExistingProductForm");
    }
  }
  return [...caps];
}

export function missingReconcileCapabilities(
  required: string[],
  capabilities: AdapterCapabilities,
): string[] {
  const missing: string[] = [];
  for (const name of required) {
    const status =
      capabilities.write[name as keyof AdapterCapabilities["write"]];
    if (status !== "CERTIFIED") missing.push(name);
  }
  // Explicitly refuse relying on full updateProduct
  return missing.filter((c) => c !== "updateProduct");
}

/**
 * Diff live snapshot vs intended write payload.
 * When live lacks deep fields, only name (and available fields) are compared.
 */
export function diffProductReconcile(input: {
  live: LiveProductSnapshot;
  intended: PlannedProductPayload;
  capabilities: AdapterCapabilities;
  /** Extra reasons already known (e.g. header recovery applied to intended). */
  labelReasons?: ReconcileReasonCode[];
}): ProductReconcileDiff {
  const deltas: ReconcileFieldDelta[] = [];
  const labelReasons = input.labelReasons ?? [];

  const liveName = input.live.name.trim();
  const intendedName = input.intended.name.trim();
  if (normKey(liveName) !== normKey(intendedName)) {
    const reasons: ReconcileReasonCode[] = labelReasons.includes("NAME_HEADER_LIKE")
      ? ["NAME_HEADER_LIKE", "NAME_MISMATCH"]
      : ["NAME_MISMATCH"];
    if (looksLikeCategoryHeaderName(liveName)) {
      if (!reasons.includes("NAME_HEADER_LIKE")) reasons.unshift("NAME_HEADER_LIKE");
    }
    deltas.push({
      field: "name",
      before: liveName,
      after: intendedName,
      reasons,
    });
  }

  if (typeof input.live.description === "string") {
    const liveDesc = input.live.description.trim();
    const intendedDesc = input.intended.description.trim();
    if (normKey(liveDesc) !== normKey(intendedDesc)) {
      const reasons: ReconcileReasonCode[] = ["DESC_MISMATCH"];
      if (
        labelReasons.includes("DESC_PRICE_LEAK") ||
        /\b\d{2,4}\b/.test(liveDesc)
      ) {
        reasons.unshift("DESC_PRICE_LEAK");
      }
      deltas.push({
        field: "description",
        before: liveDesc,
        after: intendedDesc,
        reasons,
      });
    }
  }

  if (input.live.ingredients) {
    const liveIng = sortedNameList(input.live.ingredients);
    const intendedIng = sortedNameList(input.intended.ingredients);
    if (liveIng.join("|") !== intendedIng.join("|")) {
      deltas.push({
        field: "ingredients",
        before: input.live.ingredients,
        after: input.intended.ingredients,
        reasons: ["INGREDIENTS_DRIFT"],
      });
    }
  }

  if (input.live.additions) {
    if (
      additionSig(input.live.additions) !==
      additionSig(input.intended.additions)
    ) {
      deltas.push({
        field: "additions",
        before: input.live.additions,
        after: input.intended.additions,
        reasons: ["ADDITIONS_DRIFT"],
      });
    }
  }

  if (input.live.variants) {
    const intendedVars = input.intended.variants.map((v) => ({
      name: v.name,
      priceOre: v.surchargeOre,
    }));
    if (variantSig(input.live.variants) !== variantSig(intendedVars)) {
      deltas.push({
        field: "variants",
        before: input.live.variants,
        after: intendedVars,
        reasons: ["VARIANTS_DRIFT"],
      });
    }
  }

  if (
    typeof input.live.basePriceOre === "number" &&
    input.live.basePriceOre !== input.intended.basePriceOre
  ) {
    deltas.push({
      field: "basePrice",
      before: input.live.basePriceOre,
      after: input.intended.basePriceOre,
      reasons: ["BASE_PRICE_DRIFT"],
    });
  }

  const fields = deltas.map((d) => d.field);
  const requiredCapabilities = capabilitiesForReconcileFields(fields);
  const missingCapabilities = missingReconcileCapabilities(
    requiredCapabilities,
    input.capabilities,
  );

  return {
    menuNumber: input.intended.menuNumber,
    sourceId: input.intended.sourceId,
    destinationDatabaseId: input.live.databaseId,
    liveName,
    intendedName,
    deltas,
    requiredCapabilities,
    missingCapabilities,
    canUpdate: deltas.length > 0 && missingCapabilities.length === 0,
  };
}

export function reconcileFingerprint(
  products: ProductReconcileDiff[],
): string {
  const material = products
    .filter((p) => p.deltas.length > 0)
    .map(
      (p) =>
        `${p.menuNumber}:${p.deltas.map((d) => d.field).sort().join(",")}`,
    )
    .sort()
    .join("|");
  return createHash("sha256").update(material || "empty").digest("hex").slice(0, 24);
}

export function buildMenuReconcileReport(input: {
  restaurantKey: string;
  host?: string;
  products: ProductReconcileDiff[];
}): MenuReconcileReport {
  const withDiffs = input.products.filter((p) => p.deltas.length > 0);
  const updatable = withDiffs.filter((p) => p.canUpdate);
  const blocked = withDiffs.filter((p) => !p.canUpdate);
  return {
    createdAt: new Date().toISOString(),
    restaurantKey: input.restaurantKey,
    ...(input.host ? { host: input.host } : {}),
    fingerprint: reconcileFingerprint(input.products),
    productCount: input.products.length,
    withDiffs: withDiffs.length,
    updatable: updatable.length,
    blocked: blocked.length,
    products: input.products,
  };
}

export function formatMenuReconcileMarkdown(
  report: MenuReconcileReport,
): string {
  const lines: string[] = [
    `# Menu QA reconcile`,
    ``,
    `- Restaurant: ${report.restaurantKey}${report.host ? ` (${report.host})` : ""}`,
    `- Created: ${report.createdAt}`,
    `- Fingerprint: \`${report.fingerprint}\``,
    `- Diffs: **${report.withDiffs}** (updatable ${report.updatable}, blocked ${report.blocked})`,
    ``,
    `## Products`,
  ];
  const withDiffs = report.products.filter((p) => p.deltas.length > 0);
  if (!withDiffs.length) {
    lines.push(`_No diffs — live menu matches intended payload._`, ``);
    return lines.join("\n");
  }
  for (const p of withDiffs) {
    lines.push(
      `### #${p.menuNumber} — ${p.liveName} → ${p.intendedName}`,
      `- Database id: ${p.destinationDatabaseId}`,
      `- Can update: **${p.canUpdate}**` +
        (p.missingCapabilities.length
          ? ` (missing: ${p.missingCapabilities.join(", ")})`
          : ""),
    );
    for (const d of p.deltas) {
      lines.push(
        `- **${d.field}** (${d.reasons.join(", ")}): \`${JSON.stringify(d.before)}\` → \`${JSON.stringify(d.after)}\``,
      );
    }
    lines.push(``);
  }
  lines.push(
    `## Apply`,
    `With admin credentials configured and the host allowlisted, QA live execute applies Opdater UPDATEs automatically (no separate reconcile confirm).`,
    `Kill switch: \`PORTAL_LIVE_WRITES=0\`.`,
    ``,
  );
  return lines.join("\n");
}
