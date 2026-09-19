import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import {
  loadVeroniGoldenFixture,
  reconcileAgainstGolden,
  listSourceProducts,
} from "../src/extraction/pdf/veroniGate.js";

const adapter = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
const r = await adapter.extractDetailed({
  kind: "pdf",
  filePath: "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
});
const golden = loadVeroniGoldenFixture();
const gate = reconcileAgainstGolden(r.sourceMenu, golden);
console.log(
  JSON.stringify(
    {
      unique: r.uniqueProducts,
      dup: r.duplicateOccurrences,
      pages: r.pages.map((p) => ({
        n: p.pageNumber,
        c: p.classification,
      })),
      sections: r.sourceMenu.categories.map((c) => ({
        name: c.name,
        count: c.products.length,
        nums: c.products.map((p) => p.sourceMenuNumber),
      })),
      gate: {
        pass: gate.pass,
        count: gate.uniqueProductCount,
        missing: gate.missing,
        extra: gate.extra,
        structural: gate.structuralIssues,
        sectionIssues: gate.sectionIssues.slice(0, 20),
      },
      p48: listSourceProducts(r.sourceMenu).find((p) => p.menuNumber === "48"),
      p39: listSourceProducts(r.sourceMenu).find((p) => p.menuNumber === "39"),
      p1: listSourceProducts(r.sourceMenu).find((p) => p.menuNumber === "1"),
      p32b: listSourceProducts(r.sourceMenu).find((p) => p.menuNumber === "32b"),
    },
    null,
    2,
  ),
);
