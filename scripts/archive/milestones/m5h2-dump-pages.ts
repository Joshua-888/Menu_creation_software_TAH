import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ing = await ingestPdf("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const out: string[] = [];
for (const pn of [3, 5, 6]) {
  const p = ing.pages.find((x) => x.pageNumber === pn)!;
  out.push(`=== PAGE ${pn} ===`);
  const items = p.items
    .filter((it) => {
      if (pn === 3) return it.y >= 80 && it.y <= 200;
      if (pn === 5) return it.y >= 200 && it.y <= 560;
      return it.y >= 400 && it.y <= 560;
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of items) {
    out.push(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
  }
  out.push("--- LINES ---");
  for (const l of p.lines.filter((l) => {
    if (pn === 3) return l.y >= 80 && l.y <= 200;
    if (pn === 5) return l.y >= 200 && l.y <= 560;
    return l.y >= 400 && l.y <= 560;
  })) {
    out.push(`${l.y}|${JSON.stringify(l.text)}`);
  }
}
writeFileSync("runs/m5h2-p5.txt", out.join("\n"), "utf8");
console.log("ok");
