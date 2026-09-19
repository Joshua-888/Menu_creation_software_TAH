import { readFileSync, writeFileSync } from "node:fs";

const m = JSON.parse(
  readFileSync("runs/m5h-veroni/source-menu.json", "utf8"),
);
const lines: string[] = [];
for (const n of ["36", "37", "39", "40", "41", "42", "43", "45", "46"]) {
  const p = m.categories
    .flatMap((c: { products: Array<Record<string, unknown>> }) => c.products)
    .find((x) => x.sourceMenuNumber === n);
  lines.push(
    JSON.stringify({
      n,
      name: p?.name,
      opts: p?.sourcePriceOptions,
      vars: (p?.variants as Array<{ name: string; sourceTotalPrice: number }> | undefined)?.map(
        (v) => [v.name, v.sourceTotalPrice],
      ),
      evidence: String(p?.evidence?.rawText ?? "").slice(0, 200),
    }),
  );
}
const c = JSON.parse(
  readFileSync("runs/m5h-veroni/canonical-menu.json", "utf8"),
);
for (const n of ["44", "45", "46", "33", "34", "48"]) {
  const p = c.categories
    .flatMap((cat: { products: Array<Record<string, unknown>> }) => cat.products)
    .find((x) => x.sourceMenuNumber === n);
  lines.push(
    `CANON ${n} status=${p?.status} name=${JSON.stringify(p?.name)} issues=${JSON.stringify((p?.issues as Array<{ code: string }> | undefined)?.map((i) => i.code))}`,
  );
}
writeFileSync("runs/m5h-menu46.txt", lines.join("\n"), "utf8");
console.log("ok");
