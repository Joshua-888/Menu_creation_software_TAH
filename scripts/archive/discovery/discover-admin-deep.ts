/**
 * Deeper READ-ONLY discovery pass. No form submissions. No saves.
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
    if (!(key in process.env) || !process.env[key]) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnvFile(join(process.cwd(), ".env"));
  const baseUrl = (process.env.TAH_ADMIN_BASE_URL || "").replace(/\/$/, "");
  const authPath = join(process.cwd(), "playwright", ".auth", "tah-admin.json");
  const outDir = join(process.cwd(), "runs", "discovery", `m2-veroni-deep-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: existsSync(authPath) ? authPath : undefined,
  });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/admin/menu`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    if (/\/login/i.test(page.url())) {
      throw new Error("Auth state expired — need re-login");
    }

    const menuDeep = await page.evaluate(() => {
      const tables = [...document.querySelectorAll("table")].map((table, ti) => {
        const headers = [...table.querySelectorAll("thead th")].map((th) =>
          (th.textContent || "").replace(/\s+/g, " ").trim(),
        );
        const rows = [...table.querySelectorAll("tbody tr")].slice(0, 15).map((tr) => {
          const cells = [...tr.querySelectorAll("td")].map((td) =>
            (td.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
          );
          const anchors = [...tr.querySelectorAll("a[href]")].map((a) => ({
            text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
            href: (a.getAttribute("href") || "").replace(/^https?:\/\/[^/]+/i, ""),
            title: a.getAttribute("title") || "",
            classes: a.className || "",
          }));
          const buttons = [...tr.querySelectorAll("button, form")].map((el) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
            action: el.getAttribute("action") || "",
            method: el.getAttribute("method") || "",
            classes: el.className || "",
          }));
          const dataAttrs: Record<string, string> = {};
          for (const a of tr.attributes) {
            if (a.name.startsWith("data-")) dataAttrs[a.name] = a.value.slice(0, 80);
          }
          return { cells, anchors, buttons, dataAttrs, rowHtmlSnippet: tr.outerHTML.slice(0, 500) };
        });
        return { index: ti, headers, rowCountHint: table.querySelectorAll("tbody tr").length, rows };
      });

      const allHrefs = [...document.querySelectorAll("a[href]")]
        .map((a) => (a.getAttribute("href") || "").replace(/^https?:\/\/[^/]+/i, ""))
        .filter((h) => /admin\/menu/.test(h));
      const uniqueMenuHrefs = [...new Set(allHrefs)].slice(0, 50);

      // Select category options (names only, truncate)
      const categorySelect = document.querySelector("select#category, select[name='category']");
      const categoryOptions = categorySelect
        ? [...categorySelect.querySelectorAll("option")].map((o) => ({
            value: (o as HTMLOptionElement).value,
            text: (o.textContent || "").trim().slice(0, 60),
          }))
        : [];

      return {
        url: location.href,
        tables,
        uniqueMenuHrefs,
        categoryOptions: categoryOptions.slice(0, 80),
        bodyDataset: { ...document.body.dataset },
        metaVersion: [...document.querySelectorAll("meta")].map((m) => ({
          name: m.getAttribute("name") || m.getAttribute("property") || "",
          content: (m.getAttribute("content") || "").slice(0, 80),
        })),
      };
    });

    writeFileSync(join(outDir, "menu-deep.json"), JSON.stringify(menuDeep, null, 2));

    // Inspect create form WITHOUT submitting
    await page.goto(`${baseUrl}/admin/menu/create`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const createForm = await page.evaluate(() => {
      const forms = [...document.querySelectorAll("form")].map((form) => ({
        action: (form.getAttribute("action") || "").replace(/^https?:\/\/[^/]+/i, ""),
        method: form.getAttribute("method") || "",
        id: form.id || "",
        className: form.className || "",
      }));
      const fields = [...document.querySelectorAll("input, textarea, select")].map((el) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const label =
          input.labels && input.labels[0]
            ? (input.labels[0].textContent || "").replace(/\s+/g, " ").trim()
            : "";
        // nearby label fallback
        let nearby = "";
        const prev = input.closest(".form-group, .mb-3, .field, tr, .row")?.querySelector("label");
        if (prev) nearby = (prev.textContent || "").replace(/\s+/g, " ").trim();
        return {
          tag: input.tagName.toLowerCase(),
          type: (input as HTMLInputElement).type || "",
          name: input.getAttribute("name") || "",
          id: input.id || "",
          placeholder: input.getAttribute("placeholder") || "",
          testId: input.getAttribute("data-testid") || "",
          ariaLabel: input.getAttribute("aria-label") || "",
          label,
          nearbyLabel: nearby,
          options:
            input.tagName.toLowerCase() === "select"
              ? [...input.querySelectorAll("option")]
                  .slice(0, 20)
                  .map((o) => ({
                    value: (o as HTMLOptionElement).value,
                    text: (o.textContent || "").trim().slice(0, 40),
                  }))
              : undefined,
        };
      });
      const buttons = [
        ...document.querySelectorAll("button, input[type='submit']"),
      ].map((el) => ({
        text: (
          el.textContent ||
          (el as HTMLInputElement).value ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80),
        type: el.getAttribute("type") || "",
        name: el.getAttribute("name") || "",
        className: el.className || "",
      }));
      const headings = [...document.querySelectorAll("h1,h2,h3,h4,legend")]
        .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 40);
      // Variant-related blocks
      const variantHints = [...document.querySelectorAll("*")]
        .filter((el) => /variant|tillæg|tilbehør|ingrediens|pris|aktiv|beskriv/i.test(el.className + " " + (el.id || "")))
        .slice(0, 40)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || "",
          className: String(el.className).slice(0, 80),
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
        }));
      return {
        url: location.href.replace(/^https?:\/\/[^/]+/i, ""),
        title: document.title,
        forms,
        fields,
        buttons,
        headings,
        variantHints,
        testIds: [...document.querySelectorAll("[data-testid]")].map((e) =>
          e.getAttribute("data-testid"),
        ),
      };
    });
    writeFileSync(join(outDir, "menu-create.form.json"), JSON.stringify(createForm, null, 2));

    // Categories page deep
    await page.goto(`${baseUrl}/admin/categories`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const categoriesDeep = await page.evaluate(() => {
      const tables = [...document.querySelectorAll("table")].map((table) => {
        const headers = [...table.querySelectorAll("thead th")].map((th) =>
          (th.textContent || "").replace(/\s+/g, " ").trim(),
        );
        const rows = [...table.querySelectorAll("tbody tr")].slice(0, 20).map((tr) => ({
          cells: [...tr.querySelectorAll("td")].map((td) =>
            (td.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50),
          ),
          anchors: [...tr.querySelectorAll("a[href]")].map((a) => ({
            text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
            href: (a.getAttribute("href") || "").replace(/^https?:\/\/[^/]+/i, ""),
          })),
        }));
        return { headers, rows, rowCount: table.querySelectorAll("tbody tr").length };
      });
      const createLink = [...document.querySelectorAll("a[href]")]
        .map((a) => (a.getAttribute("href") || "").replace(/^https?:\/\/[^/]+/i, ""))
        .find((h) => /categor.*create|create.*categor/i.test(h));
      return { url: location.href.replace(/^https?:\/\/[^/]+/i, ""), tables, createLink };
    });
    writeFileSync(
      join(outDir, "categories-deep.json"),
      JSON.stringify(categoriesDeep, null, 2),
    );

    // If we found a product edit href from table, open it
    const productEdit =
      menuDeep.uniqueMenuHrefs.find((h) => /\/admin\/menu\/\d+/.test(h)) ||
      menuDeep.tables
        .flatMap((t) => t.rows.flatMap((r) => r.anchors.map((a) => a.href)))
        .find((h) => /\/admin\/menu\/\d+/.test(h));

    let editForm = null;
    if (productEdit) {
      await page.goto(`${baseUrl}${productEdit}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      editForm = await page.evaluate(() => {
        const fields = [...document.querySelectorAll("input, textarea, select")].map((el) => {
          const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          const label =
            input.labels && input.labels[0]
              ? (input.labels[0].textContent || "").replace(/\s+/g, " ").trim()
              : "";
          const nearby =
            input.closest(".form-group, .mb-3, .field, tr, .row")?.querySelector("label");
          return {
            tag: input.tagName.toLowerCase(),
            type: (input as HTMLInputElement).type || "",
            name: input.getAttribute("name") || "",
            id: input.id || "",
            // DO NOT export values for text fields (customer data). Only structural.
            hasValue: Boolean((input as HTMLInputElement).value),
            valueLength: ((input as HTMLInputElement).value || "").length,
            testId: input.getAttribute("data-testid") || "",
            label,
            nearbyLabel: nearby
              ? (nearby.textContent || "").replace(/\s+/g, " ").trim()
              : "",
          };
        });
        const buttons = [
          ...document.querySelectorAll("button, input[type='submit']"),
        ].map((el) => ({
          text: (
            el.textContent ||
            (el as HTMLInputElement).value ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80),
          type: el.getAttribute("type") || "",
        }));
        return {
          url: location.href.replace(/^https?:\/\/[^/]+/i, ""),
          fields,
          buttons,
          headings: [...document.querySelectorAll("h1,h2,h3,h4,legend")]
            .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 40),
        };
      });
      writeFileSync(join(outDir, "menu-edit.form.json"), JSON.stringify(editForm, null, 2));
    }

    writeFileSync(
      join(outDir, "summary.json"),
      JSON.stringify(
        {
          outDir,
          productEditHref: productEdit || null,
          menuHrefSamples: menuDeep.uniqueMenuHrefs.slice(0, 30),
          tableHeaders: menuDeep.tables.map((t) => t.headers),
          categoryOptionCount: menuDeep.categoryOptions.length,
          createFormFieldNames: createForm.fields.map((f) => f.name).filter(Boolean),
          createButtons: createForm.buttons.map((b) => b.text),
          mutationsPerformed: false,
        },
        null,
        2,
      ),
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          outDir,
          productEditHref: productEdit || null,
          menuHrefSamples: menuDeep.uniqueMenuHrefs.slice(0, 20),
          tableHeaders: menuDeep.tables.map((t) => t.headers),
          createFieldNames: createForm.fields.map((f) => f.name).filter(Boolean),
          createButtons: createForm.buttons.map((b) => b.text),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("DEEP_DISCOVERY_FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
