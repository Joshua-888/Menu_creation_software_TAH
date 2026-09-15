/**
 * M69 — Continue Veroni import: create missing READY products hidden, then activate.
 * Skips Pasta #33–35 (already live), canaries, and UNLABELLED placeholders.
 * Checkpoint/resume supported.
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
import { mapSourceCategoriesToDestination } from "../src/planning/categoryMapping.js";
import {
  createTahPlaywrightDestinationPort,
} from "../src/runner/tahDestinationPort.js";
import type { PlannedProductPayload } from "../src/runner/writePlan.js";
import { clickOpdaterAndObserveUpdate } from "../src/tah/write/updateRequestObserve.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import {
  assertVeroniTargetLock,
  blockWriteUnlessTargetLocked,
} from "../src/tah/write/targetLock.js";
import { VERONI_CANARY_TARGET } from "../src/tah/write/types.js";
import { gateWriteLabels } from "../src/decisions/labelQuality.js";

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

const CHECKPOINT = join(root, "runs", "discovery", "m69-import-checkpoint.json");
const outDir = join(root, "runs", "discovery", `m69-import-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

type CanonProduct = {
  sourceId: string;
  name: string;
  sourceMenuNumber?: string;
  assignedMenuNumber?: string;
  status: string;
  basePrice?: number;
  ingredients: Array<{ display: string }>;
  variants: Array<{ name: string; surcharge: number }>;
  addOns: Array<{ name: string; price?: number | null }>;
};

type WorkItem = {
  sourceId: string;
  menuNumber: string;
  name: string;
  categoryId: string;
  categoryName: string;
  payload: PlannedProductPayload;
};

/** Natural menu-number order: 1,2,9,10,32,32b,32C,45A */
function menuNumberSortKey(menu: string): [number, string] {
  const m = menu.trim();
  const match = /^(\d+)(.*)$/.exec(m);
  if (!match) return [Number.MAX_SAFE_INTEGER, m.toLowerCase()];
  return [Number(match[1]), (match[2] || "").toLowerCase()];
}

function compareMenuNumbers(a: string, b: string): number {
  const [an, as] = menuNumberSortKey(a);
  const [bn, bs] = menuNumberSortKey(b);
  if (an !== bn) return an - bn;
  return as.localeCompare(bs, "da");
}

type Checkpoint = {
  doneMenus: string[];
  failures: Array<{ menuNumber: string; error: string }>;
  activated: string[];
};

function loadCheckpoint(): Checkpoint {
  if (!existsSync(CHECKPOINT)) {
    return { doneMenus: [], failures: [], activated: [] };
  }
  return JSON.parse(readFileSync(CHECKPOINT, "utf8")) as Checkpoint;
}

function saveCheckpoint(cp: Checkpoint) {
  writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2));
  writeFileSync(join(outDir, "checkpoint.json"), JSON.stringify(cp, null, 2));
}

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

