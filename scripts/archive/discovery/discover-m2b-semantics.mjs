import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env");
const base = "https://newwaypizzaringsted.dk";
const out = join("runs", "discovery", `m2b-semantics-${Date.now()}`);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: "playwright/.auth/tah-admin-newway.json",
});
const page = await context.newPage();

await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const publicInfo = await page.evaluate(() => {
  const texts = (document.body.innerText || "")
    .split(/\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  const hits = [];
  for (let i = 0; i < texts.length; i++) {
    if (/Hvidløgsbrød|Hawaii|Margherita|Pommes Frites \(Stor\)|4A\. Bacoløg/i.test(texts[i])) {
      hits.push(texts.slice(i, i + 10));
    }
  }
  return hits.slice(0, 12);
});

const ids = ["1", "2", "12", "4", "18"];
const forms = [];
for (const id of ids) {
  await page.goto(`${base}/admin/menu/${id}/edit`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const formInfos = [...document.querySelectorAll("form")].map((f) => ({
      action: (f.getAttribute("action") || "").replace(/^https?:\/\/[^/]+/i, ""),
      method: f.getAttribute("method") || "",
      methodOverride: f.querySelector("input[name=_method]")?.value || null,
      hasMenuNumber: !!f.querySelector("#menu_number"),
      submitTexts: [...f.querySelectorAll("button,input[type=submit]")]
        .map((b) => (b.textContent || b.value || "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
    }));
    return {
      url: location.pathname,
      menuNumber: document.querySelector("#menu_number")?.value || null,
      name: document.querySelector("#name")?.value || null,
      price: document.querySelector("#price")?.value || null,
      variants: [...document.querySelectorAll("tr.variant-form")].map((tr) => ({
        id: tr.querySelector('input[name*="[id]"]')?.value || null,
        name: tr.querySelector("input.variant-name")?.value || "",
        price: tr.querySelector("input.variant-price")?.value || "",
      })),
      ingredients: [...document.querySelectorAll("tr.ingredient-form")].map(
        (tr) => tr.querySelector("input.ingredient-name")?.value || "",
      ),
      additionsSample: [...document.querySelectorAll("tr.addition-form")]
        .slice(0, 5)
        .map((tr) => ({
          id: tr.querySelector('input[name*="[id]"]')?.value || null,
          name: tr.querySelector("input.addition-name")?.value || "",
          price: tr.querySelector("input.addition-price")?.value || "",
        })),
      formInfos,
    };
  });
  const basePrice = Number(info.price);
  const equations = info.variants.map((v) => {
    const vp = Number(v.price);
    return {
      name: v.name,
      adminPrice: vp,
      asSurchargeFinal: basePrice + vp,
      asAbsolute: vp,
    };
  });
  forms.push({ ...info, equations });
}

writeFileSync(join(out, "semantics.json"), JSON.stringify({ publicInfo, forms }, null, 2));
console.log(
  JSON.stringify(
    {
      out,
      forms: forms.map((f) => ({
        path: f.url,
        menuNumber: f.menuNumber,
        name: f.name,
        price: f.price,
        variants: f.variants,
        equations: f.equations,
        updateForm: f.formInfos.find((x) => x.hasMenuNumber) || null,
      })),
      publicInfo,
    },
    null,
    2,
  ),
);
await browser.close();
