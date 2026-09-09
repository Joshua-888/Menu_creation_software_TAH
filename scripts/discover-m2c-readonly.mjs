/**
 * M2C read-only: observe public non-default variant finals + live readProduct.
 * Never submits forms, never clicks Opdater/Skab/Slet, never places orders.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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
loadEnv(join(root, ".env"));

const base = "https://newwaypizzaringsted.dk";
const outDir = join(root, "runs", "discovery", `m2c-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const authPath = join(root, "playwright", ".auth", "tah-admin-newway.json");

async function ensureAuth(browser) {
  if (existsSync(authPath)) {
    const ctx = await browser.newContext({ storageState: authPath });
    const page = await ctx.newPage();
    await page.goto(`${base}/admin/menu`, { waitUntil: "domcontentloaded" });
    if (!/\/login/i.test(page.url())) return { context: ctx, page };
    await ctx.close();
  }
  const email = process.env.TAH_ADMIN_EMAIL;
  const password = process.env.TAH_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Missing TAH_ADMIN_EMAIL/PASSWORD");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
  if (/\/login/i.test(page.url())) throw new Error("Login failed");
  mkdirSync(dirname(authPath), { recursive: true });
  await ctx.storageState({ path: authPath });
  return { context: ctx, page };
}

const browser = await chromium.launch({ headless: true });

// ---------- PUBLIC: reveal non-default variant prices ----------
const publicCtx = await browser.newContext();
const publicPage = await publicCtx.newPage();
await publicPage.goto(base + "/", { waitUntil: "networkidle" });
await publicPage.waitForTimeout(2000);

const publicSnapshot = await publicPage.evaluate(() => {
  return {
    title: document.title,
    url: location.href,
    bodySample: (document.body.innerText || "").slice(0, 2000),
  };
});
writeFileSync(join(outDir, "public-home.json"), JSON.stringify(publicSnapshot, null, 2));

// Try common TAH patterns: click product cards / open modal with size options
const candidateNames = [
  "Hvidløgsbrød",
  "Vesuvio",
  "Hawaii",
  "Margherita",
  "O sole mio",
];

const publicVariantEvidence = [];

for (const name of candidateNames) {
  const loc = publicPage.getByText(name, { exact: false }).first();
  if ((await loc.count()) === 0) continue;
  try {
    await loc.click({ timeout: 5000 });
    await publicPage.waitForTimeout(1200);
  } catch {
    continue;
  }

  const panel = await publicPage.evaluate((productName) => {
    const texts = (document.body.innerText || "")
      .split(/\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    // Collect lines near size/variant keywords
    const hits = [];
    for (let i = 0; i < texts.length; i++) {
      if (/Alm|Almindelig|Deep|Fam|Familie|kr/i.test(texts[i])) {
        hits.push({ i, text: texts[i] });
      }
    }
    // Radio/option labels
    const options = [...document.querySelectorAll("label, button, [role='radio'], li, .variant, .size")]
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => t && /Alm|Deep|Fam|Familie|Almindelig|kr\.?/i.test(t))
      .slice(0, 40);
    // Inputs with prices nearby
    const priced = [...document.querySelectorAll("*")]
      .filter((el) => {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        return t.length < 80 && /(Deep|Fam|Familie|Alm)/i.test(t) && /\d+\s*kr/i.test(t);
      })
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .slice(0, 30);
    return {
      productName,
      url: location.href,
      options,
      priced,
      nearbyHits: hits.slice(0, 60),
      dialogText: (
        document.querySelector('[role="dialog"], .modal, .drawer, .product-modal')
          ?.textContent || ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1500),
    };
  }, name);

  publicVariantEvidence.push(panel);

  // Try selecting Deep / Fam radio if present (read-only reveal; do not add to cart)
  for (const variantLabel of ["Deep", "Deep pan", "Fam", "Familie", "Family"]) {
    const v = publicPage.getByText(variantLabel, { exact: false }).first();
    if ((await v.count()) === 0) continue;
    try {
      await v.click({ timeout: 2000 });
      await publicPage.waitForTimeout(600);
      const after = await publicPage.evaluate(() => {
        const priceEls = [...document.querySelectorAll("*")]
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter((t) => t.length < 40 && /^\d+([.,]\d{2})?\s*kr\.?$/i.test(t));
        const totalish = [...document.querySelectorAll("*")]
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter(
            (t) =>
              t.length < 60 &&
              /(pris|total|i alt)/i.test(t) &&
              /\d+\s*kr/i.test(t),
          )
          .slice(0, 20);
        return { priceEls: [...new Set(priceEls)].slice(0, 20), totalish };
      });
      publicVariantEvidence.push({
        productName: name,
        selectedVariant: variantLabel,
        afterClick: after,
      });
    } catch {
      /* ignore */
    }
  }

  // Close modal if possible without mutating
  for (const closer of ["Luk", "Close", "Annuller", "Cancel"]) {
    const c = publicPage.getByRole("button", { name: new RegExp(`^${closer}$`, "i") });
    if ((await c.count()) > 0) {
      try {
        await c.first().click({ timeout: 1000 });
        await publicPage.waitForTimeout(400);
      } catch {
        /* ignore */
      }
      break;
    }
  }
  // Escape
  await publicPage.keyboard.press("Escape").catch(() => {});
  await publicPage.waitForTimeout(400);
}

