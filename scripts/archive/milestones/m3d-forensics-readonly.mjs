/**
 * M3D — READ-ONLY Veroni active-state forensics for product 18.
 * Never toggles, updates, deletes, or creates.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(join(root, ".env"));

const base = "https://veronipizza.dk";
const authPath = join(root, "playwright", ".auth", "tah-admin-veroni.json");
const outDir = join(root, "runs", "discovery", `m3d-forensics-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: existsSync(authPath) ? authPath : undefined,
});
const page = await context.newPage();

// Capture raw HTML via response for edit page
let rawEditHtml = null;
page.on("response", async (res) => {
  try {
    if (/\/admin\/menu\/18\/edit\/?$/i.test(new URL(res.url()).pathname) && res.request().method() === "GET") {
      rawEditHtml = await res.text();
    }
  } catch {
    /* ignore */
  }
});

await page.goto(`${base}/admin/menu`, { waitUntil: "domcontentloaded" });
if (/\/login/i.test(page.url())) {
  const email = process.env.TAH_ADMIN_EMAIL;
  const password = process.env.TAH_ADMIN_PASSWORD;
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
}

const listEvidence = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => {
    const cells = [...tr.querySelectorAll("td")];
    const edit =
      tr.querySelector("a[href*='/admin/menu/'][href$='/edit']")?.getAttribute("href") || "";
    const id = /\/admin\/menu\/(\d+)/i.exec(edit)?.[1] || null;
    const statusTd = cells[5];
    return {
      databaseId: id,
      menuNumber: (cells[0]?.textContent || "").replace(/\s+/g, " ").trim(),
      name: (tr.querySelector("td span")?.textContent || "").replace(/\s+/g, " ").trim(),
      statusText: (statusTd?.textContent || "").replace(/\s+/g, " ").trim(),
      statusHtml: statusTd?.innerHTML || null,
      statusClass: statusTd?.className || null,
      statusDataAttrs: statusTd
        ? Object.fromEntries([...statusTd.attributes].map((a) => [a.name, a.value]))
        : null,
      rowClass: tr.className || null,
      rowHtmlSnippet: tr.outerHTML.slice(0, 1200),
      anchors: [...tr.querySelectorAll("a[href]")].map((a) => ({
        text: (a.textContent || "").replace(/\s+/g, " ").trim(),
        href: a.getAttribute("href"),
      })),
    };
  });
  return { rowCount: rows.length, rows };
});

await page.goto(`${base}/admin/menu/18/edit`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);

