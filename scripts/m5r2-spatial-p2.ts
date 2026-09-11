import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ing = await ingestPdf(
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
for (const pn of [2, 3, 4]) {
  const p = ing.pages.find((x) => x.pageNumber === pn)!;
  const hits = p.items
    .filter((it) =>
      /^(15|16|17|18|19|20)\.?$|Seafood|Dagulas|Gorgonzola|Noah|115|220|I15|II5|120|230/i.test(
        it.str.trim(),
      ),
    )
    .sort((a, b) => b.y - a.y || a.x - b.x);
  console.log("\nPAGE", pn);
  for (const it of hits) console.log(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
}
// Also dump bottom of page 2
const p2 = ing.pages.find((x) => x.pageNumber === 2)!;
const bottom = p2.items
  .filter((it) => it.y < 120)
  .sort((a, b) => b.y - a.y || a.x - b.x);
writeFileSync(
  "runs/m5r2-p2-bottom.json",
  JSON.stringify(
    bottom.map((it) => ({ y: it.y, x: it.x, s: it.str })),
    null,
    2,
  ),
);
console.log("\nP2 bottom count", bottom.length);
