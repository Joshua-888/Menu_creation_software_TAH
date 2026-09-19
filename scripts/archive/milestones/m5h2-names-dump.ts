import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ing = await ingestPdf("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const out: string[] = [];
for (const pn of [3, 5, 6]) {
  const p = ing.pages.find((x) => x.pageNumber === pn)!;
  out.push(`=== P${pn} relevant ===`);
  for (const l of p.lines) {
    if (pn === 3 && l.y >= 400 && l.y <= 540) out.push(`${l.y}|${JSON.stringify(l.text)}`);
    if (pn === 6 && l.y >= 400 && l.y <= 560) out.push(`${l.y}|${JSON.stringify(l.text)}`);
    if (pn === 5 && l.y >= 480 && l.y <= 700) out.push(`${l.y}|${JSON.stringify(l.text)}`);
  }
}
writeFileSync("runs/m5h2-names.txt", out.join("\n"), "utf8");
console.log("ok");
