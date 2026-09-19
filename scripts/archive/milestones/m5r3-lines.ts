import { ingestPdf } from "../src/extraction/pdf/ingest.js";
import { classifyPdfPages } from "../src/extraction/pdf/classify.js";
import { detectOverlappingPages } from "../src/extraction/pdf/overlap.js";
import { writeFileSync } from "node:fs";

const ing = await ingestPdf(
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const { pages } = detectOverlappingPages(classifyPdfPages(ing.pages));
const p4 = pages.find((p) => p.pageNumber === 4)!;
const lines = p4.lines.map((l, i) => `${i}|${l.y}|${l.text}`);
writeFileSync("runs/m5r3-p4-lines.txt", lines.join("\n"));
const pastaIdx = p4.lines.findIndex((l) => /^34\./.test(l.text.trim()));
console.log(
  "around 34:",
  p4.lines.slice(Math.max(0, pastaIdx - 2), pastaIdx + 8).map((l) => l.text),
);

const p3 = pages.find((p) => p.pageNumber === 3)!;
const idx3 = p3.lines.findIndex((l) => /34/.test(l.text));
console.log(
  "p3 around 34:",
  p3.lines.slice(Math.max(0, idx3 - 2), idx3 + 8).map((l) => l.text),
);

const p6 = pages.find((p) => p.pageNumber === 6)!;
const idx6 = p6.lines.findIndex((l) => /^65\./.test(l.text.trim()));
console.log(
  "p6 around 65:",
  p6.lines.slice(Math.max(0, idx6 - 3), idx6 + 6).map((l) => l.text),
);
