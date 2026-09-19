import { readFileSync, writeFileSync } from "node:fs";

const c = JSON.parse(
  readFileSync("runs/m5h-veroni/canonical-menu.json", "utf8"),
);
const s = JSON.parse(readFileSync("runs/m5h-veroni/source-menu.json", "utf8"));
const lines: string[] = [];
for (const n of ["44", "45", "43", "46", "65"]) {
  const cp = c.categories
    .flatMap((cat: { products: Array<Record<string, unknown>> }) => cat.products)
    .find((x) => x.sourceMenuNumber === n);
  const sp = s.categories
    .flatMap((cat: { products: Array<Record<string, unknown>> }) => cat.products)
    .find((x) => x.sourceMenuNumber === n);
  lines.push(
    JSON.stringify({
      n,
      srcName: sp?.name,
      status: cp?.status,
      issues: (cp?.issues as Array<{ code: string }> | undefined)?.map((i) => i.code),
      prices: (sp?.variants as Array<{ name: string; sourceTotalPrice: number }> | undefined)?.map(
        (v) => [v.name, v.sourceTotalPrice],
      ),
      ings: (sp?.ingredients as Array<{ display: string }> | undefined)?.map((i) => i.display),
    }),
  );
}
const final = JSON.parse(
  readFileSync("runs/m5h-veroni/human-review-final.json", "utf8"),
);
lines.push(`DECISIONS ${final.decisions.length}`);
writeFileSync("runs/m5h-final-snap.txt", lines.join("\n"), "utf8");
console.log("ok");