async function activateProduct(
  page: Page,
  databaseId: string,
  expectedName: string,
): Promise<string> {
  await page.goto(
    `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${databaseId}/edit`,
    { waitUntil: "domcontentloaded" },
  );
  await dismissKnownCookieBanner(page);
  const nameVal = await page.locator("form:has(#menu_number) #name").inputValue();
  if (nameVal.trim().toLowerCase() !== expectedName.trim().toLowerCase()) {
    throw new Error(`activate name mismatch: "${nameVal}" vs "${expectedName}"`);
  }
  const active = page.locator("form:has(#menu_number) #active");
  if (!(await active.isChecked())) await active.check();
  const observed = await clickOpdaterAndObserveUpdate({
    page,
    databaseId,
    timeoutMs: 25_000,
  });
  if (!observed.ok) {
    throw new Error(`${observed.code}${observed.detail ? `: ${observed.detail}` : ""}`);
  }
  if (observed.response.status >= 400) {
    throw new Error(`Opdater HTTP ${observed.response.status}`);
  }
  return "Tilgængelig";
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

  const canon = JSON.parse(
    readFileSync(
      join(root, "runs/m66-veroni-validation-cleanup/canonical-menu.json"),
      "utf8",
    ),
  ) as {
    categories: Array<{
      sourceId: string;
      name: string;
      products: CanonProduct[];
    }>;
  };

  const cp = loadCheckpoint();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await ensureAdmin(page);
    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
    });
    const cats = await adapter.listCategories();
    const maps = mapSourceCategoriesToDestination(
      canon.categories.map((c) => ({ sourceId: c.sourceId, name: c.name })),
      cats.map((c) => ({ databaseId: c.databaseId, name: c.name })),
    );
    const mapBySource = new Map(maps.map((m) => [m.sourceCategoryId, m]));

    const listed = await adapter.listProducts();
    const byMenu = new Map(
      listed
        .filter((p) => p.databaseId && p.menuNumber)
        .map((p) => [p.menuNumber!.trim(), p]),
    );

    const work: WorkItem[] = [];
    for (const cat of canon.categories) {
      const mapping = mapBySource.get(cat.sourceId);
      if (
        !mapping?.destinationCategoryId ||
        mapping.outcome === "SOURCE_STRUCTURE_PLACEHOLDER" ||
        mapping.outcome === "MISSING_DESTINATION_CATEGORY" ||
        mapping.outcome === "AMBIGUOUS_MATCH"
      ) {
        continue;
      }
      for (const p of cat.products) {
        if (p.status !== "READY") continue;
        if (p.name.startsWith("__TAH_CANARY_")) continue;
        const menu = (p.assignedMenuNumber || p.sourceMenuNumber || "").trim();
        if (!menu) continue;
        if (["33", "34", "35"].includes(menu)) continue; // already live Pasta
        if (cp.doneMenus.includes(menu)) continue;

        const variants =
          p.variants.length > 0
            ? p.variants.map((v) => ({
                name: v.name || "Alm.",
                surchargeOre: v.surcharge ?? 0,
              }))
            : [{ name: "Alm.", surchargeOre: 0 }];

        const gated = gateWriteLabels({
          restaurantKey: VERONI_CANARY_TARGET.host,
          menuNumber: menu,
          name: p.name,
          description: p.ingredients.map((i) => i.display).join(", "),
          ingredients: p.ingredients.map((i) => i.display),
        });
        if (!gated.ok) {
          cp.failures.push({
            menuNumber: menu,
            error: gated.failure ?? "LABEL_QUALITY_REVIEW",
          });
          continue;
        }

        work.push({
          sourceId: p.sourceId,
          menuNumber: menu,
          name: gated.name,
          categoryId: mapping.destinationCategoryId,
          categoryName: cat.name,
          payload: {
            sourceId: p.sourceId,
            menuNumber: menu,
            name: gated.name,
            description:
              gated.description || gated.ingredients.join(", "),
            basePriceOre: p.basePrice ?? 0,
            categoryIds: [mapping.destinationCategoryId],
            variants,
            ingredients: gated.ingredients,
            additions: (p.addOns || []).map((a) => ({
              name: a.name,
              priceOre: a.price ?? 0,
            })),
            intendedHidden: true,
          },
        });
      }
    }
    saveCheckpoint(cp);

    work.sort((a, b) => compareMenuNumbers(a.menuNumber, b.menuNumber));

    console.log(
      JSON.stringify({
        phase: "start",
        remaining: work.length,
        alreadyDone: cp.doneMenus.length,
        orderPreview: work.slice(0, 15).map((w) => w.menuNumber),
      }),
    );

    const port = createTahPlaywrightDestinationPort({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
      restaurantKey: VERONI_CANARY_TARGET.host,
    });

    for (let i = 0; i < work.length; i++) {
      const item = work[i]!;
      const existing = byMenu.get(item.menuNumber);
      let databaseId = existing?.databaseId ?? null;

      try {
        if (!databaseId) {
          const created = await port.createHiddenProduct(item.payload);
          if (created.outcome !== "CREATED" || !created.databaseId) {
            throw new Error(created.error ?? `create failed: ${created.outcome}`);
          }
          databaseId = created.databaseId;
        }

        const statusText = (byMenu.get(item.menuNumber)?.statusText || "").trim();
        const alreadyActive =
          databaseId &&
          statusText &&
          !/skjult/i.test(statusText) &&
          cp.activated.includes(item.menuNumber);

        if (!cp.activated.includes(item.menuNumber) && !alreadyActive) {
          // Refresh status from list if we just created
          await activateProduct(page, databaseId, item.name);
          cp.activated.push(item.menuNumber);
        }

        cp.doneMenus.push(item.menuNumber);
        byMenu.set(item.menuNumber, {
          databaseId,
          menuNumber: item.menuNumber,
          name: item.name,
          categoryText: item.categoryName,
          priceText: null,
          statusText: "Tilgængelig",
          editPath: `/admin/menu/${databaseId}/edit`,
          showPath: null,
        });
        saveCheckpoint(cp);
        console.log(
          JSON.stringify({
            ok: true,
            i: i + 1,
            of: work.length,
            menu: item.menuNumber,
            name: item.name,
            databaseId,
            cat: item.categoryName,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        cp.failures.push({ menuNumber: item.menuNumber, error: message });
        saveCheckpoint(cp);
        console.log(
          JSON.stringify({
            ok: false,
            i: i + 1,
            of: work.length,
            menu: item.menuNumber,
            name: item.name,
            error: message,
          }),
        );
      }
    }

    const report = {
      milestone: "M69_CONTINUE_IMPORT",
      status: cp.failures.length ? "PARTIAL" : "VERIFIED",
      done: cp.doneMenus.length,
      activated: cp.activated.length,
      failures: cp.failures,
      checkpoint: CHECKPOINT,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(cp.failures.length ? 1 : 0);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
