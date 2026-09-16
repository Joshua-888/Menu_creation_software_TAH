/**
 * Delta report: CATEGORY_QUALIFIED_PRODUCT_NAME_V1 impact on existing menus.
 * Does NOT rewrite golden fixtures. Does NOT mutate Bella destination.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyCategoryQualifiedProductName } from "../src/intelligence/categoryQualifiedProductName.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs", "receipt-safe-naming-delta");
mkdirSync(outDir, { recursive: true });

type FlatProduct = {
  sourceId?: string;
  name: string;
  category: string;
};

type DeltaRow = {
  merchant: string;
  category: string;
  sourceId: string | null;
  oldName: string;
  newName: string;
  policyReason: string;
  family: string | null;
};

function sha(o: unknown) {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex");
}

function loadJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function extractFlatProducts(doc: unknown): FlatProduct[] {
  if (!doc || typeof doc !== "object") return [];
  const o = doc as Record<string, unknown>;

  // Canonical / TargetMenu shape
  if (Array.isArray(o.categories)) {
    const out: FlatProduct[] = [];
    for (const cat of o.categories as Array<Record<string, unknown>>) {
      const catName = String(cat.name ?? "");
      for (const p of (cat.products as Array<Record<string, unknown>>) ?? []) {
        out.push({
          name: String(p.name ?? ""),
          category: catName,
          ...(p.sourceId ? { sourceId: String(p.sourceId) } : {}),
        });
      }
    }
    return out;
  }

  // Golden product list shape (Veroni / Thai)
  if (Array.isArray(o.products)) {
    return (o.products as Array<Record<string, unknown>>)
      .map((p) => ({
        name: String(p.name ?? ""),
        category: String(p.category ?? p.categoryName ?? ""),
        ...(p.sourceId ? { sourceId: String(p.sourceId) } : {}),
      }))
      .filter((p) => p.name && p.category);
  }

  // Smash expected-final-menu style
  const out: FlatProduct[] = [];
  if (Array.isArray(o.burgerProducts)) {
    for (const p of o.burgerProducts as Array<string | Record<string, unknown>>) {
      if (typeof p === "string") {
        out.push({
          name: p,
          category: String(o.burgersCategory ?? "Burgers"),
        });
      } else {
        out.push({
          name: String(p.name ?? ""),
          category: String(o.burgersCategory ?? "Burgers"),
        });
      }
    }
  }
  if (Array.isArray(o.menuerProducts)) {
    for (const p of o.menuerProducts as Array<string | Record<string, unknown>>) {
      if (typeof p === "string") {
        out.push({ name: p, category: "Menuer" });
      } else {
        out.push({
          name: String(p.name ?? ""),
          category: "Menuer",
        });
      }
    }
  }
  return out.filter((p) => p.name);
}

function deltasForProducts(
  merchant: string,
  products: FlatProduct[],
): DeltaRow[] {
  const rows: DeltaRow[] = [];
  for (const p of products) {
    const r = applyCategoryQualifiedProductName({
      categoryName: p.category,
      productName: p.name,
    });
    if (!r.trace.changed) continue;
    rows.push({
      merchant,
      category: p.category,
      sourceId: p.sourceId ?? null,
      oldName: r.trace.originalName,
      newName: r.trace.finalName,
      policyReason: r.trace.reason,
      family: r.trace.family,
    });
  }
  return rows;
}

const targets: Array<{ merchant: string; path: string }> = [
  {
    merchant: "Bella",
    path: join(root, "runs/bella-recovery-prep/bella-target-menu.json"),
  },
  {
    merchant: "BellaGolden",
    path: join(root, "fixtures/golden/bella-kebab/expected-target-menu.json"),
  },
  {
    merchant: "Smash",
    path: join(root, "fixtures/golden/smash/expected-canonical-menu.json"),
  },
  {
    merchant: "SmashFinal",
    path: join(root, "fixtures/golden/smash/expected-final-menu.json"),
  },
  {
    merchant: "Veroni",
    path: join(root, "fixtures/golden/veroni/VERONI_GOLDEN_V2.json"),
  },
  {
    merchant: "Thai",
    path: join(root, "fixtures/golden/third-merchant/THAI_HOUSE_GOLDEN_V1.json"),
  },
  {
    merchant: "ThaiExpected",
    path: join(root, "fixtures/golden/third-merchant/expected-final-menu.json"),
  },
];

const allDeltas: DeltaRow[] = [];
const perMerchant: Record<
  string,
  {
    changed: number;
    rows: DeltaRow[];
    productCount: number;
    oldHash?: string;
    newHash?: string;
  }
> = {};

for (const t of targets) {
  const doc = loadJson(t.path);
  if (!doc) {
    perMerchant[t.merchant] = { changed: 0, rows: [], productCount: 0 };
    continue;
  }
  const products = extractFlatProducts(doc);
  const rows = deltasForProducts(t.merchant, products);
  allDeltas.push(...rows);

  let oldHash: string | undefined;
  let newHash: string | undefined;
  if (t.merchant === "Bella" && (doc as { categories?: unknown }).categories) {
    oldHash = sha(doc);
    // Name-only rewrite for hash delta (do not conflate with other completion side-effects)
    const nameRewritten = JSON.parse(JSON.stringify(doc)) as {
      categories: Array<{
        name: string;
        products: Array<{ name: string }>;
      }>;
    };
    let anyNameChange = false;
    for (const cat of nameRewritten.categories) {
      for (const p of cat.products) {
        const r = applyCategoryQualifiedProductName({
          categoryName: cat.name,
          productName: p.name,
        });
        if (r.trace.changed) {
          anyNameChange = true;
          p.name = r.name;
        }
      }
    }
    newHash = anyNameChange ? sha(nameRewritten) : oldHash;
  }

  perMerchant[t.merchant] = {
    changed: rows.length,
    rows,
    productCount: products.length,
    ...(oldHash ? { oldHash } : {}),
    ...(newHash ? { newHash } : {}),
  };
}

const bellaChanged = (perMerchant.Bella?.changed ?? 0) > 0;
const report = {
  policyId: "CATEGORY_QUALIFIED_PRODUCT_NAME_V1",
  generatedAt: new Date().toISOString(),
  note: "Golden fixtures were NOT rewritten. Bella destination was NOT mutated.",
  summary: Object.fromEntries(
    Object.entries(perMerchant).map(([k, v]) => [
      k,
      {
        productCount: v.productCount,
        namesChanged: v.changed,
        ...(v.oldHash ? { oldTargetMenuHash: v.oldHash } : {}),
        ...(v.newHash ? { newTargetMenuHashIfPolicyApplied: v.newHash } : {}),
        targetMenuChanged: v.changed > 0,
      },
    ]),
  ),
  fullDeltaList: allDeltas,
  bella: {
    TargetMenuChanged: bellaChanged,
    oldTargetMenuHash: perMerchant.Bella?.oldHash ?? null,
    newTargetMenuHashIfChanged: bellaChanged
      ? (perMerchant.Bella?.newHash ?? null)
      : null,
    RecoveryPlanInvalidated: bellaChanged,
    destinationMutated: false,
    frozenApprovedHash:
      "607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e",
  },
};

writeFileSync(
  join(outDir, "RECEIPT_SAFE_NAMING_DELTA.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);

const md = [
  "# RECEIPT-SAFE NAMING — EXISTING MENU DELTA",
  "",
  `Policy: CATEGORY_QUALIFIED_PRODUCT_NAME_V1`,
  `Generated: ${report.generatedAt}`,
  "",
  "## Summary",
  ...Object.entries(report.summary).map(([m, s]) => {
    const x = s as {
      namesChanged: number;
      productCount: number;
    };
    return `- **${m}**: ${x.namesChanged} name(s) would change (of ${x.productCount} products)`;
  }),
  "",
  "## Full delta",
  "| Merchant | Category | Old | New | Family | Reason |",
  "|----------|----------|-----|-----|--------|--------|",
  ...allDeltas.map(
    (d) =>
      `| ${d.merchant} | ${d.category} | ${d.oldName} | ${d.newName} | ${d.family} | ${d.policyReason} |`,
  ),
  allDeltas.length === 0 ? "| — | — | — | — | — | no changes |" : "",
  "",
  "## Bella",
  `- TargetMenu changed: ${bellaChanged ? "YES" : "NO"}`,
  `- RecoveryPlan invalidated: ${bellaChanged ? "YES" : "NO"}`,
  `- Destination mutated: NO`,
  "",
].join("\n");

writeFileSync(join(outDir, "RECEIPT_SAFE_NAMING_DELTA.md"), md, "utf8");

console.log(JSON.stringify(report.summary, null, 2));
console.log(`total deltas: ${allDeltas.length}`);
console.log(`wrote ${outDir}`);
