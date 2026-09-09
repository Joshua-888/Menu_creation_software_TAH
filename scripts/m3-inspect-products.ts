import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.ts";

function loadEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: "playwright/.auth/tah-admin-veroni.json",
});
const page = await ctx.newPage();
const adapter = new TahAdminAdapterV1({
  page,
  baseUrl: "https://veronipizza.dk",
  expectedHost: "veronipizza.dk",
});
const list = await adapter.listProducts();
console.log("LIST", JSON.stringify(list, null, 2));
for (const item of list) {
  if (!item.databaseId) continue;
  const p = await adapter.readProduct(item.databaseId);
  console.log(
    "PRODUCT",
    JSON.stringify(
      {
        databaseId: p.databaseId,
        menuNumber: p.menuNumber,
        name: p.name,
        description: p.description,
        active: p.active,
        basePriceOre: p.basePriceOre,
        variants: p.variants,
        ingredients: p.ingredients,
        categoryIds: p.categoryIds,
        statusText: item.statusText,
      },
      null,
      2,
    ),
  );
}
await browser.close();
