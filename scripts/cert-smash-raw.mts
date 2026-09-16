import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runRawSourceCertification } from "../src/certification/runRawCertification.js";

const root = process.cwd();
const r = await runRawSourceCertification({
  restaurantName: "Smash Fixture",
  restaurantKey: "fixture-smash.example",
  rawFilePath: resolve(root, "fixtures/golden/smash/raw-source.jpg"),
  kind: "image",
  repoRoot: root,
});

const out = {
  pageCount: r.pageCount,
  unique: r.uniqueProducts,
  source: r.sourceProductCount,
  stats: r.stats,
  menuVariants: r.menuVariantCount,
  writeEligible: r.intelligence.writeEligible,
  blockers: r.intelligence.quality.blockers.slice(0, 20),
  products: r.semantic.products.map((p) => ({
    name: p.name,
    cat: p.category,
    ings: p.ingredients,
    vars: p.variants,
    adds: p.additions.map((a) => a.name),
    desc: p.description ?? "",
  })),
};
writeFileSync(
  resolve(root, "fixtures/golden/smash/last-cert-run.json"),
  JSON.stringify(out, null, 2),
);
console.log("wrote last-cert-run.json");
console.log(JSON.stringify({ source: out.source, stats: out.stats, n: out.products.length, menuVariants: out.menuVariants }, null, 2));
