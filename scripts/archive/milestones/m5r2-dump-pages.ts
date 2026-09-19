import { mkdirSync, writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { classifyPdfPages } from "../src/extraction/pdf/classify.js";
import { detectOverlappingPages } from "../src/extraction/pdf/overlap.js";
import { detectSourceCandidatesLayout } from "../src/extraction/pdf/layoutExtract.js";
import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";

mkdirSync("runs", { recursive: true });

const ingested = await ingestPdf(
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const classified = classifyPdfPages(ingested.pages);
const { pages } = detectOverlappingPages(classified);
const out: string[] = [];
for (const p of pages) {
  if (![2, 3, 4, 5].includes(p.pageNumber)) continue;
  out.push(`=== PAGE ${p.pageNumber} ${p.classification} ===`);
  for (const l of p.lines) out.push(l.text);
}
writeFileSync("runs/m5r2-page-dump.txt", out.join("\n"), "utf8");

const cands = detectSourceCandidatesLayout(
  pages,
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const want = new Set([
  "15",
  "16",
  "17",
  "18",
  "19",
  "21",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "32b",
  "32C",
  "36",
  "37",
  "38",
  "39",
  "42",
  "43",
  "44",
]);
const candDump = cands
  .filter((c) => c.menuNumber && want.has(c.menuNumber))
  .map((c) => ({
    page: c.pageNumber,
    n: c.menuNumber,
    name: c.name,
    mode: c.priceMode,
    prices: c.rawPrices,
    section: c.sectionHint,
    bundle: c.rawLineBundle?.slice(0, 200),
  }));
writeFileSync(
  "runs/m5r2-cand-dump.json",
  JSON.stringify(candDump, null, 2),
  "utf8",
);
console.log("pages", out.length, "cands", candDump.length);
