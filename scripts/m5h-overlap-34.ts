import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { classifyPdfPages } from "../src/extraction/pdf/classify.js";
import { detectOverlappingPages } from "../src/extraction/pdf/overlap.js";
import { detectSourceCandidatesLayout } from "../src/extraction/pdf/layoutExtract.js";

const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const ing = await ingestPdf(path);
const classified = classifyPdfPages(ing.pages);
const { pages } = detectOverlappingPages(classified);
const out: string[] = [];

for (const p of pages.filter((x) => x.pageNumber === 4 || x.pageNumber === 3)) {
  out.push(`=== PAGE ${p.pageNumber} class=${p.classification} ===`);
  for (const [idx, l] of p.lines.entries()) {
    if (/34|Alfredo|Kylling|Pasta/i.test(l.text) || (l.y >= 40 && l.y <= 70 && p.pageNumber === 4)) {
      out.push(`${idx}|y=${l.y}|${JSON.stringify(l.text)}`);
    }
  }
}

const layout = detectSourceCandidatesLayout(pages, path);
const c34 = layout.filter((x) => x.menuNumber === "34");
out.push(`candidates for 34: ${c34.length}`);
for (const c of c34) {
  out.push(
    JSON.stringify({
      name: c.name,
      page: c.pageNumber,
      prices: c.rawPrices,
      raw: c.evidence.rawText?.slice(0, 250),
    }),
  );
}

writeFileSync("runs/m5h-overlap-34.txt", out.join("\n"), "utf8");
console.log("ok");
