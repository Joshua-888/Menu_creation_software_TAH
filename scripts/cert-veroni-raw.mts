import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runRawSourceCertification } from "../src/certification/runRawCertification.js";

const root = process.cwd();
const r = await runRawSourceCertification({
  restaurantName: "Veroni Fixture",
  restaurantKey: "fixture-veroni.example",
  rawFilePath: resolve(root, "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf"),
  kind: "pdf",
  repoRoot: root,
});

const out = {
  pageCount: r.pageCount,
  unique: r.uniqueProducts,
  source: r.sourceProductCount,
  stats: r.stats,
  menuVariants: r.menuVariantCount,
  writeEligible: r.intelligence.writeEligible,
  sample: r.semantic.products.slice(0, 15).map((p) => ({
    name: p.name,
    cat: p.category,
    ings: p.ingredients.length,
    vars: p.variants,
  })),
  cats: [...new Set(r.semantic.products.map((p) => p.category))],
};
writeFileSync(
  resolve(root, "fixtures/golden/veroni/last-cert-run.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify({ source: out.source, stats: out.stats, menuVariants: out.menuVariants, cats: out.cats }, null, 2));
