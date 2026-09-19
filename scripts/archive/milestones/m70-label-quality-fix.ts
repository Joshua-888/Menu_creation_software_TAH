/**
 * M70 — Fix live Veroni label garbage via Opdater + seed label-quality precedents.
 * Curated titles from source OCR evidence (Gorgonzola / Ufo / Salatpizza proteins).
 * Does not re-CREATE products.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { clickOpdaterAndObserveUpdate } from "../src/tah/write/updateRequestObserve.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import {
  assertVeroniTargetLock,
  blockWriteUnlessTargetLocked,
} from "../src/tah/write/targetLock.js";
import { VERONI_CANARY_TARGET } from "../src/tah/write/types.js";
import { DecisionStore } from "../src/decisions/store.js";
import { DecisionPolicyRegistry } from "../src/decisions/engine.js";
import {
  buildLabelQualityDecisionCase,
  recordLabelQualityCorrection,
} from "../src/decisions/labelQuality.js";
import {
  assessLabelQuality,
  formatIngredientDisplay,
} from "../src/domain/textNormalize.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(path: string) {
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

/** Curated corrections — never invent; derived from OCR rawText + protein. */
const CURATED: Array<{
  menu: string;
  name: string;
  ingredients: string[];
  ocrFixes?: Array<{ from: string; to: string }>;
}> = [
  {
    menu: "16",
    name: "Gorgonzola 1",
    ingredients: [
      "Skinke",
      "Champignon",
      "Løg",
      "Tomat",
      "Ost",
      "Gorgonzola",
    ],
  },
  {
    menu: "17",
    name: "Gorgonzola 2",
    ingredients: [
      "Ost",
      "Gorgonzola",
      "Kebab",
      "Champignon",
      "Tomat",
      "Syltet paprika",
      "Løg",
    ],
  },
  {
    menu: "25",
    name: "Ufo Seetha",
    ingredients: ["Tomat", "Ost", "Skinke", "Rejer", "Champignon"],
  },
  {
    menu: "26",
    name: "Ufo Glori",
    ingredients: [
      "Tomat",
      "Ost",
      "Kødsovs",
      "Spaghetti",
      "Syltet paprika",
      "Løg",
    ],
    ocrFixes: [
      { from: "kodsovs", to: "kødsovs" },
      { from: "log", to: "løg" },
    ],
  },
  {
    menu: "27",
    name: "Salatpizza kebab",
    ingredients: ["Tomat", "Ost", "Kebab", "Salat", "Dressing"],
  },
  {
    menu: "28",
    name: "Salatpizza skinke",
    ingredients: ["Tomat", "Ost", "Skinke", "Salat", "Dressing"],
  },
  {
    menu: "29",
    name: "Salatpizza kylling",
    ingredients: ["Tomat", "Ost", "Kylling", "Salat", "Dressing"],
  },
  {
    menu: "30",
    name: "Salatpizza kødstrimler",
    ingredients: ["Tomat", "Ost", "Kødstrimler", "Salat", "Dressing"],
  },
  {
    menu: "31",
    name: "Salatpizza falafel",
    ingredients: ["Tomat", "Ost", "Falafel", "Salat", "Dressing"],
  },
];

