import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { classifyPdfPages } from "../src/extraction/pdf/classify.js";
import { detectOverlappingPages } from "../src/extraction/pdf/overlap.js";
import { detectSourceCandidatesLayout } from "../src/extraction/pdf/layoutExtract.js";
import { extractMenuNumberFromLine, extractAloneCommaMenuNumber } from "../src/extraction/pdf/menuNumber.js";

const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const ing = await ingestPdf(path);
const { pages } = detectOverlappingPages(classifyPdfPages(ing.pages));
const p4 = pages.find((p) => p.pageNumber === 4)!;
const lines = p4.lines.map((l) => l.text);
const i = lines.findIndex((l) => l.trim() === "34.");
console.log("index", i);
console.log("window", lines.slice(i, i + 6));
for (let j = i + 1; j < i + 6; j++) {
  const next = lines[j]!;
  console.log("check", JSON.stringify(next), {
    mn: extractMenuNumberFromLine(next),
    alone: extractAloneCommaMenuNumber(next, lines[j + 1], lines[j - 1]),
  });
}
const cands = detectSourceCandidatesLayout([p4], path);
console.log(
  "p4-only 34",
  cands.filter((c) => c.menuNumber === "34").map((c) => ({
    name: c.name,
    bundle: c.rawLineBundle,
    prices: c.rawPrices,
  })),
);
