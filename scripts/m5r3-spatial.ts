import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ing = await ingestPdf(
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);

// Page 3 pasta region
const p3 = ing.pages.find((p) => p.pageNumber === 3)!;
const p3band = p3.items
  .filter((it) => it.y < 120)
  .sort((a, b) => b.y - a.y || a.x - b.x);
writeFileSync(
  "runs/m5r3-p3-pasta.json",
  JSON.stringify(
    p3band.map((it) => ({ y: it.y, x: it.x, s: it.str })),
    null,
    2,
  ),
);

const p4 = ing.pages.find((p) => p.pageNumber === 4)!;
const p4band = p4.items
  .filter((it) => it.y < 150)
  .sort((a, b) => b.y - a.y || a.x - b.x);
writeFileSync(
  "runs/m5r3-p4-pasta.json",
  JSON.stringify(
    p4band.map((it) => ({ y: it.y, x: it.x, s: it.str })),
    null,
    2,
  ),
);

const p5 = ing.pages.find((p) => p.pageNumber === 5)!;
const p5band = p5.items
  .filter((it) => it.y >= 450 && it.y <= 560)
  .sort((a, b) => b.y - a.y || a.x - b.x);
writeFileSync(
  "runs/m5r3-p5-43.json",
  JSON.stringify(
    p5band.map((it) => ({ y: it.y, x: it.x, s: it.str })),
    null,
    2,
  ),
);

const p6 = ing.pages.find((p) => p.pageNumber === 6)!;
const drinks = p6.items
  .filter((it) => it.y > 580)
  .sort((a, b) => b.y - a.y || a.x - b.x);
writeFileSync(
  "runs/m5r3-p6-drinks.json",
  JSON.stringify(
    drinks.map((it) => ({ y: it.y, x: it.x, s: it.str })),
    null,
    2,
  ),
);
console.log(
  "p3",
  p3band.length,
  "p4",
  p4band.length,
  "p5",
  p5band.length,
  "p6",
  drinks.length,
);
console.log("---p6---");
for (const it of drinks) console.log(`${it.y}|${it.x}|${it.str}`);
console.log("---p4 pasta---");
for (const it of p4band.slice(0, 40)) console.log(`${it.y}|${it.x}|${it.str}`);
