/**
 * M72 — Apply peer-learned structure live on Veroni (Opdater only).
 * - Restaurant-wide Tilbehør: Salatmayonnaise, Remoulade, Ketchup @ 10 kr
 * - PRODUCT_CHOICE → variants (no size pair) or 0 kr additions (with Alm/Menu)
 * Requires structure-write-confirm.json matching peer fingerprint.
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
import {
  loadActiveStructurePattern,
  upsertVeroniTilbehorBusinessFact,
  defaultStructurePattern,
} from "../src/learning/structurePolicy.js";
import { assertStructureWriteConfirmed } from "../src/portal/structureWriteGate.js";
import {
  mapProductChoicesToWriteFields,
  veroniDefaultTilbehorAdditions,
} from "../src/planning/structureMapping.js";
import type { CanonicalProduct } from "../src/domain/schema/canonical.js";
import type { StructurePatternSummary } from "../src/learning/peerMenuStructure.js";

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

const outDir = join(root, "runs", "discovery", `m72-structure-live-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const CONFIRM_PATH = join(root, "runs", "decisions", "structure-write-confirm.json");
const STORE_PATH = join(root, "runs", "decisions", "peer-structure.sqlite");

const EXCLUDE_MENUS = new Set(["49"]); // standalone Ekstra tilbehør product

type ChoiceSpec = {
  prompt: string;
  options: string[];
};

function loadChoicesByMenu(): Map<string, { name: string; choices: ChoiceSpec[]; variantNames: string[]; variantSurcharges: number[] }> {
  const path = join(root, "runs/m66-veroni-validation-cleanup/canonical-menu.json");
  const canon = JSON.parse(readFileSync(path, "utf8")) as {
    categories: Array<{
      products: Array<{
        sourceMenuNumber?: string;
        assignedMenuNumber?: string;
        name: string;
        productChoices?: Array<{
          prompt: string;
          options: Array<{ label: string }>;
        }>;
        variants: Array<{ name: string; surcharge: number }>;
      }>;
    }>;
  };
  const map = new Map<
    string,
    {
      name: string;
      choices: ChoiceSpec[];
      variantNames: string[];
      variantSurcharges: number[];
    }
  >();
  for (const cat of canon.categories) {
    for (const p of cat.products) {
      const n = (p.assignedMenuNumber || p.sourceMenuNumber || "").trim();
      if (!n || !p.productChoices?.length) continue;
      map.set(n, {
        name: p.name,
        choices: p.productChoices.map((c) => ({
          prompt: c.prompt,
          options: c.options.map((o) => o.label).filter(Boolean),
        })),
        variantNames: p.variants.map((v) => v.name),
        variantSurcharges: p.variants.map((v) => v.surcharge),
      });
    }
  }
  return map;
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

async function setVariantRows(
  page: Page,
  variants: Array<{ name: string; priceKr: string }>,
) {
  const form = page.locator("form:has(#menu_number)");
  const rows = form.locator("#variant-list tr.variant-form");
  let count = await rows.count();
  while (count > variants.length && count > 0) {
    const last = rows.nth(count - 1);
    const btn = last.locator("button, a").last();
    if (await btn.count()) await btn.click().catch(() => undefined);
    else break;
    await page.waitForTimeout(120);
    count = await rows.count();
  }
  for (let i = 0; i < variants.length; i++) {
    count = await rows.count();
    if (i >= count) {
      await form.locator("#add-variant").click();
      await page.waitForTimeout(150);
    }
    const row = form.locator("#variant-list tr.variant-form").nth(i);
    await row.locator("input.variant-name").fill(variants[i]!.name);
    await row.locator("input.variant-price").fill(variants[i]!.priceKr);
  }
}

async function setAdditionRows(
  page: Page,
  additions: Array<{ name: string; priceKr: string }>,
) {
  const form = page.locator("form:has(#menu_number)");
  const rows = form.locator("#addition-list tr.addition-form");
  let count = await rows.count();
  // Clear existing by emptying / removing extras
  while (count > additions.length && count > 0) {
    const last = rows.nth(count - 1);
    const btn = last.locator("button, a").last();
    if (await btn.count()) await btn.click().catch(() => undefined);
    else {
      await last.locator("input.addition-name").fill("");
      break;
    }
    await page.waitForTimeout(120);
    count = await rows.count();
  }
  for (let i = 0; i < additions.length; i++) {
    count = await rows.count();
    if (i >= count) {
      await form.locator("#add-addition").click();
      await page.waitForTimeout(150);
    }
    const row = form.locator("#addition-list tr.addition-form").nth(i);
    await row.locator("input.addition-name").fill(additions[i]!.name);
    await row.locator("input.addition-price").fill(additions[i]!.priceKr);
  }
}

function mergeTilbehor(
  existing: Array<{ name: string; priceOre: number }>,
): Array<{ name: string; priceOre: number }> {
  const out = [...existing];
  for (const t of veroniDefaultTilbehorAdditions()) {
    const key = t.name.toLowerCase();
    if (out.some((a) => a.name.toLowerCase() === key)) continue;
    // also match common OCR spellings
    if (
      out.some((a) =>
        a.name.toLowerCase().replace(/\s+/g, "").includes(
          key.replace(/\s+/g, "").slice(0, 6),
        ),
      )
    ) {
      continue;
    }
    out.push({ name: t.name, priceOre: t.priceMinor ?? 1000 });
  }
  return out;
}

function sameBag(
  a: Array<{ name: string; priceOre: number }>,
  b: Array<{ name: string; priceOre: number }>,
): boolean {
  if (a.length !== b.length) return false;
  const norm = (xs: typeof a) =>
    xs
      .map((x) => `${x.name.toLowerCase()}|${x.priceOre}`)
      .sort()
      .join(";");
  return norm(a) === norm(b);
}

function buildCanonicalStub(input: {
  menuNumber: string;
  name: string;
  liveVariants: Array<{ name: string; priceOre: number }>;
  liveAdditions: Array<{ name: string; priceOre: number }>;
  choices: ChoiceSpec[];
  canonVariantSurcharges?: number[];
}): CanonicalProduct {
  const variants =
    input.liveVariants.length > 0
      ? input.liveVariants.map((v, i) => ({
          sourceId: `live-v-${i}`,
          name: v.name,
          nameOrigin: "SOURCE" as const,
          surcharge: v.priceOre,
          surchargeOrigin: "SOURCE" as const,
          isBase: i === 0,
        }))
      : [
          {
            sourceId: "live-v-0",
            name: "Alm.",
            nameOrigin: "SOURCE" as const,
            surcharge: 0,
            surchargeOrigin: "SOURCE" as const,
            isBase: true,
          },
        ];
  return {
    sourceId: `live:${input.menuNumber}`,
    name: input.name,
    status: "READY",
    sourceMenuNumber: input.menuNumber,
    issues: [],
    categorySourceId: "live",
    sourceOrder: 0,
    isCombo: false,
    variants,
    ingredients: [],
    addOns: input.liveAdditions.map((a, i) => ({
      sourceId: `live-a-${i}`,
      name: a.name,
      price: a.priceOre,
      origin: "SOURCE" as const,
    })),
    productChoices: input.choices.map((c, i) => ({
      sourceId: `live-c-${i}`,
      prompt: c.prompt,
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: c.options.map((label, j) => ({
        productSourceId: `choice-opt:${j}`,
        label,
      })),
    })),
  } as CanonicalProduct;
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

  const store = new DecisionStore(STORE_PATH);
  upsertVeroniTilbehorBusinessFact({
    store,
    restaurantKey: VERONI_CANARY_TARGET.host,
  });
  const pattern: StructurePatternSummary =
    loadActiveStructurePattern(store) ??
    (() => {
      const summaryPath = join(
        root,
        "runs",
        "decisions",
        "peer-structure-summary.json",
      );
      if (existsSync(summaryPath)) {
        return JSON.parse(
          readFileSync(summaryPath, "utf8"),
        ) as StructurePatternSummary;
      }
      return defaultStructurePattern();
    })();

  assertStructureWriteConfirmed({
    restaurantKey: VERONI_CANARY_TARGET.host,
    fingerprint: pattern.fingerprint,
    confirmFilePath: CONFIRM_PATH,
  });

  const choicesByMenu = loadChoicesByMenu();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);
  const results: Array<Record<string, unknown>> = [];

  try {
    await ensureAdmin(page);
    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
    });
    const listed = await adapter.listProducts();
    const work = listed.filter(
      (p) =>
        p.databaseId &&
        p.menuNumber &&
        !p.name.startsWith("__TAH_CANARY_") &&
        !EXCLUDE_MENUS.has(p.menuNumber.trim()),
    );

    console.log(
      JSON.stringify({
        phase: "start",
        products: work.length,
        choiceMenus: [...choicesByMenu.keys()],
        fingerprint: pattern.fingerprint,
      }),
    );

    for (let i = 0; i < work.length; i++) {
      const row = work[i]!;
      const menu = row.menuNumber!.trim();
      try {
        const full = await adapter.readProduct(row.databaseId!);
        const liveVariants = full.variants.map((v) => ({
          name: v.name,
          priceOre: v.priceOre ?? 0,
        }));
        const liveAdditions = full.additions.map((a) => ({
          name: a.name,
          priceOre: a.priceOre ?? 0,
        }));

        const choiceMeta = choicesByMenu.get(menu);
        const stub = buildCanonicalStub({
          menuNumber: menu,
          name: full.name ?? row.name,
          liveVariants,
          liveAdditions,
          choices: choiceMeta?.choices ?? [],
        });
        const mapped = mapProductChoicesToWriteFields(stub, pattern);
        const desiredAdditions = mergeTilbehor(mapped.additions);
        const desiredVarNorm =
          mapped.variants.length > 0
            ? mapped.variants.map((v) => ({
                name: v.name,
                priceOre: v.surchargeOre,
              }))
            : liveVariants.length > 0
              ? liveVariants
              : [{ name: "Alm.", priceOre: 0 }];

        const variantsChanged = !sameBag(liveVariants, desiredVarNorm);
        const additionsChanged = !sameBag(liveAdditions, desiredAdditions);
        if (!variantsChanged && !additionsChanged) {
          results.push({ menu, ok: true, skipped: true, name: full.name });
          continue;
        }

        await page.goto(
          `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${row.databaseId}/edit`,
          { waitUntil: "domcontentloaded" },
        );
        await dismissKnownCookieBanner(page);

        if (variantsChanged) {
          await setVariantRows(
            page,
            desiredVarNorm.map((v) => ({
              name: v.name,
              priceKr: String(Math.round(v.priceOre / 100)),
            })),
          );
        }
        if (additionsChanged) {
          await setAdditionRows(
            page,
            desiredAdditions.map((a) => ({
              name: a.name,
              priceKr: String(Math.round(a.priceOre / 100)),
            })),
          );
        }

        const observed = await clickOpdaterAndObserveUpdate({
          page,
          databaseId: row.databaseId!,
          timeoutMs: 25_000,
        });
        const ok = observed.ok && observed.response.status < 400;
        results.push({
          menu,
          ok,
          name: full.name,
          variantsChanged,
          additionsChanged,
          variants: desiredVarNorm.map((v) => v.name),
          additions: desiredAdditions.map((a) => a.name),
          notes: mapped.mappingNotes,
          status: observed.response?.status,
        });
        console.log(
          JSON.stringify({
            i: i + 1,
            of: work.length,
            menu,
            ok,
            variantsChanged,
            additionsChanged,
          }),
        );
      } catch (err) {
        results.push({
          menu,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        console.log(
          JSON.stringify({
            i: i + 1,
            of: work.length,
            menu,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Spot-check storefront for Tilbehør labels
    await page.goto(VERONI_CANARY_TARGET.baseUrl + "/", {
      waitUntil: "domcontentloaded",
    });
    await dismissKnownCookieBanner(page);
    const body = await page.locator("body").innerText();
    const publicCheck = {
      remoulade: /remoulade/i.test(body),
      ketchup: /ketchup/i.test(body),
      salatmayo: /salatmayo|salatmayonnaise/i.test(body),
      kebabVariantHint: /kebab/i.test(body),
    };

    const report = {
      milestone: "M72_VERONI_STRUCTURE_LIVE",
      status: results.every((r) => r.ok) ? "VERIFIED" : "PARTIAL",
      fingerprint: pattern.fingerprint,
      updated: results.filter((r) => r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      failed: results.filter((r) => !r.ok).length,
      publicCheck,
      results,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    store.close();
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