const editDom = await page.evaluate(() => {
  const form =
    document.querySelector("form:has(#menu_number)") ||
    document.querySelector("#menu_number")?.closest("form");
  const active = form?.querySelector("#active") || document.querySelector("#active");
  const allControls = [...(form || document).querySelectorAll("input,select,textarea")].map(
    (el) => ({
      tag: el.tagName,
      type: el.type || null,
      name: el.name || null,
      id: el.id || null,
      value: el.type === "file" ? null : el.value,
      checked: el.type === "checkbox" || el.type === "radio" ? el.checked : undefined,
      defaultChecked:
        el.type === "checkbox" || el.type === "radio" ? el.defaultChecked : undefined,
      disabled: el.disabled,
      hasCheckedAttr: el.hasAttribute("checked"),
      checkedAttr: el.getAttribute("checked"),
    }),
  );
  const statusLike = allControls.filter((c) =>
    /active|visible|hidden|status|enabled|published|available|availability/i.test(
      `${c.name || ""} ${c.id || ""}`,
    ),
  );
  const labels = [...document.querySelectorAll("label")].map((l) => ({
    for: l.getAttribute("for"),
    text: (l.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
  }));
  return {
    url: location.pathname,
    formAction: form?.getAttribute("action") || null,
    formMethod: form?.getAttribute("method") || null,
    active: active
      ? {
          tag: active.tagName,
          type: active.type,
          name: active.name,
          id: active.id,
          valueAttr: active.getAttribute("value"),
          hasCheckedAttr: active.hasAttribute("checked"),
          checkedAttr: active.getAttribute("checked"),
          checkedProperty: active.checked,
          defaultChecked: active.defaultChecked,
          disabled: active.disabled,
          outerHTML: active.outerHTML,
          label:
            document.querySelector(`label[for='${active.id}']`)?.textContent?.replace(/\s+/g, " ").trim() ||
            null,
        }
      : null,
    statusLikeControls: statusLike,
    allControlNames: [...new Set(allControls.map((c) => c.name).filter(Boolean))],
    labels: labels.filter((l) => /aktiv|status|skjult|tilgæng/i.test(l.text)),
    hiddenSameNameActive: allControls.filter(
      (c) => c.name === "active" && c.type === "hidden",
    ),
  };
});

// Re-check after extra wait for JS mutations
await page.waitForTimeout(2000);
const editDomAfterWait = await page.evaluate(() => {
  const active = document.querySelector("#active");
  return active
    ? {
        checkedProperty: active.checked,
        defaultChecked: active.defaultChecked,
        hasCheckedAttr: active.hasAttribute("checked"),
        outerHTML: active.outerHTML,
      }
    : null;
});

const rawActiveSnippet = rawEditHtml
  ? (() => {
      const m = /<input[^>]*id=["']active["'][^>]*>/i.exec(rawEditHtml);
      const m2 = /<input[^>]*name=["']active["'][^>]*>/i.exec(rawEditHtml);
      return { byId: m?.[0] || null, byName: m2?.[0] || null };
    })()
  : null;

await page.goto(`${base}/admin/menu/18`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
const showPage = await page.evaluate(() => {
  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  return {
    url: location.pathname,
    title: document.title,
    headings: [...document.querySelectorAll("h1,h2,h3,h4")].map((h) =>
      (h.textContent || "").replace(/\s+/g, " ").trim(),
    ),
    textSample: text.slice(0, 2500),
    hasSkjult: /Skjult/i.test(text),
    hasTilgaengelig: /Tilgængelig/i.test(text),
    hasAktiv: /Aktiv/i.test(text),
    inputs: [...document.querySelectorAll("input,select,textarea")].map((el) => ({
      name: el.name,
      id: el.id,
      type: el.type,
      value: el.type === "checkbox" ? String(el.checked) : el.value?.slice?.(0, 80),
    })),
  };
});

// Public site + network capture
const publicPage = await context.newPage();
const publicXhr = [];
publicPage.on("response", async (res) => {
  const url = res.url();
  const ct = res.headers()["content-type"] || "";
  if (!/json|javascript|text/i.test(ct) && !/menu|product|item|api/i.test(url)) return;
  try {
    const body = await res.text();
    if (/18|99001|TAH_CANARY|active|hidden|skjult/i.test(body) || /menu/i.test(url)) {
      publicXhr.push({
        url: url.slice(0, 300),
        status: res.status(),
        ct,
        mentionsCanary: /TAH_CANARY|99001/.test(body),
        mentionsId18: /["']id["']\s*:\s*18\b|"id":18|\/menu\/18\b/.test(body),
        sample: body.slice(0, 1500),
      });
    }
  } catch {
    /* ignore */
  }
});
await publicPage.goto(base + "/", { waitUntil: "networkidle" });
await publicPage
  .getByRole("button", { name: /allow cookies/i })
  .click({ timeout: 3000 })
  .catch(() => {});
await publicPage.waitForTimeout(2000);
const publicEvidence = await publicPage.evaluate(() => {
  const text = document.body.innerText || "";
  return {
    visibleCanary: text.includes("__TAH_CANARY_PRODUCT_M3__"),
    visible99001: text.includes("99001"),
    tahMentions: (text.match(/TAH_CANARY/g) || []).length,
  };
});

const report = {
  host: "veronipizza.dk",
  productId: "18",
  listEvidence,
  editDom,
  editDomAfterWait,
  rawActiveSnippet,
  rawHtmlLength: rawEditHtml?.length ?? 0,
  showPage,
  publicEvidence,
  publicXhr: publicXhr.slice(0, 30),
};

writeFileSync(join(outDir, "forensics.json"), JSON.stringify(report, null, 2));
if (rawEditHtml) {
  // Store only active-related slices, not full page with tokens if possible
  const slice =
    rawEditHtml.includes('id="active"')
      ? rawEditHtml.slice(
          Math.max(0, rawEditHtml.indexOf('id="active"') - 400),
          rawEditHtml.indexOf('id="active"') + 400,
        )
      : null;
  writeFileSync(
    join(outDir, "active-html-slice.txt"),
    slice || rawActiveSnippet?.byId || "NOT_FOUND",
  );
}

console.log(
  JSON.stringify(
    {
      outDir,
      productCount: listEvidence.rowCount,
      product18: listEvidence.rows.find((r) => r.databaseId === "18") || null,
      otherProducts: listEvidence.rows.filter((r) => r.databaseId !== "18").map((r) => r.name),
      active: editDom.active,
      afterWait: editDomAfterWait,
      rawActiveSnippet,
      publicEvidence,
      xhrHits: publicXhr.length,
      showHasSkjult: showPage.hasSkjult,
    },
    null,
    2,
  ),
);

await context.close();
await browser.close();
