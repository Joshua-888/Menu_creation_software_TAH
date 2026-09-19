import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import { runDomainEngine } from "../src/domain/engine.js";

const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const ing = await ingestPdf(path);
const p6 = ing.pages.find((p) => p.pageNumber === 6)!;
const out: string[] = [];
out.push("=== RAW ITEMS y>=580 ===");
for (const it of p6.items
  .filter((it) => it.y >= 580)
  .sort((a, b) => b.y - a.y || a.x - b.x)) {
  out.push(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
}
out.push("=== LINES y>=580 ===");
for (const l of p6.lines.filter((l) => l.y >= 580)) {
  out.push(`${l.y}|${JSON.stringify(l.text)}`);
}

const a = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
const r = await a.extractDetailed({ kind: "pdf", filePath: path });
const d = runDomainEngine(r.sourceMenu);
out.push("=== EXTRACTED 64-70 ===");
for (const n of ["64", "65", "66", "67", "68", "69", "70"]) {
  const sp = r.sourceMenu.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === n);
  const cp = d.menu.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === n);
  out.push(
    JSON.stringify({
      n,
      name: sp?.name,
      srcPrices: sp?.variants?.map((v) => [v.name, v.sourceTotalPrice]),
      base: cp?.basePrice,
      evidence: sp?.evidence?.rawText?.slice(0, 160),
    }),
  );
}
writeFileSync("runs/m5h-64-70.txt", out.join("\n"), "utf8");
console.log("ok");