writeFileSync(
  join(outDir, "public-variants.json"),
  JSON.stringify(publicVariantEvidence, null, 2),
);

// Also dump network JSON that might contain variant prices
const apiHits = [];
publicPage.on("response", async (res) => {
  const url = res.url();
  if (!/menu|product|item|variant/i.test(url)) return;
  if (!/json|javascript/i.test(res.headers()["content-type"] || "") && !url.includes("/api"))
    return;
  try {
    const body = await res.text();
    if (body.length < 500000 && /Deep|Fam|price|variant/i.test(body)) {
      apiHits.push({ url, sample: body.slice(0, 8000) });
    }
  } catch {
    /* ignore */
  }
});
await publicPage.goto(base + "/", { waitUntil: "networkidle" });
await publicPage.waitForTimeout(2500);
writeFileSync(join(outDir, "public-api-hits.json"), JSON.stringify(apiHits, null, 2));

await publicCtx.close();

// ---------- ADMIN: live readProduct via adapter ----------
const { context: adminCtx, page: adminPage } = await ensureAuth(browser);

// Dynamic import compiled? Use tsx path - this script is mjs so import built JS from src via tsx not available.
// Inline evaluate mirror of readProduct for certification, AND call via node --import tsx
const require = createRequire(import.meta.url);
// Prefer spawning logic via evaluate equivalent then also write a companion ts runner.

const productIds = ["1", "2", "12", "4", "18"];
const adminSnapshots = [];
for (const id of productIds) {
  await adminPage.goto(`${base}/admin/menu/${id}/edit`, {
    waitUntil: "domcontentloaded",
  });
  await adminPage.waitForTimeout(700);
  const snap = await adminPage.evaluate(() => {
    const form =
      document.querySelector("form:has(#menu_number)") ||
      document.querySelector("#menu_number")?.closest("form");
    const root = form || document;
    const val = (sel) => root.querySelector(sel)?.value ?? null;
    const checked = (sel) => root.querySelector(sel)?.checked ?? null;
    return {
      url: location.pathname,
      menuNumber: val("#menu_number"),
      name: val("#name"),
      description: val("#description"),
      basePrice: val("#price"),
      active: checked("#active"),
      categoryIds: [...root.querySelectorAll("input[name='categories[]']")]
        .filter((el) => el.checked)
        .map((el) => {
          const m = /category-(\d+)/i.exec(el.id || "");
          return m?.[1] || el.value;
        }),
      variants: [...root.querySelectorAll("tr.variant-form")].map((tr, index) => ({
        index,
        id: tr.querySelector('input[name*="[id]"]')?.value || null,
        name: tr.querySelector("input.variant-name")?.value || "",
        price: tr.querySelector("input.variant-price")?.value || "",
      })),
      ingredients: [...root.querySelectorAll("tr.ingredient-form")].map(
        (tr, index) => ({
          index,
          id: tr.querySelector('input[name*="[id]"]')?.value || null,
          name: tr.querySelector("input.ingredient-name")?.value || "",
        }),
      ),
      additionsSample: [...root.querySelectorAll("tr.addition-form")]
        .slice(0, 8)
        .map((tr, index) => ({
          index,
          id: tr.querySelector('input[name*="[id]"]')?.value || null,
          name: tr.querySelector("input.addition-name")?.value || "",
          price: tr.querySelector("input.addition-price")?.value || "",
        })),
      additionCount: root.querySelectorAll("tr.addition-form").length,
      listStatusHint: null,
    };
  });
  adminSnapshots.push(snap);
}

// Menu list active/status for those products
await adminPage.goto(`${base}/admin/menu`, { waitUntil: "domcontentloaded" });
const listRows = await adminPage.evaluate(() => {
  return [...document.querySelectorAll("table tbody tr")].map((tr) => {
    const cells = [...tr.querySelectorAll("td")].map((td) =>
      (td.textContent || "").replace(/\s+/g, " ").trim(),
    );
    const edit =
      tr
        .querySelector("a[href*='/admin/menu/'][href$='/edit']")
        ?.getAttribute("href") || "";
    const id = /\/admin\/menu\/(\d+)/i.exec(edit)?.[1] || null;
    const name =
      (tr.querySelector("td span")?.textContent || "").replace(/\s+/g, " ").trim() ||
      cells[2] ||
      "";
    return {
      databaseId: id,
      menuNumber: cells[0] || null,
      name,
      status: cells[5] || null,
      price: cells[4] || null,
    };
  });
});

writeFileSync(
  join(outDir, "admin-edit-snapshots.json"),
  JSON.stringify({ adminSnapshots, listRows }, null, 2),
);

await adminCtx.close();
await browser.close();

console.log(JSON.stringify({ outDir, publicEvidenceCount: publicVariantEvidence.length, adminCount: adminSnapshots.length, apiHits: apiHits.length }, null, 2));
