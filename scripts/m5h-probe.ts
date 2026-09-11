import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import { runDomainEngine } from "../src/domain/engine.js";

const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const ing = await ingestPdf(path);
const p6 = ing.pages.find((p) => p.pageNumber === 6)!;
const hits = p6.items
  .filter((it) => /ø|ol|øl|beer|45|65|64|Sodavand|vin/i.test(it.str))
  .sort((a, b) => b.y - a.y || a.x - b.x);
writeFileSync(
  "runs/m5h-p6.txt",
  hits.map((it) => `${it.y}|${it.x}|${JSON.stringify(it.str)}`).join("\n"),
);

const p5 = ing.pages.find((p) => p.pageNumber === 5)!;
const band = p5.items
  .filter((it) => it.y >= 430 && it.y <= 480)
  .sort((a, b) => b.y - a.y || a.x - b.x);
writeFileSync(
  "runs/m5h-p5-44.txt",
  band.map((it) => `${it.y}|${it.x}|${JSON.stringify(it.str)}`).join("\n"),
);

const a = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
const r = await a.extractDetailed({ kind: "pdf", filePath: path });
const lines: string[] = [];
for (const n of ["43", "44", "45", "65"]) {
  const p = r.sourceMenu.categories
    .flatMap((c) => c.products)
    .find((x) => x.sourceMenuNumber === n);
  lines.push(
    JSON.stringify({
      n,
      name: p?.name,
      bundle: p?.evidence?.rawText?.slice(0, 180),
      vars: p?.variants?.map((v) => [v.name, v.sourceTotalPrice]),
    }),
  );
}
const d = runDomainEngine(r.sourceMenu);
for (const n of ["44", "45"]) {
  const p = d.menu.categories
    .flatMap((c) => c.products)
    .find((x) => x.sourceMenuNumber === n);
  lines.push(
    `CANON ${n} name=${p?.name} status=${p?.status} issues=${JSON.stringify(p?.issues)}`,
  );
}
writeFileSync("runs/m5h-probe2.txt", lines.join("\n"));
console.log("ok", lines.length);
