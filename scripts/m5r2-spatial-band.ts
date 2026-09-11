import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ingested = await ingestPdf(
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const page = ingested.pages.find((p) => p.pageNumber === 5)!;
const band = page.items
  .filter((it) => it.y >= 430 && it.y <= 560)
  .sort((a, b) => b.y - a.y || a.x - b.x);
writeFileSync(
  "runs/m5r2-p5-band.json",
  JSON.stringify(
    band.map((it) => ({ x: it.x, y: it.y, s: it.str })),
    null,
    2,
  ),
);
console.log(band.map((it) => `${it.y}|${it.x}|${it.str}`).join("\n"));
