import { writeFileSync } from "node:fs";
import { PdfSourceAdapter } from "../src/extraction/pdf/adapter.js";
import { runDomainEngine } from "../src/domain/engine.js";

const a = new PdfSourceAdapter({ restaurantName: "Veroni Pizza" });
const r = await a.extractDetailed({
  kind: "pdf",
  filePath: "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf",
});
const lines: string[] = [];
for (const n of ["34", "43", "44", "45", "65"]) {
  const p = r.sourceMenu.categories
    .flatMap((c) => c.products)
    .find((x) => x.sourceMenuNumber === n);
  lines.push(
    JSON.stringify({
      n,
      name: p?.name,
      codes: [...(p?.name ?? "")].map((c) => c.charCodeAt(0)),
      vars: p?.variants?.map((v) => [v.name, v.sourceTotalPrice]),
      statusHint: p?.status,
    }),
  );
}
const d = runDomainEngine(r.sourceMenu);
const all = d.menu.categories.flatMap((c) => c.products);
const counts: Record<string, number> = {};
for (const p of all) counts[p.status] = (counts[p.status] ?? 0) + 1;
lines.push("COUNTS " + JSON.stringify(counts));
for (const p of all.filter((x) => x.status === "WARNING")) {
  lines.push(
    `WARN ${p.sourceMenuNumber} ${JSON.stringify(p.name)} ${p.issues.map((i) => i.code).join(",")}`,
  );
}
for (const n of ["44", "45", "65"]) {
  const p = all.find((x) => x.sourceMenuNumber === n);
  lines.push(
    `CANON ${n} ${JSON.stringify(p?.name)} ${p?.status} ${p?.issues.map((i) => i.code).join(",")}`,
  );
}
writeFileSync("runs/m5h-check-names.json", lines.join("\n"), "utf8");
console.log("wrote", lines.length);
