import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ing = await ingestPdf("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const out: string[] = [];

const p4 = ing.pages.find((x) => x.pageNumber === 4)!;
out.push("=== PAGE4 band 34 ===");
for (const it of p4.items
  .filter((it) => it.y >= 40 && it.y <= 90)
  .sort((a, b) => b.y - a.y || a.x - b.x)) {
  out.push(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
}

const p6 = ing.pages.find((x) => x.pageNumber === 6)!;
out.push("=== PAGE6 band 64-66 ===");
for (const it of p6.items
  .filter((it) => it.y >= 600 && it.y <= 670)
  .sort((a, b) => b.y - a.y || a.x - b.x)) {
  out.push(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
}

writeFileSync("runs/m5h-bands.txt", out.join("\n"), "utf8");
console.log("ok");
