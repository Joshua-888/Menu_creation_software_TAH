import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { classifyPdfPages } from "../src/extraction/pdf/classify.js";
import { detectOverlappingPages } from "../src/extraction/pdf/overlap.js";

const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const ing = await ingestPdf(path);
const { pages } = detectOverlappingPages(classifyPdfPages(ing.pages));
const out: string[] = [];
for (const p of pages.filter((x) => x.pageNumber === 5 || x.pageNumber === 4)) {
  out.push(`=== P${p.pageNumber} ${p.classification} ===`);
  for (const l of p.lines) {
    if (l.y >= 480 && l.y <= 700) {
      out.push(`${l.y}|${JSON.stringify(l.text)}`);
    }
  }
}
// also page items for 36-38
const p5 = ing.pages.find((p) => p.pageNumber === 5)!;
out.push("=== ITEMS 560-700 ===");
for (const it of p5.items
  .filter((it) => it.y >= 560 && it.y <= 700)
  .sort((a, b) => b.y - a.y || a.x - b.x)) {
  out.push(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
}
writeFileSync("runs/m5h2-36-43.txt", out.join("\n"), "utf8");
console.log("ok");
