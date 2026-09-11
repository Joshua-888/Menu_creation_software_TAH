import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { classifyPdfPages } from "../src/extraction/pdf/classify.js";
import { detectSourceCandidatesLayout } from "../src/extraction/pdf/layoutExtract.js";
import { applyRenderedPageFallbackAsync } from "../src/extraction/pdf/renderedFallback.js";

const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const ing = await ingestPdf(path);
const classified = classifyPdfPages(ing.pages);
const out: string[] = [];

const p4 = classified.find((p) => p.pageNumber === 4)!;
out.push("=== LINES near 33-35 ===");
for (const [idx, l] of p4.lines.entries()) {
  if (l.y >= 20 && l.y <= 100) {
    out.push(`${idx}|y=${l.y}|${JSON.stringify(l.text)}`);
  }
}

const p6 = classified.find((p) => p.pageNumber === 6)!;
out.push("=== LINES near 64-67 ===");
for (const [idx, l] of p6.lines.entries()) {
  if (l.y >= 590 && l.y <= 680) {
    out.push(`${idx}|y=${l.y}|${JSON.stringify(l.text)}`);
  }
}

const layout = detectSourceCandidatesLayout(classified, path);
for (const n of ["34", "65"]) {
  const c = layout.find((x) => x.menuNumber === n);
  out.push(
    `LAYOUT ${n} name=${JSON.stringify(c?.name)} prices=${JSON.stringify(c?.rawPrices)} conf=${c?.confidence}`,
  );
}

const asynced = await applyRenderedPageFallbackAsync(layout, classified);
for (const n of ["34", "65"]) {
  const c = asynced.find((x) => x.menuNumber === n);
  out.push(
    `ASYNC ${n} name=${JSON.stringify(c?.name)} prices=${JSON.stringify(c?.rawPrices)} evidence=${JSON.stringify(c?.evidence.rawText?.slice(0, 200))}`,
  );
}

writeFileSync("runs/m5h-lines34-65.txt", out.join("\n"), "utf8");
console.log("wrote", out.length);
