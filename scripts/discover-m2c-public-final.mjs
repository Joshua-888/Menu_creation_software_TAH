/**
 * M2C: open product modal and read FINAL price after selecting Deep/Fam.
 * Read-only: never add to cart / never checkout.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = "https://newwaypizzaringsted.dk";
const outDir = join("runs", "discovery", `m2c-public-final-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const products = ["Hvidløgsbrød", "Vesuvio", "Hawaii", "Margherita"];
const evidence = [];

async function dumpState(label) {
  return page.evaluate((lbl) => {
    const dialog =
      document.querySelector('[role="dialog"]') ||
      document.querySelector(".modal") ||
      [...document.querySelectorAll("div")].find((d) => {
        const t = (d.textContent || "").slice(0, 200);
        return /Almindelig|Deep|Familie/.test(t) && /kr/.test(t) && d.querySelectorAll("*").length < 400;
      });
    const root = dialog || document.body;
    const text = (root.textContent || "").replace(/\s+/g, " ").trim();
    const radios = [...root.querySelectorAll("input[type=radio], [role=radio], label")].map(
      (el) => ({
        tag: el.tagName,
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        checked: el.checked ?? el.getAttribute("aria-checked"),
        value: el.value || null,
      }),
    );
    // Find elements that look like a primary price display
    const priceCandidates = [...root.querySelectorAll("*")]
      .map((el) => ({
        tag: el.tagName,
        cls: el.className?.toString?.().slice?.(0, 80) || "",
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
      }))
      .filter((x) => x.text.length < 30 && /^\d+([.,]\d{2})?\s*kr\.?$/i.test(x.text))
      .slice(0, 30);
    const plusLines = text.match(/(Almindelig|Deep pan|Deep|Familie|Fam)[^\d]{0,20}\+?\s*\d+\s*kr/gi) || [];
    return {
      label: lbl,
      url: location.href,
      plusLines: [...new Set(plusLines)].slice(0, 20),
      priceCandidates,
      sampleText: text.slice(0, 1200),
      radioSample: radios.filter((r) => /Alm|Deep|Fam|kr/i.test(r.text)).slice(0, 20),
    };
  }, label);
}

for (const name of products) {
  // Prefer clicking the product heading/card
  const card = page.locator(`text=${name}`).first();
  if ((await card.count()) === 0) continue;
  await card.click({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(1000);

  const before = await dumpState(`${name}:opened`);
  evidence.push(before);

  // Click each non-default variant and capture primary price
  for (const variant of ["Deep pan", "Deep", "Familie", "Fam"]) {
    // Prefer label containing exact variant + price surcharge text
    const candidates = [
      page.getByText(new RegExp(`${variant}.*\\+\\d+`, "i")).first(),
      page.getByLabel(new RegExp(variant, "i")).first(),
      page.getByText(variant, { exact: false }).first(),
    ];
    let clicked = false;
    for (const c of candidates) {
      if ((await c.count()) === 0) continue;
      try {
        await c.click({ timeout: 2000 });
        clicked = true;
        break;
      } catch {
        /* try next */
      }
    }
    if (!clicked) continue;
    await page.waitForTimeout(800);
    const after = await dumpState(`${name}:selected:${variant}`);
    evidence.push(after);

    // Try to read a prominent total near CTA without clicking Tilføj/Add
    const totals = await page.evaluate(() => {
      const all = [...document.querySelectorAll("button, [class*='price'], [class*='total'], h1, h2, h3, strong, span")]
        .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length < 40 && /\d+\s*kr/i.test(t));
      return [...new Set(all)].slice(0, 40);
    });
    evidence.push({ label: `${name}:prices-after-${variant}`, totals });
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  // Click outside / luk
  const luk = page.getByRole("button", { name: /^luk$/i });
  if ((await luk.count()) > 0) await luk.first().click().catch(() => null);
}

writeFileSync(join(outDir, "public-final-prices.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ outDir, n: evidence.length }, null, 2));
await browser.close();
