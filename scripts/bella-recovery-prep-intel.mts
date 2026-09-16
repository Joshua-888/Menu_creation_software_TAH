/**
 * Bella recovery prep — intelligence only, no admin writes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runRawSourceCertification } from "../src/certification/runRawCertification.js";
import { explainNonReadyProducts } from "../src/intelligence/explainNonReady.js";

const root = process.cwd();
const rawPath = resolve(root, "fixtures/golden/bella-kebab/raw-source.jpeg");
const outDir = resolve(root, "runs/bella-recovery-prep");
mkdirSync(outDir, { recursive: true });

const sourceHash = createHash("sha256")
  .update(readFileSync(rawPath))
  .digest("hex");

const result = await runRawSourceCertification({
  restaurantName: "Bella Kebab",
  restaurantKey: "bellakebab.dk",
  rawFilePath: rawPath,
  kind: "image",
  repoRoot: root,
});

const products = result.targetMenu.categories.flatMap((c) =>
  c.products.map((p) => ({ category: c.name, product: p })),
);
const ready = products.filter((x) => x.product.status === "READY").length;
const review = products.filter((x) => x.product.status === "REVIEW").length;
const blocked = products.filter(
  (x) => x.product.status === "BLOCKED" || x.product.status === "FAILED",
).length;

const zeroPrice = products.filter(
  (x) =>
    (x.product.basePrice ?? 0) === 0 ||
    x.product.basePriceOrigin === "SYSTEM_DEFAULT",
);
const pizzaCats = result.targetMenu.categories.filter((c) =>
  /^pizza$/i.test(c.name),
);

const explanations = explainNonReadyProducts(
  result.targetMenu,
  result.intelligence.quality,
);

const preview = {
  generatedAt: new Date().toISOString(),
  sourceHash,
  extraction: {
    sourceProducts: result.sourceProductCount,
    targetProducts: result.stats.targetProducts,
    categories: result.targetMenu.categories.map((c) => ({
      name: c.name,
      productCount: c.products.length,
    })),
  },
  quality: {
    ready,
    review,
    blocked,
    menuStatus: result.stats.menuStatus,
    statusAccounting: result.stats.statusAccounting,
  },
  unsupportedZeroPrices: zeroPrice.map((x) => x.product.name),
  inventedPizzaCategories: pizzaCats.map((c) => c.name),
  products: products.map(({ category, product: p }) => ({
    menuNumber: p.assignedMenuNumber ?? p.sourceMenuNumber ?? null,
    name: p.name,
    category,
    basePriceOre: p.basePrice ?? null,
    basePriceOrigin: p.basePriceOrigin ?? null,
    variants: (p.variants ?? []).map((v) => ({
      name: v.name,
      surcharge: v.surcharge,
      nameOrigin: v.nameOrigin,
      surchargeOrigin: v.surchargeOrigin,
    })),
    ingredients: (p.ingredients ?? []).map((i) => ({
      display: i.display,
      origin: i.origin,
    })),
    description: p.description ?? "",
    productChoices: p.productChoices ?? [],
    isCombo: p.isCombo ?? false,
    additions: p.addOns ?? [],
    status: p.status,
    evidence: p.evidence ?? null,
    confidence: p.confidence ?? null,
    issues: p.issues ?? [],
  })),
  nonReadyExplanations: explanations,
  qualityProducts: result.intelligence.quality.products.filter(
    (p) => p.status !== "QUALITY_READY",
  ),
};

writeFileSync(
  resolve(outDir, "bella-intelligence-result.json"),
  JSON.stringify(
    {
      sourceHash,
      sourceProductCount: result.sourceProductCount,
      targetProductCount: result.stats.targetProducts,
      ready,
      review,
      blocked,
      menuStatus: result.stats.menuStatus,
      statusAccounting: result.stats.statusAccounting,
      constitutionVersion: result.intelligence.constitutionVersion,
      categories: result.targetMenu.categories.map((c) => c.name),
    },
    null,
    2,
  ),
);
writeFileSync(
  resolve(outDir, "bella-target-menu.json"),
  JSON.stringify(result.targetMenu, null, 2),
);
writeFileSync(
  resolve(outDir, "bella-source-menu.json"),
  JSON.stringify(result.sourceMenu, null, 2),
);
writeFileSync(
  resolve(outDir, "bella-quality.json"),
  JSON.stringify(result.intelligence.quality, null, 2),
);
writeFileSync(
  resolve(outDir, "BELLA_MENU_PREVIEW.json"),
  JSON.stringify(preview, null, 2),
);

const md: string[] = [];
md.push("# BELLA MENU PREVIEW (intelligence only)");
md.push("");
md.push(`Source SHA256: \`${sourceHash}\``);
md.push(
  `Products: source=${result.sourceProductCount} target=${result.stats.targetProducts}`,
);
md.push(`Quality: READY=${ready} REVIEW=${review} BLOCKED=${blocked}`);
md.push("");
for (const { category, product: p } of products) {
  md.push(`## ${p.assignedMenuNumber ?? p.sourceMenuNumber ?? "?"} · ${p.name}`);
  md.push(`- Category: ${category}`);
  md.push(
    `- Base price: ${((p.basePrice ?? 0) / 100).toFixed(0)} kr (${p.basePriceOrigin ?? "?"})`,
  );
  md.push(`- Status: **${p.status}**`);
  md.push(
    `- Variants: ${(p.variants ?? []).map((v) => `${v.name}=${v.surcharge}`).join(", ") || "(none)"}`,
  );
  md.push(
    `- Ingredients: ${(p.ingredients ?? []).map((i) => `${i.display}[${i.origin}]`).join(", ") || "(none)"}`,
  );
  md.push(`- Description: ${p.description ?? ""}`);
  md.push(`- Combo: ${p.isCombo ? "yes" : "no"}`);
  md.push(
    `- ProductChoices: ${JSON.stringify(p.productChoices ?? [])}`,
  );
  md.push(`- Additions: ${JSON.stringify(p.addOns ?? [])}`);
  md.push(
    `- Evidence origin: ${p.evidence?.origin ?? "?"} raw: ${(p.evidence?.rawText ?? "").slice(0, 180)}`,
  );
  md.push("");
}
writeFileSync(resolve(outDir, "BELLA_MENU_PREVIEW.md"), md.join("\n"));

console.log(
  JSON.stringify(
    {
      sourceHash,
      sourceProducts: result.sourceProductCount,
      targetProducts: result.stats.targetProducts,
      ready,
      review,
      blocked,
      zeroPrices: zeroPrice.length,
      pizzaCats: pizzaCats.length,
      outDir,
    },
    null,
    2,
  ),
);
