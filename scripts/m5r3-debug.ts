import { writeFileSync, mkdirSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { classifyPdfPages } from "../src/extraction/pdf/classify.js";
import { detectOverlappingPages } from "../src/extraction/pdf/overlap.js";
import { detectSourceCandidatesLayout } from "../src/extraction/pdf/layoutExtract.js";
import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import { runDomainEngine } from "../src/domain/engine.js";

mkdirSync("runs", { recursive: true });
const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const ing = await ingestPdf(path);
const { pages } = detectOverlappingPages(classifyPdfPages(ing.pages));

const out: string[] = [];
for (const pn of [3, 4, 5, 6]) {
  const p = pages.find((x) => x.pageNumber === pn)!;
  out.push(`=== PAGE ${pn} ===`);
  for (const l of p.lines) {
    if (/34|35|43|64|65|66|Alfredo|Øl|Ol|Grill|Pasta|Sodavand/i.test(l.text)) {
      out.push(l.text);
    }
  }
  out.push("--- items near 34/43/65 ---");
  for (const it of p.items) {
    if (/^(34|35|43|64|65|66)\.?$|Alfredo|Øl|^Ol$|Grillkyl|130,|25,/i.test(it.str.trim())) {
      out.push(`${it.y}|${it.x}|${JSON.stringify(it.str)}`);
    }
  }
}
writeFileSync("runs/m5r3-debug.txt", out.join("\n"));

const cands = detectSourceCandidatesLayout(pages, path);
const want = cands.filter((c) =>
  ["34", "35", "43", "64", "65", "66"].includes(c.menuNumber ?? ""),
);
writeFileSync("runs/m5r3-cands.json", JSON.stringify(want, null, 2));

const a = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
const r = await a.extractDetailed({ kind: "pdf", filePath: path });
const domain = runDomainEngine(r.sourceMenu);
const finals: unknown[] = [];
for (const n of ["34", "43", "65"]) {
  const p = r.sourceMenu.categories
    .flatMap((c) => c.products)
    .find((x) => x.sourceMenuNumber === n);
  const cp = domain.menu.categories
    .flatMap((c) => c.products)
    .find((x) => x.sourceMenuNumber === n);
  finals.push({
    n,
    name: p?.name,
    variants: p?.variants?.map((v) => [v.name, v.sourceTotalPrice]),
    opts: p?.sourcePriceOptions,
    status: cp?.status,
    issues: cp?.issues?.map((i) => i.code),
  });
}
writeFileSync("runs/m5r3-finals.json", JSON.stringify(finals, null, 2));
console.log("wrote debug files", want.length, finals.length);
