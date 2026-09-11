import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { classifyPdfPages } from "../src/extraction/pdf/classify.js";
import { detectOverlappingPages } from "../src/extraction/pdf/overlap.js";
import { detectSourceCandidatesLayout } from "../src/extraction/pdf/layoutExtract.js";

const ingested = await ingestPdf(
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const classified = classifyPdfPages(ingested.pages);
const { pages } = detectOverlappingPages(classified);
const cands = detectSourceCandidatesLayout(pages, "fixtures/veroni/x.pdf");
for (const c of cands.filter((x) => ["15", "16", "17", "18"].includes(x.menuNumber ?? ""))) {
  console.log(
    JSON.stringify({
      id: c.candidateId,
      n: c.menuNumber,
      name: c.name,
      prices: c.rawPrices,
      mode: c.priceMode,
      page: c.pageNumber,
      bundle: c.rawLineBundle?.slice(0, 120),
    }),
  );
}

const a = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
const r = await a.extractDetailed({
  kind: "pdf",
  filePath: "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
});
const p18 = r.sourceMenu.categories
  .flatMap((c) => c.products)
  .find((p) => p.sourceMenuNumber === "18");
console.log("FINAL18", JSON.stringify(p18?.variants), p18?.name, p18?.confidence);
