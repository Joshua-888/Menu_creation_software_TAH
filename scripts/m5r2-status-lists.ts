import { readFileSync, writeFileSync } from "node:fs";
const c = JSON.parse(
  readFileSync("runs/m5r2-veroni/canonical-menu.json", "utf8"),
);
const by: Record<string, string[]> = {
  READY: [],
  WARNING: [],
  MANUAL_REVIEW_REQUIRED: [],
  BLOCKED: [],
};
for (const cat of c.categories) {
  for (const p of cat.products) {
    by[p.status]!.push(`${p.sourceMenuNumber ?? "?"} ${p.name}`);
  }
}
writeFileSync(
  "runs/m5r2-veroni/status-lists.json",
  JSON.stringify(by, null, 2),
);
console.log(
  Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])),
);
