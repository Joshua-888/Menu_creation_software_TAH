import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ing = await ingestPdf("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const p5 = ing.pages.find((p) => p.pageNumber === 5)!;
const out: string[] = [];
for (const it of p5.items
  .filter((it) => it.y >= 380 && it.y <= 460)
  .sort((a, b) => b.y - a.y || a.x - b.x)) {
  out.push(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
}
writeFileSync("runs/m5h-p5-46.txt", out.join("\n"), "utf8");
console.log("ok");
