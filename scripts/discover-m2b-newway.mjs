/**
 * M2B READ-ONLY discovery for populated NEW WAY admin.
 * Never submits forms or clicks Skab/Opdater/Slet.
 */
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
const baseUrl = "https://newwaypizzaringsted.dk";
const email = process.env.TAH_ADMIN_EMAIL;
const password = process.env.TAH_ADMIN_PASSWORD;
if (!email || !password) {
  console.error("Missing TAH_ADMIN_EMAIL/PASSWORD in .env");
  process.exit(1);
}

const outDir = join(process.cwd(), "runs", "discovery", `m2b-newway-${Date.now()}`);
const authDir = join(process.cwd(), "playwright", ".auth");
mkdirSync(outDir, { recursive: true });
mkdirSync(authDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

async function dismissCookies() {
  const btn = page.getByRole("button", { name: /allow cookies/i });
  if ((await btn.count()) > 0) await btn.click().catch(() => undefined);
}

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await dismissCookies();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  if (/\/login/i.test(page.url())) throw new Error("Login failed");
  await context.storageState({ path: join(authDir, "tah-admin-newway.json") });

  await page.goto(`${baseUrl}/admin/menu`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const list = await page.evaluate(() => {
    const headers = [...document.querySelectorAll("table thead th")].map((th) =>
      (th.textContent || "").replace(/\s+/g, " ").trim(),
    );
    const rows = [...document.querySelectorAll("table tbody tr")].slice(0, 40).map((tr) => {
      const cells = [...tr.querySelectorAll("td")].map((td) =>
        (td.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      );
      const anchors = [...tr.querySelectorAll("a[href]")].map((a) => ({
        text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
        href: (a.getAttribute("href") || "").replace(/^https?:\/\/[^/]+/i, ""),
      }));
      const forms = [...tr.querySelectorAll("form")].map((f) => ({
        action: (f.getAttribute("action") || "").replace(/^https?:\/\/[^/]+/i, ""),
        method: f.getAttribute("method") || "",
      }));
      return { cells, anchors, forms, rowHtml: tr.outerHTML.slice(0, 700) };
    });
    return {
      url: location.href,
      headers,
      rowCount: document.querySelectorAll("table tbody tr").length,
      rows,
    };
  });
  writeFileSync(join(outDir, "menu-list.json"), JSON.stringify(list, null, 2));

  // Collect edit hrefs
  const editHrefs = [
    ...new Set(
      list.rows.flatMap((r) =>
        r.anchors
          .map((a) => a.href)
          .filter((h) => /\/admin\/menu\/\d+/i.test(h)),
      ),
    ),
  ].slice(0, 15);

  const products = [];
  for (const href of editHrefs) {
    const url = href.startsWith("http") ? href : `${baseUrl}${href}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const data = await page.evaluate(() => {
      const val = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.value : null;
      };
      const form = document.querySelector("form[action*='menu']") || document.querySelector("form");
      const categoryIds = [...document.querySelectorAll("input[name='categories[]']")]
        .filter((el) => el.checked)
        .map((el) => ({ id: el.id, value: el.value, label: el.labels?.[0]?.textContent?.trim() || "" }));
      const variants = [...document.querySelectorAll("tr.variant-form")].map((tr, i) => ({
        index: i,
        rowId: tr.id,
        name: tr.querySelector("input.variant-name")?.value || "",
        price: tr.querySelector("input.variant-price")?.value || "",
        nameAttr: tr.querySelector("input.variant-name")?.name || "",
        priceAttr: tr.querySelector("input.variant-price")?.name || "",
        hidden: [...tr.querySelectorAll("input[type=hidden]")].map((h) => ({
          name: h.name,
          value: h.value.slice(0, 40),
        })),
        html: tr.outerHTML.slice(0, 500),
      }));
      const ingredients = [...document.querySelectorAll("tr.ingredient-form")].map((tr, i) => ({
        index: i,
        rowId: tr.id,
        name: tr.querySelector("input.ingredient-name")?.value || "",
        nameAttr: tr.querySelector("input.ingredient-name")?.name || "",
        hidden: [...tr.querySelectorAll("input[type=hidden]")].map((h) => ({
          name: h.name,
          value: h.value.slice(0, 40),
        })),
      }));
      const additions = [...document.querySelectorAll("tr.addition-form")].map((tr, i) => ({
        index: i,
        rowId: tr.id,
        name: tr.querySelector("input.addition-name")?.value || "",
        price: tr.querySelector("input.addition-price")?.value || "",
        nameAttr: tr.querySelector("input.addition-name")?.name || "",
        priceAttr: tr.querySelector("input.addition-price")?.name || "",
        hidden: [...tr.querySelectorAll("input[type=hidden]")].map((h) => ({
          name: h.name,
          value: h.value.slice(0, 40),
        })),
      }));
      const allHidden = [...document.querySelectorAll("form input[type=hidden]")].map((h) => ({
        name: h.name,
        valueLen: (h.value || "").length,
        valuePreview: ["_token", "_method"].includes(h.name) ? "[redacted-or-method]" : h.value.slice(0, 30),
      }));
      return {
        url: location.href.replace(/^https?:\/\/[^/]+/i, ""),
        formAction: form ? (form.getAttribute("action") || "").replace(/^https?:\/\/[^/]+/i, "") : null,
        formMethod: form ? form.getAttribute("method") || "" : null,
        methodOverride: document.querySelector("input[name=_method]")?.value || null,
        menuNumber: val("#menu_number"),
        name: val("#name"),
        description: val("#description"),
        price: val("#price"),
        active: document.querySelector("#active")?.checked ?? null,
        imageExists: !!document.querySelector("img[src*='menu'], img[src*='storage'], .existing-image, a[href*='storage']"),
        imageInputs: [...document.querySelectorAll("#image, input[name=image]")].map((el) => ({
          tag: el.tagName,
          type: el.type,
          name: el.name,
        })),
        existingImageHtml: document.querySelector("img")
          ? document.querySelector("img")?.outerHTML.slice(0, 200)
          : null,
        categoryIds,
        variants,
        ingredients,
        additions,
        buttons: [...document.querySelectorAll("button, input[type=submit]")].map((b) =>
          (b.textContent || b.value || "").replace(/\s+/g, " ").trim().slice(0, 40),
        ).filter(Boolean),
        allHidden,
      };
    });
    const idMatch = /\/admin\/menu\/(\d+)/i.exec(data.url);
    products.push({
      databaseId: idMatch?.[1] || null,
      ...data,
    });
  }

  writeFileSync(join(outDir, "products-edit.json"), JSON.stringify(products, null, 2));

  // Sanitized summary for semantics analysis (no full descriptions dump in console)
  const summary = {
    outDir,
    rowCount: list.rowCount,
    editHrefs,
    samples: products.map((p) => ({
      databaseId: p.databaseId,
      menuNumber: p.menuNumber,
      name: p.name,
      price: p.price,
      active: p.active,
      formAction: p.formAction,
      formMethod: p.formMethod,
      methodOverride: p.methodOverride,
      variantCount: p.variants.length,
      variants: p.variants.map((v) => ({ name: v.name, price: v.price, rowId: v.rowId, hidden: v.hidden })),
      ingredientCount: p.ingredients.length,
      ingredients: p.ingredients.map((i) => i.name),
      additionCount: p.additions.length,
      additions: p.additions.map((a) => ({ name: a.name, price: a.price })),
      categoryIds: p.categoryIds.map((c) => c.value || c.id),
      menuNumberEqualsDbId: String(p.menuNumber) === String(p.databaseId),
    })),
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
