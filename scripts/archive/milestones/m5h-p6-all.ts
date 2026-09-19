import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ing = await ingestPdf("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const p6 = ing.pages.find((p) => p.pageNumber === 6)!;
const out: string[] = [];
for (const it of p6.items
  .filter((it) => it.y >= 520 && it.y <= 680)
  .sort((a, b) => b.y - a.y || a.x - b.x)) {
  out.push(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
}
writeFileSync("runs/m5h-p6-all.txt", out.join("\n"), "utf8");
console.log("ok", out.length);
