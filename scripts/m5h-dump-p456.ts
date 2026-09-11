import { writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

const ing = await ingestPdf("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const out: string[] = [];
for (const pn of [4, 5, 6]) {
  const p = ing.pages.find((x) => x.pageNumber === pn)!;
  out.push(`PAGE ${pn}`);
  const hits = p.items.filter((it) =>
    /34|Alfredo|Kylling|65|ol|Øl|Sodavand|64|66|Penne|fløde/i.test(it.str),
  );
  for (const it of hits.sort((a, b) => b.y - a.y || a.x - b.x)) {
    out.push(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
  }
}
writeFileSync("runs/m5h-p456.txt", out.join("\n"), "utf8");
console.log("ok", out.length);
