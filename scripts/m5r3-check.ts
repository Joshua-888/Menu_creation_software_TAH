import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import { listSourceProducts } from "../src/extraction/pdf/veroniGate.js";
import { runDomainEngine } from "../src/domain/engine.js";

const a = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
const r = await a.extractDetailed({
  kind: "pdf",
  filePath: "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
});
const products = listSourceProducts(r.sourceMenu);
const menu = products.filter((p) => p.priceModeHints.includes("Menu"));
console.log(
  "menu",
  menu.map((p) => p.menuNumber),
);
for (const n of ["34", "38", "43", "45", "46", "65"]) {
  const src = r.sourceMenu.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === n);
  const d = runDomainEngine(r.sourceMenu);
  const cp = d.menu.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === n);
  console.log(
    n,
    JSON.stringify({
      name: src?.name,
      vars: src?.variants.map((v) => [v.name, v.sourceTotalPrice]),
      opts: src?.sourcePriceOptions,
      status: cp?.status,
    }),
  );
}
