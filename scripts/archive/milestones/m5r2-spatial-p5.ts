import { mkdirSync, writeFileSync } from "node:fs";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

mkdirSync("runs", { recursive: true });
const ingested = await ingestPdf(
  "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
);
const page = ingested.pages.find((p) => p.pageNumber === 5)!;
const items = page.items
  .filter((it) => {
    const s = it.str.trim();
    return (
      /\d/.test(s) ||
      /grill|fiske|bacon|cheese|kebab|pølse|pommes|menu|dürüm|pita|hvidløg|cafeteria/i.test(
        s,
      )
    );
  })
  .sort((a, b) => b.y - a.y || a.x - b.x)
  .map((it) => ({ x: it.x, y: it.y, s: it.str }));
writeFileSync("runs/m5r2-p5-spatial.json", JSON.stringify(items, null, 2));
console.log("items", items.length);
