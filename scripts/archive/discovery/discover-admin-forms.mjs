import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(join(process.cwd(), ".env"));
const baseUrl = (process.env.TAH_ADMIN_BASE_URL || "").replace(/\/$/, "");
const authPath = join(process.cwd(), "playwright", ".auth", "tah-admin.json");
const outDir = join(process.cwd(), "runs", "discovery", `m2-veroni-forms-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: authPath });
const page = await context.newPage();

try {
  await page.goto(`${baseUrl}/admin/menu/create`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const createExtras = await page.evaluate(`({
    ids: Object.fromEntries(
      [
        "add-variant","variant-list","blueprint-variant",
        "add-ingredient","ingredient-list","blueprint-ingredient","ingredients",
        "add-addon","addon-list","blueprint-addon","add-extra","extra-list","blueprint-extra",
        "menu_number","name","description","price","image","active"
      ].map((id) => {
        const el = document.getElementById(id);
        return [id, el ? {
          id,
          tag: el.tagName.toLowerCase(),
          className: String(el.className).slice(0, 120),
          htmlSnippet: el.outerHTML.slice(0, 1500)
        } : null];
      })
    ),
    related: [...document.querySelectorAll("[id]")]
      .filter((el) => /variant|ingred|addon|tilbeh|extra|blueprint|allergen/i.test(el.id))
      .map((el) => ({
        id: el.id,
        tag: el.tagName.toLowerCase(),
        className: String(el.className).slice(0, 100),
        snippet: el.outerHTML.slice(0, 600)
      })),
    templates: [...document.querySelectorAll("template")].map((t) => ({
      id: t.id,
      snippet: t.innerHTML.slice(0, 1200)
    })),
    sections: [...document.querySelectorAll("h1,h2,h3,h4,legend,label,strong")]
      .filter((el) => /ingrediens|tilbehør|varianter|pris|menu|aktiv/i.test(el.textContent || ""))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80)
      }))
  })`);

  writeFileSync(join(outDir, "create-extras.json"), JSON.stringify(createExtras, null, 2));

  await page.goto(`${baseUrl}/admin/categories/1/edit`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  const categoryEdit = await page.evaluate(`({
    url: location.href.replace(/^https?:\\/\\/[^/]+/i, ""),
    fields: [...document.querySelectorAll("input, textarea, select")].map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      label: el.labels && el.labels[0]
        ? (el.labels[0].textContent || "").replace(/\\s+/g, " ").trim()
        : "",
      hasValue: Boolean(el.value)
    })),
    buttons: [...document.querySelectorAll("button, input[type=submit]")].map((el) => ({
      text: (el.textContent || el.value || "").replace(/\\s+/g, " ").trim().slice(0, 60),
      type: el.getAttribute("type") || ""
    })),
    headings: [...document.querySelectorAll("h1,h2,h3")].map((h) =>
      (h.textContent || "").replace(/\\s+/g, " ").trim()
    )
  })`);
  writeFileSync(join(outDir, "category-edit.json"), JSON.stringify(categoryEdit, null, 2));

  await page.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const contextInfo = await page.evaluate(`({
    url: location.href.replace(/^https?:\\/\\/[^/]+/i, ""),
    title: document.title,
    host: location.host
  })`);
  writeFileSync(join(outDir, "dashboard-context.json"), JSON.stringify(contextInfo, null, 2));

  await page.goto(`${baseUrl}/admin/menu`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const menuCount = await page.evaluate(`({
    rows: document.querySelectorAll("table tbody tr").length,
    bodyTextSample: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 400)
  })`);
  writeFileSync(join(outDir, "menu-empty-check.json"), JSON.stringify(menuCount, null, 2));

  console.log(JSON.stringify({
    ok: true,
    outDir,
    relatedIds: createExtras.related.map((r) => r.id),
    templateIds: createExtras.templates.map((t) => t.id),
    categoryEditFields: categoryEdit.fields.map((f) => f.name).filter(Boolean),
    menuRows: menuCount.rows,
    host: contextInfo.host,
  }, null, 2));
} finally {
  await browser.close();
}
