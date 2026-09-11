import { readFileSync, writeFileSync } from "node:fs";
import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import { runDomainEngine } from "../src/domain/engine.js";

const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const a = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
const r = await a.extractDetailed({ kind: "pdf", filePath: path });
const d = runDomainEngine(r.sourceMenu);
const lines: string[] = [];

for (const n of ["36", "37", "39", "40", "41", "42", "43", "24", "59", "60", "61", "62"]) {
  const sp = r.sourceMenu.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === n);
  const cp = d.menu.categories
    .flatMap((c) => c.products)
    .find((p) => p.sourceMenuNumber === n);
  lines.push(
    JSON.stringify({
      n,
      name: sp?.name,
      opts: sp?.sourcePriceOptions,
      srcVars: sp?.variants?.map((v) => [v.name, v.sourceTotalPrice]),
      base: cp?.basePrice,
      menuSurcharge: cp?.variants?.find((v) => v.name === "Menu")?.surcharge,
      evidence: sp?.evidence?.rawText?.slice(0, 220),
      ings: sp?.ingredients?.map((i) => i.display),
      choices: sp?.productChoices?.map((c) => c.prompt),
    }),
  );
}

const hr = JSON.parse(
  readFileSync("runs/m5h-veroni/human-review-final.json", "utf8"),
);
const menuDec = hr.decisions?.find((x: { id: string }) => x.id === "D-MENU-OPTION");
lines.push("REVIEW_MENU_SRC:\n" + (menuDec?.sourceText ?? ""));
for (const id of ["D-CHOICE-1", "D-CHOICE-2", "D-CHOICE-4", "D-CHOICE-5"]) {
  const dec = hr.decisions?.find((x: { id: string }) => x.id === id);
  if (dec) {
    lines.push(
      `REVIEW ${id} affected=${JSON.stringify(dec.affectedProducts)} src=${JSON.stringify(String(dec.sourceText).slice(0, 180))}`,
    );
  }
}

writeFileSync("runs/m5h2-audit.txt", lines.join("\n\n"), "utf8");
console.log("ok", lines.length);
