import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
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
import { formatIngredientDisplay } from "../src/domain/textNormalize.js";
import {
  loadPeerSnapshotsFromDir,
  resolvePeerObserveDir,
} from "../src/learning/peerArtifacts.js";

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

/** Curated calzone ingredients from source/OCR + peer pattern (removable toppings). */
const CALZONE_FIXES: Record<
  string,
  { name: string; ingredients: string[]; description: string }
> = {
  "22": {
    name: "Calzone Josu",
    ingredients: ["Tomat", "Ost", "Skinke"],
    description: "Tomat, ost, skinke",
  },
  "23": {
    name: "Calzone Jega",
    ingredients: ["Tomat", "Ost", "Kødsovs"],
    description: "Tomat, ost, kødsovs",
  },
  "24": {
    name: "Calzone Karan",
    ingredients: ["Tomat", "Ost", "Champignon"],
    description: "Tomat, ost, champignon — vælg skinke eller kebab",
  },
};

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

async function setIngredients(page: Page, ingredients: string[]) {
  const form = page.locator("form:has(#menu_number)");
  const rows = form.locator("#ingredient-list tr.ingredient-form");
  let count = await rows.count();
  while (count > 0) {
    const last = rows.nth(count - 1);
    const btn = last.locator("button, a").last();
    if (await btn.count()) await btn.click().catch(() => undefined);
    else {
      await last.locator("input.ingredient-name").fill("");
      break;
    }
    await page.waitForTimeout(100);
    count = await rows.count();
    if (count > 40) break;
  }
  for (let i = 0; i < ingredients.length; i++) {
    count = await rows.count();
    if (i >= count) {
      await form.locator("#add-ingredient").click();
      await page.waitForTimeout(150);
    }
    await form
      .locator("#ingredient-list tr.ingredient-form")
      .nth(i)
      .locator("input.ingredient-name")
      .fill(ingredients[i]!);
  }
}

async function main() {
  const lock = assertVeroniTargetLock({
    hostname: VERONI_CANARY_TARGET.host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    url: VERONI_CANARY_TARGET.baseUrl,
  });
  blockWriteUnlessTargetLocked(lock);

  const outDir = join(root, "runs", "discovery", `m75-calzone-ings-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });

  // Peer calzone ingredient patterns (for report)
  const peerDir = resolvePeerObserveDir(root);
  const peerHits: string[] = [];
  if (peerDir) {
    for (const snap of loadPeerSnapshotsFromDir(peerDir)) {
      for (const p of snap.products) {
        if (/calzone/i.test(p.name)) {
          peerHits.push(
            `${snap.host}:${p.name} ings=${(p.ingredients || []).join(",") || "(none in sample)"}`,
          );
        }
      }
    }
  }

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

    for (const [menu, fix] of Object.entries(CALZONE_FIXES)) {
      const row = listed.find((p) => (p.menuNumber || "").trim() === menu);
      if (!row?.databaseId) {
        results.push({ menu, ok: false, error: "not_found" });
        continue;
      }
      const before = await adapter.readProduct(row.databaseId);
      const ings = fix.ingredients.map((i) => formatIngredientDisplay(i));

      await page.goto(
        `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${row.databaseId}/edit`,
        { waitUntil: "domcontentloaded" },
      );
      await dismissKnownCookieBanner(page);
      const form = page.locator("form:has(#menu_number)");
      await form.locator("#name").fill(fix.name);
      await form.locator("#description").fill(fix.description);
      await setIngredients(page, ings);

      const observed = await clickOpdaterAndObserveUpdate({
        page,
        databaseId: row.databaseId,
        timeoutMs: 25_000,
      });
      const ok = observed.ok && observed.response.status < 400;
      const after = await adapter.readProduct(row.databaseId);
      results.push({
        menu,
        ok,
        beforeIngredients: before.ingredients.map((i) => i.name),
        afterIngredients: after.ingredients.map((i) => i.name),
        name: after.name,
        description: after.description,
        status: observed.response.status,
      });
      console.log(JSON.stringify({ menu, ok, afterIngredients: after.ingredients.map((i) => i.name) }));
    }

    await page.goto(VERONI_CANARY_TARGET.baseUrl + "/", {
      waitUntil: "domcontentloaded",
    });
    await dismissKnownCookieBanner(page);

    const report = {
      milestone: "M75_CALZONE_INGREDIENTS",
      status: results.every((r) => r.ok) ? "VERIFIED" : "PARTIAL",
      peerHits,
      results,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
