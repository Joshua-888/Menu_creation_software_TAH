import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ing = await ingestPdf("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const p6 = ing.pages.find((p) => p.pageNumber === 6)!;
const lines = p6.lines
  .filter((l) => l.y >= 580 && l.y <= 720)
  .map((l) => `${l.y}|${JSON.stringify(l.text)}`);
writeFileSync("runs/m5h2-p6-indisk2.txt", lines.join("\n"), "utf8");
console.log("ok", lines.length);