const outDir = join(root, "runs", "discovery", `m70-label-fix-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

async function ensureAdmin(page: Page) {
  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  if (/\/login/i.test(page.url())) {
    await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
    await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
  }
}

async function replaceIngredients(page: Page, ingredients: string[]) {
  const form = page.locator("form:has(#menu_number)");
  // Remove existing ingredient rows (keep trying while delete buttons exist)
  for (let guard = 0; guard < 30; guard++) {
    const del = form.locator(
      "#ingredient-list tr.ingredient-form button, #ingredient-list tr.ingredient-form .remove, #ingredient-list .delete-ingredient",
    );
    const count = await del.count();
    if (count === 0) break;
    await del.first().click().catch(async () => {
      // Fallback: clear input values if no delete control
    });
    await page.waitForTimeout(150);
  }
  // If rows remain, clear their inputs and reuse / add
  const existing = form.locator("#ingredient-list tr.ingredient-form");
  let rowCount = await existing.count();
  while (rowCount > ingredients.length && rowCount > 0) {
    const last = existing.nth(rowCount - 1);
    const removeBtn = last.locator("button, a").last();
    if (await removeBtn.count()) {
      await removeBtn.click();
      await page.waitForTimeout(150);
    } else {
      await last.locator("input.ingredient-name").fill("");
      break;
    }
    rowCount = await existing.count();
  }
  for (let i = 0; i < ingredients.length; i++) {
    rowCount = await existing.count();
    if (i >= rowCount) {
      await form.locator("#add-ingredient").click();
      await page.waitForTimeout(200);
    }
    await form
      .locator("#ingredient-list tr.ingredient-form")
      .nth(i)
      .locator("input.ingredient-name")
      .fill(ingredients[i]!);
  }
}

async function updateLabels(
  page: Page,
  databaseId: string,
  fix: (typeof CURATED)[number],
) {
  await page.goto(
    `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${databaseId}/edit`,
    { waitUntil: "domcontentloaded" },
  );
  await dismissKnownCookieBanner(page);
  const form = page.locator("form:has(#menu_number)");
  const description = fix.ingredients.join(", ");
  await form.locator("#name").fill(fix.name);
  await form.locator("#description").fill(description);
  await replaceIngredients(page, fix.ingredients);

  const observed = await clickOpdaterAndObserveUpdate({
    page,
    databaseId,
    timeoutMs: 25_000,
  });
  if (!observed.ok) {
    throw new Error(
      `${observed.code}${observed.detail ? `: ${observed.detail}` : ""}`,
    );
  }
  if (observed.response.status >= 400) {
    throw new Error(`Opdater HTTP ${observed.response.status}`);
  }
}

async function main() {
  const lock = assertVeroniTargetLock({
    hostname: VERONI_CANARY_TARGET.host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    url: VERONI_CANARY_TARGET.baseUrl,
  });
  blockWriteUnlessTargetLocked(lock);
  if (!process.env.TAH_ADMIN_EMAIL || !process.env.TAH_ADMIN_PASSWORD) {
    throw new Error("missing TAH_ADMIN credentials");
  }

  const storePath = join(root, "runs", "decisions", "veroni-label-quality.sqlite");
  mkdirSync(dirname(storePath), { recursive: true });
  const store = new DecisionStore(storePath);
  const registry = new DecisionPolicyRegistry(store);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results: Array<Record<string, unknown>> = [];

  try {
    await ensureAdmin(page);
    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
    });
    const listed = await adapter.listProducts();
    const byMenu = new Map(
      listed
        .filter((p) => p.databaseId && p.menuNumber)
        .map((p) => [p.menuNumber!.trim(), p]),
    );

    // Also hygiene-scan other live products: capitalize + strip price bleed only
    const hygieneMenus: string[] = [];
    for (const row of listed) {
      if (!row.databaseId || !row.menuNumber) continue;
      if (CURATED.some((c) => c.menu === row.menuNumber!.trim())) continue;
      if (row.name.startsWith("__TAH_CANARY_")) continue;
      const full = await adapter.readProduct(row.databaseId);
      const assessment = assessLabelQuality({
        name: full.name ?? row.name,
        description: full.description ?? "",
        ingredients: full.ingredients.map((i) => i.name),
      });
      if (
        assessment.severity === "REPAIR" &&
        assessment.repairs.some((r) => r.field === "ingredient")
      ) {
        hygieneMenus.push(row.menuNumber!.trim());
        await page.goto(
          `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${row.databaseId}/edit`,
          { waitUntil: "domcontentloaded" },
        );
        await dismissKnownCookieBanner(page);
        const form = page.locator("form:has(#menu_number)");
        const ings = assessment.repaired.ingredients;
        if (assessment.repaired.name && assessment.severity === "REPAIR") {
          await form.locator("#name").fill(assessment.repaired.name);
        }
        if (ings.length) {
          await replaceIngredients(page, ings);
          if (!(await form.locator("#description").inputValue()).trim()) {
            await form.locator("#description").fill(ings.join(", "));
          }
        }
        const observed = await clickOpdaterAndObserveUpdate({
          page,
          databaseId: row.databaseId,
          timeoutMs: 25_000,
        });
        results.push({
          menu: row.menuNumber,
          kind: "hygiene",
          ok: observed.ok && observed.response.status < 400,
          repairs: assessment.repairs.length,
        });
      }
    }

    for (const fix of CURATED) {
      const row = byMenu.get(fix.menu);
      if (!row?.databaseId) {
        results.push({ menu: fix.menu, ok: false, error: "not_found_on_dest" });
        continue;
      }
      try {
        const beforeName = row.name;
        await updateLabels(page, row.databaseId, fix);

        const dc = buildLabelQualityDecisionCase({
          runId: `m70-label-fix`,
          restaurantKey: VERONI_CANARY_TARGET.host,
          host: VERONI_CANARY_TARGET.host,
          menuNumber: fix.menu,
          productName: beforeName,
          ingredients: fix.ingredients,
          sourceCategory: "veroni-live-fix",
        });
        recordLabelQualityCorrection({
          store,
          registry,
          decisionCase: dc,
          correction: {
            name: fix.name,
            description: fix.ingredients.join(", "),
            ingredients: fix.ingredients.map((i) => formatIngredientDisplay(i)),
            ...(fix.ocrFixes ? { ocrFixes: fix.ocrFixes } : {}),
          },
          scopePreference: "APPLY_TO_THIS_RESTAURANT",
          operatorId: "m70-curated",
        });

        results.push({
          menu: fix.menu,
          ok: true,
          databaseId: row.databaseId,
          name: fix.name,
          kind: "curated",
        });
      } catch (err) {
        results.push({
          menu: fix.menu,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Storefront spot-check
    await page.goto(VERONI_CANARY_TARGET.baseUrl + "/", {
      waitUntil: "domcontentloaded",
    });
    await dismissKnownCookieBanner(page);
    const body = await page.locator("body").innerText();
    const publicChecks = CURATED.map((f) => ({
      menu: f.menu,
      nameVisible: body.includes(f.name),
      junkAbsent: !body.includes("I15,") && !/dressing 95/i.test(body),
    }));

    const report = {
      milestone: "M70_LABEL_QUALITY_FIX",
      status: results.every((r) => r.ok) ? "VERIFIED" : "PARTIAL",
      storePath,
      hygieneMenus,
      results,
      publicChecks,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    await browser.close();
    store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
