/**
 * M2C: prove non-default public finals for 2 products. Never click Tilføj.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = "https://newwaypizzaringsted.dk";
const outDir = join("runs", "discovery", `m2c-surcharge-proof-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /allow cookies/i }).click({ timeout: 3000 }).catch(() => {});

async function prove(productButtonName, variants) {
  const card = page.getByRole("button", { name: new RegExp(productButtonName, "i") }).first();
  await card.scrollIntoViewIfNeeded();
  // Click the + inside the card via evaluate (read-only open)
  await card.evaluate((el) => {
    const plus =
      el.querySelector("button, a, svg") ||
      el.querySelector('[class*="plus"]') ||
      el;
    // Prefer yellow plus sibling: find nearest + control in card container
    const root = el.closest("article, li, div") || el;
    const btns = [...root.querySelectorAll("button")];
    const plusBtn = btns.find((b) => (b.textContent || "").trim() === "+") || btns[0] || el;
    plusBtn.click();
  });
  await page.waitForSelector("#menu-modal, [id*='menu-modal']", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);

  const results = [];
  for (const v of variants) {
    const radio = page.getByRole("radio", { name: new RegExp(v.radioName, "i") });
    await radio.click();
    await page.waitForTimeout(500);
    const addBtn = page
      .locator("#menu-modal")
      .getByRole("button", { name: /^Tilføj\s+\d+/i });
    const addText = ((await addBtn.textContent()) || "").replace(/\s+/g, " ").trim();
    const finalMatch = /(\d+)\s*kr/i.exec(addText);
    const publicFinal = finalMatch ? Number(finalMatch[1]) : null;
    results.push({
      variant: v.radioName,
      adminBase: v.adminBase,
      adminVariant: v.adminVariant,
      expected: v.adminBase + v.adminVariant,
      publicAddButton: addText,
      publicFinal,
      equationHolds:
        publicFinal !== null && publicFinal === v.adminBase + v.adminVariant,
    });
  }

  // Cancel — never add
  const cancel = page.getByRole("button", { name: /^Annuller$/i });
  if ((await cancel.count()) > 0) await cancel.click();
  else await page.getByRole("button", { name: /^Close$/i }).click().catch(() => {});
  await page.waitForTimeout(500);

  const cartEmpty = await page.evaluate(() =>
    /Din kurv er tom/i.test(document.body.innerText || ""),
  );
  return { productButtonName, results, cartEmpty };
}

const evidence = [];
evidence.push(
  await prove("0\\. Hvidløgsbrød", [
    { radioName: "Deep pan \\+20", adminBase: 99, adminVariant: 20 },
    { radioName: "Familie \\+110", adminBase: 99, adminVariant: 110 },
  ]),
);
evidence.push(
  await prove("2\\. Vesuvio", [
    { radioName: "Deep \\+20", adminBase: 99, adminVariant: 20 },
    { radioName: "Fam \\+110", adminBase: 99, adminVariant: 110 },
  ]),
);

writeFileSync(join(outDir, "surcharge-proof.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ outDir, evidence }, null, 2));
await browser.close();
