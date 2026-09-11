import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import { listSourceProducts } from "../src/extraction/pdf/veroniGate.js";
import { runDomainEngine } from "../src/domain/engine.js";

const a = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
const r = await a.extractDetailed({
  kind: "pdf",
  filePath: "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
});
const products = listSourceProducts(r.sourceMenu);
const byNum = Object.fromEntries(products.map((p) => [p.menuNumber, p]));
const almFam = products.filter(
  (p) => p.variants.includes("Alm.") && p.variants.includes("Familie"),
);
const menu = products.filter(
  (p) => p.priceModeHints.includes("Menu") || p.variants.includes("Menu"),
);
console.log("almFam", almFam.length, almFam.map((p) => p.menuNumber).join(","));
console.log(
  "menu",
  menu.length,
  menu.map((p) => p.menuNumber).join(","),
);
for (const n of [
  "1",
  "21",
  "27",
  "28",
  "31",
  "32",
  "32b",
  "32C",
  "36",
  "37",
  "38",
  "39",
  "43",
  "44",
  "45",
  "46",
  "48",
]) {
  const p = byNum[n];
  const src = r.sourceMenu.categories
    .flatMap((c) => c.products)
    .find((x) => x.sourceMenuNumber === n);
  console.log(
    n,
    JSON.stringify({
      name: p?.name,
      variants: p?.variants,
      hints: p?.priceModeHints,
      section: p?.section,
      totals: src?.variants.map((v) => [v.name, v.sourceTotalPrice]),
      opts: src?.sourcePriceOptions,
    }),
  );
}
const domain = runDomainEngine(r.sourceMenu);
const counts = { READY: 0, WARNING: 0, MANUAL_REVIEW_REQUIRED: 0, BLOCKED: 0 };
for (const c of domain.menu.categories) {
  for (const p of c.products) counts[p.status as keyof typeof counts]++;
}
console.log("status", counts);
