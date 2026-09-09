/**
 * READ-ONLY Veroni/TAH admin discovery.
 * - Loads credentials from local .env only
 * - Never prints secrets
 * - Never clicks Save / submit product forms / mutate data
 * - Only navigates list + opens edit pages for inspection, then leaves without saving
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

function loadEnvFile(path: string): void {
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
    if (!(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

async function dismissCookies(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /allow cookies/i });
  if ((await btn.count()) > 0) {
    await btn.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function login(page: Page, baseUrl: string): Promise<void> {
  const email = requireEnv("TAH_ADMIN_EMAIL");
  const password = requireEnv("TAH_ADMIN_PASSWORD");
  await page.goto(new URL("/login", baseUrl).toString(), {
    waitUntil: "domcontentloaded",
  });
  await dismissCookies(page);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  if (/\/login/i.test(page.url())) {
    throw new Error("Login appears to have failed — still on /login");
  }
}

async function capturePageSemantics(page: Page) {
  return page.evaluate(() => {
    const body = document.body;
    const attrs: Record<string, string> = {};
    for (const a of body.attributes) {
      if (/version|build|testid|data-/i.test(a.name)) {
        attrs[a.name] = a.value.slice(0, 200);
      }
    }
    const testIds = [...document.querySelectorAll("[data-testid]")]
      .map((el) => el.getAttribute("data-testid") || "")
      .filter(Boolean)
      .slice(0, 300);
    const labels = [...document.querySelectorAll("label")]
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 200);
    const inputs = [...document.querySelectorAll("input, textarea, select")].map(
      (el) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        return {
          tag: input.tagName.toLowerCase(),
          type: (input as HTMLInputElement).type || "",
          name: input.getAttribute("name") || "",
          id: input.id || "",
          placeholder: input.getAttribute("placeholder") || "",
          ariaLabel: input.getAttribute("aria-label") || "",
          testId: input.getAttribute("data-testid") || "",
          labelText:
            input.labels && input.labels[0]
              ? (input.labels[0].textContent || "").replace(/\s+/g, " ").trim()
              : "",
        };
      },
    );
    const links = [...document.querySelectorAll("a[href]")]
      .map((a) => ({
        text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        href: a.getAttribute("href") || "",
      }))
      .filter((l) => /admin|menu|edit|categor|product|item/i.test(l.href + l.text))
      .slice(0, 200);
    const buttons = [
      ...document.querySelectorAll("button, [role='button'], input[type='submit']"),
    ]
      .map((el) => ({
        text: (
          el.textContent ||
          (el as HTMLInputElement).value ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80),
        type: el.getAttribute("type") || "",
        testId: el.getAttribute("data-testid") || "",
      }))
      .filter((b) => b.text)
      .slice(0, 150);
    const headings = [...document.querySelectorAll("h1,h2,h3,h4")]
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 40);
    const navTexts = [...document.querySelectorAll("nav a, .sidebar a, aside a")]
      .map((el) => ({
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        href: el.getAttribute("href") || "",
      }))
      .slice(0, 80);

    // Table-ish rows / product list hints (sanitized: no full cell text dump of long content)
    const tableHeaders = [...document.querySelectorAll("table thead th, [role='columnheader']")]
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 40);

    return {
      url: location.href,
      title: document.title,
      bodyAttrs: attrs,
      htmlLang: document.documentElement.lang || "",
      testIds,
      labels,
      inputs,
      links,
      buttons,
      headings,
      navTexts,
      tableHeaders,
    };
  });
}

async function main(): Promise<void> {
  loadEnvFile(join(process.cwd(), ".env"));
  const baseUrl = requireEnv("TAH_ADMIN_BASE_URL").replace(/\/$/, "");
  const menuPath = process.env.TAH_ADMIN_MENU_PATH?.trim() || "/admin/menu";
  const outDir = join(process.cwd(), "runs", "discovery", `m2-veroni-${Date.now()}`);
  const authDir = join(process.cwd(), "playwright", ".auth");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const report: Record<string, unknown> = {
    target: { baseUrl, menuPath, restaurantHint: "Veroni Pizza" },
    readOnly: true,
    mutationsPerformed: false,
  };

  try {
    await login(page, baseUrl);
    await context.storageState({ path: join(authDir, "tah-admin.json") });

    const menuUrl = new URL(menuPath, baseUrl).toString();
    await page.goto(menuUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await dismissCookies(page);

    const menuSemantics = await capturePageSemantics(page);
    writeFileSync(
      join(outDir, "menu-list.semantics.json"),
      JSON.stringify(menuSemantics, null, 2),
      "utf8",
    );

    // Collect edit hrefs only (no clicks that save)
    const editHrefs = await page.evaluate(() => {
      const hrefs = [...document.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href") || "")
        .filter((h) => /\/admin\/menu\/\d+/i.test(h) || /edit/i.test(h));
      return [...new Set(hrefs)].slice(0, 20);
    });

    report.menuListUrl = page.url();
    report.editHrefSamples = editHrefs.map((h) => {
      // sanitize: keep pattern, optionally keep numeric id as structure evidence
      return h.replace(/https?:\/\/[^/]+/i, "");
    });

    // Open first edit page if available — READ ONLY (no form submit)
    let editSemantics = null;
    const firstEdit = editHrefs[0];
    if (firstEdit) {
      const editUrl = firstEdit.startsWith("http")
        ? firstEdit
        : new URL(firstEdit, baseUrl).toString();
      await page.goto(editUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      editSemantics = await capturePageSemantics(page);
      writeFileSync(
        join(outDir, "product-edit.semantics.json"),
        JSON.stringify(editSemantics, null, 2),
        "utf8",
      );
      report.productEditUrlSample = page.url().replace(/https?:\/\/[^/]+/i, "");
    }

    // Try category-related links from menu page without mutating
    await page.goto(menuUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const categoryLinks = await page.evaluate(() => {
      return [...document.querySelectorAll("a[href]")]
        .map((a) => ({
          text: (a.textContent || "").replace(/\s+/g, " ").trim(),
          href: a.getAttribute("href") || "",
        }))
        .filter((l) => /categor/i.test(l.href + l.text))
        .slice(0, 30);
    });
    report.categoryLinkSamples = categoryLinks.map((l) => ({
      text: l.text.slice(0, 60),
      href: l.href.replace(/https?:\/\/[^/]+/i, ""),
    }));

    if (categoryLinks[0]?.href) {
      const catHref = categoryLinks[0].href;
      const catUrl = catHref.startsWith("http")
        ? catHref
        : new URL(catHref, baseUrl).toString();
      await page.goto(catUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const catSemantics = await capturePageSemantics(page);
      writeFileSync(
        join(outDir, "category.semantics.json"),
        JSON.stringify(catSemantics, null, 2),
        "utf8",
      );
      report.categoryPageUrl = page.url().replace(/https?:\/\/[^/]+/i, "");
    }

    // Screenshot of menu list only (no credential UI) — still under /runs (gitignored)
    await page.goto(menuUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(outDir, "menu-list.png"),
      fullPage: false,
    });

    report.outDir = outDir;
    report.authStatePath = "playwright/.auth/tah-admin.json";
    writeFileSync(join(outDir, "summary.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, outDir, menuListUrl: report.menuListUrl, editSamples: report.editHrefSamples, categoryLinks: report.categoryLinkSamples }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("DISCOVERY_FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
