import { readFileSync, writeFileSync } from "node:fs";

const s = JSON.parse(readFileSync("runs/m5h-veroni/source-menu.json", "utf8"));
const c = JSON.parse(readFileSync("runs/m5h-veroni/canonical-menu.json", "utf8"));
const lines: string[] = [];
for (const n of ["64", "65", "66", "67", "68", "69", "70"]) {
  const sp = s.categories.flatMap((x: { products: Array<Record<string, unknown>> }) => x.products).find((p: Record<string, unknown>) => p.sourceMenuNumber === n);
  const cp = c.categories.flatMap((x: { products: Array<Record<string, unknown>> }) => x.products).find((p: Record<string, unknown>) => p.sourceMenuNumber === n);
  lines.push(
    JSON.stringify({
      n,
      name: sp?.name,
      src: (sp?.variants as Array<{ sourceTotalPrice: number }> | undefined)?.map((v) => v.sourceTotalPrice),
      base: cp?.basePrice,
      vars: (cp?.variants as Array<{ name: string; surcharge?: number }> | undefined)?.map((v) => [v.name, v.surcharge]),
    }),
  );
}
const report = JSON.parse(readFileSync("runs/m5h-veroni/m5h-report.json", "utf8"));
lines.push(`hardcoding=${report.VERONI_RUNTIME_HARDCODING} golden=${report.golden} ready=${report.READY_FOR_HUMAN_DECISIONS} p65=${JSON.stringify(report.product65)}`);
writeFileSync("runs/m5h-sanity-65.txt", lines.join("\n"), "utf8");
console.log("ok");
