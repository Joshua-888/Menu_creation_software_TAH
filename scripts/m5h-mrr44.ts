import { readFileSync, writeFileSync } from "node:fs";

const c = JSON.parse(
  readFileSync("runs/m5h-veroni/canonical-menu.json", "utf8"),
);
const s = JSON.parse(readFileSync("runs/m5h-veroni/source-menu.json", "utf8"));
const lines: string[] = [];
for (const n of ["44", "45", "46", "39", "43"]) {
  const cp = c.categories
    .flatMap((cat: { products: Array<Record<string, unknown>> }) => cat.products)
    .find((x) => x.sourceMenuNumber === n);
  const sp = s.categories
    .flatMap((cat: { products: Array<Record<string, unknown>> }) => cat.products)
    .find((x) => x.sourceMenuNumber === n);
  lines.push(
    JSON.stringify({
      n,
      status: cp?.status,
      issues: cp?.issues,
      name: sp?.name,
      vars: sp?.variants,
      opts: sp?.sourcePriceOptions,
      ingredients: sp?.ingredients,
    }),
  );
}
writeFileSync("runs/m5h-mrr-44.txt", lines.join("\n"), "utf8");
console.log("ok");
