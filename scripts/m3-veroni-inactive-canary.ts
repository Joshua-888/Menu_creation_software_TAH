/**
 * M3 Veroni inactive product canary — gated live execution.
 * Creates only synthetic inactive products; no category create/update/delete/images/additions.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.ts";
import { probeAdminContract } from "../src/tah/probe/contractProbe.ts";
import { assertVeroniTargetLock } from "../src/tah/write/targetLock.ts";
import {
  CANARY_NAMES,
  VERONI_CANARY_TARGET,
} from "../src/tah/write/types.ts";
import {
  createInactiveProductWritePlan,
  selectExistingCategoryDeterministic,
} from "../src/tah/write/writePlan.ts";
import {
  assertActiveUnchecked,
  fillInactiveProductCreateForm,
} from "../src/tah/write/formFill.ts";
import {
  assertInactiveCreatePayloadSafe,
  sanitizeCreatePayload,
  type SanitizedCreatePayload,
} from "../src/tah/write/payloadInspect.ts";
import { runInactiveProductDryRun } from "../src/tah/write/canaryRunner.ts";

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

const base = VERONI_CANARY_TARGET.baseUrl;
const authPath = join(root, "playwright", ".auth", "tah-admin-veroni.json");
const runId = `m3-${Date.now()}`;
const outDir = join(root, "runs", "discovery", runId);
mkdirSync(outDir, { recursive: true });

type CanarySpec = {
  suffix: string;
  name: string;
  menuNumber: string;
  basePriceOre: number;
  basePriceKr: string;
  variants: Array<{ name: string; priceOre: number; priceKr: string }>;
  ingredients: string[];
};

const CANARIES: CanarySpec[] = [
  {
    suffix: "prod:1",
    name: CANARY_NAMES.product,
    menuNumber: CANARY_NAMES.reservedMenuNumber,
    basePriceOre: 9900,
    basePriceKr: "99",
    variants: [{ name: "Alm.", priceOre: 0, priceKr: "0" }],
    ingredients: [CANARY_NAMES.ingredientA, CANARY_NAMES.ingredientB],
  },
  {
    suffix: "prod:2",
    name: CANARY_NAMES.productNonZero,
    menuNumber: CANARY_NAMES.reservedMenuNumberNonZero,
    basePriceOre: 10000,
    basePriceKr: "100",
    variants: [
      { name: "Alm.", priceOre: 0, priceKr: "0" },
      { name: "Familie", priceOre: 8000, priceKr: "80" },
    ],
    ingredients: [CANARY_NAMES.ingredientA],
  },
  {
    suffix: "prod:3",
    name: CANARY_NAMES.productMulti,
    menuNumber: CANARY_NAMES.reservedMenuNumberMulti,
    basePriceOre: 9000,
    basePriceKr: "90",
    variants: [
      { name: "Alm.", priceOre: 0, priceKr: "0" },
      { name: "Deep Pan", priceOre: 2000, priceKr: "20" },
      { name: "Familie", priceOre: 8000, priceKr: "80" },
    ],
    ingredients: [CANARY_NAMES.ingredientA, CANARY_NAMES.ingredientB],
  },
];

async function ensureAuth(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  let context = existsSync(authPath)
    ? await browser.newContext({ storageState: authPath })
    : await browser.newContext();
  let page = await context.newPage();
  await page.goto(`${base}/admin/menu`, { waitUntil: "domcontentloaded" });
  if (/\/login/i.test(page.url())) {
    await context.close();
    const email = process.env.TAH_ADMIN_EMAIL;
    const password = process.env.TAH_ADMIN_PASSWORD;
    if (!email || !password) throw new Error("Missing credentials");
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    await page
      .locator('input[type="password"], input[name="password"]')
      .first()
      .fill(password);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
    if (/\/login/i.test(page.url())) throw new Error("Login failed");
    mkdirSync(dirname(authPath), { recursive: true });
    await context.storageState({ path: authPath });
  }
  return { context, page };
}

function lockOrThrow(page: Page) {
  const lock = assertVeroniTargetLock({
    hostname: new URL(page.url()).host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    url: page.url(),
  });
  if (!lock.ok) throw new Error(`BLOCKED: ${lock.reason}`);
  return lock;
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /allow cookies/i });
  if ((await btn.count()) > 0) {
    await btn.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function publicVisible(page: Page, productName: string): Promise<boolean> {
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await dismissCookieBanner(page);
  const text = await page.evaluate(() => document.body.innerText || "");
  return text.includes(productName);
}

async function interceptAbortCreate(
  page: Page,
  fill: Parameters<typeof fillInactiveProductCreateForm>[1],
): Promise<SanitizedCreatePayload> {
  /**
   * @deprecated M3D: network abort after click is NOT a persistence guarantee.
   * Prefer inspectFormSubmission (zero-network FormData) for preflight.
   * Kept only for historical M3 incident reproduction — do not use for safety.
   */
  let captured: SanitizedCreatePayload | null = null;
  await page.route("**/admin/menu", async (route) => {
    const req = route.request();
    if (req.method().toUpperCase() === "POST") {
      captured = sanitizeCreatePayload({
        method: req.method(),
        url: req.url(),
        postData: req.postData(),
        headers: req.headers(),
      });
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto(`${base}/admin/menu/create`, { waitUntil: "domcontentloaded" });
  lockOrThrow(page);
  await dismissCookieBanner(page);
  await fillInactiveProductCreateForm(page, fill);
  await assertActiveUnchecked(page);
  await dismissCookieBanner(page);
  await page.getByRole("button", { name: /^Skab$/i }).click({ force: true });
  await page.waitForTimeout(1500);
  await page.unroute("**/admin/menu");

  if (!captured) {
    throw new Error("Intercept failed: no POST /admin/menu captured");
  }
  return captured;
}

async function realCreateOnce(
  page: Page,
  fill: Parameters<typeof fillInactiveProductCreateForm>[1],
): Promise<void> {
  await page.goto(`${base}/admin/menu/create`, { waitUntil: "domcontentloaded" });
  lockOrThrow(page);
  await dismissCookieBanner(page);
  await fillInactiveProductCreateForm(page, fill);
  await assertActiveUnchecked(page);
  // Final gate: active still unchecked
  if (await page.locator("#active").isChecked()) {
    throw new Error("CRITICAL: #active checked immediately before submit");
  }
  await dismissCookieBanner(page);
  await page.getByRole("button", { name: /^Skab$/i }).click({ force: true });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
}

const report: Record<string, unknown> = {
  runId,
  status: "IN_PROGRESS",
  mutations: [] as unknown[],
};
const createdIds: Array<{ name: string; databaseId: string; menuNumber: string }> =
  [];

try {
  const browser = await chromium.launch({ headless: true });
  const { context, page } = await ensureAuth(browser);
  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: base,
    expectedHost: VERONI_CANARY_TARGET.host,
  });

  lockOrThrow(page);

  // Baseline
  const productsBefore = await adapter.listProducts();
  const categories = await adapter.listCategories();
  if (productsBefore.length !== 0) {
    throw new Error(
      `CANARY_BASELINE_CHANGED: expected 0 products, found ${productsBefore.length}`,
    );
  }
  const selected = selectExistingCategoryDeterministic(categories);
  report.baseline = {
    productCount: productsBefore.length,
    categoryCount: categories.length,
    selectedCategory: selected,
  };

  // Contract probe
  const probe = await probeAdminContract({
    page,
    baseUrl: base,
    expectedHost: VERONI_CANARY_TARGET.host,
    inspectCreateForm: true,
    inspectEditForm: false,
  });
  report.contractProbe = {
    status: probe.contractStatus,
    mismatches: probe.mismatches,
  };
  if (probe.contractStatus !== "CONTRACT_MATCH") {
    throw new Error(`CONTRACT_${probe.contractStatus}: ${probe.mismatches.join(",")}`);
  }

  // Confirm active default still checked, then demonstrate uncheck
  await page.goto(`${base}/admin/menu/create`, { waitUntil: "domcontentloaded" });
  const defaultChecked = await page.locator("#active").isChecked();
  await page.locator("#active").uncheck();
  const afterUncheck = await page.locator("#active").isChecked();
  report.activeDefault = { defaultChecked, afterUncheck };

  const first = CANARIES[0]!;
  const dry = runInactiveProductDryRun({
    hostname: VERONI_CANARY_TARGET.host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    productCount: 0,
    categoryCount: categories.length,
    contractStatus: probe.contractStatus,
    inactiveUncheckProtocolAuthorized: true,
    activeDefaultChecked: defaultChecked,
    activeCurrentlyUnchecked: afterUncheck === false,
    selectedCategoryDatabaseId: selected.databaseId,
    selectedCategoryName: selected.name,
    runId,
  });
  report.dryRun = {
    status: dry.status,
    code: dry.status === "BLOCKED" ? dry.code : null,
  };
  if (dry.status !== "DRY_RUN_OK") {
    throw new Error(`DRY_RUN blocked: ${dry.status === "BLOCKED" ? dry.message : ""}`);
  }

  // Intercept abort for first product
  const fill1 = {
    menuNumber: first.menuNumber,
    name: first.name,
    description: CANARY_NAMES.description,
    basePriceKr: first.basePriceKr,
    categoryDatabaseId: selected.databaseId,
    variants: first.variants.map((v) => ({ name: v.name, priceKr: v.priceKr })),
    ingredients: first.ingredients,
  };
  const intercepted = await interceptAbortCreate(page, fill1);
  const payloadCheck = assertInactiveCreatePayloadSafe(intercepted, {
    name: first.name,
    menuNumber: first.menuNumber,
    categoryDatabaseId: selected.databaseId,
    basePriceKr: first.basePriceKr,
  });
  report.intercept = {
    payload: intercepted,
    safety: payloadCheck,
    inactiveSemantics: {
      activeFieldPresent: intercepted.activeFieldPresent,
      activeValues: intercepted.activeValues,
      interpretation: intercepted.activeFieldPresent
        ? intercepted.looksActiveTrue
          ? "ACTIVE_TRUE_UNSAFE"
          : "ACTIVE_PRESENT_BUT_NOT_TRUE"
        : "ACTIVE_OMITTED_WHEN_UNCHECKED",
    },
  };
  if (!payloadCheck.ok) {
    throw new Error(`Intercept payload unsafe: ${payloadCheck.reason}`);
  }

  const afterIntercept = await adapter.listProducts();
  report.intercept.productCountAfter = afterIntercept.length;
  if (afterIntercept.length !== 0) {
    throw new Error("CRITICAL SAFETY FAILURE: products exist after aborted intercept");
  }

  // Real creates
  for (let i = 0; i < CANARIES.length; i++) {
    const spec = CANARIES[i]!;
    // After first product, baseline is no longer 0 — allow only our canaries
    const before = await adapter.listProducts();
    if (i === 0 && before.length !== 0) {
      throw new Error("CRITICAL: products appeared before first real submit");
    }
    if (before.some((p) => p.name === spec.name)) {
      throw new Error(`Canary already present: ${spec.name}`);
    }
    if (before.some((p) => p.menuNumber === spec.menuNumber)) {
      throw new Error(`Menu number in use: ${spec.menuNumber}`);
    }

    const plan = createInactiveProductWritePlan({
      runId,
      dryRun: false,
      menuNumber: spec.menuNumber,
      productName: spec.name,
      description: CANARY_NAMES.description,
      basePriceOre: spec.basePriceOre,
      categoryDatabaseId: selected.databaseId,
      categoryName: selected.name,
      variants: spec.variants.map((v) => ({
        name: v.name,
        priceOre: v.priceOre,
      })),
      ingredients: spec.ingredients,
      operationIdSuffix: spec.suffix,
    });

    lockOrThrow(page);
    await realCreateOnce(page, {
      menuNumber: spec.menuNumber,
      name: spec.name,
      description: CANARY_NAMES.description,
      basePriceKr: spec.basePriceKr,
      categoryDatabaseId: selected.databaseId,
      variants: spec.variants.map((v) => ({ name: v.name, priceKr: v.priceKr })),
      ingredients: spec.ingredients,
    });

    const listed = await adapter.listProducts();
    const match = listed.find((p) => p.name === spec.name);
    if (!match?.databaseId) {
      throw new Error(
        `WRITE_FAILED or ambiguous: ${spec.name} not found after single submit (count=${listed.length})`,
      );
    }

    const read = await adapter.readProduct(match.databaseId);
    const diffs: string[] = [];
    if (read.menuNumber !== spec.menuNumber) diffs.push("menuNumber");
    if (read.name !== spec.name) diffs.push("name");
    if (read.description !== CANARY_NAMES.description) diffs.push("description");
    if (read.basePriceOre !== spec.basePriceOre) diffs.push("basePriceOre");
    if (read.active !== false) diffs.push("active");
    if (!read.categoryIds.includes(selected.databaseId)) diffs.push("category");
    if (read.variants.length !== spec.variants.length) diffs.push("variantCount");
    for (let vi = 0; vi < spec.variants.length; vi++) {
      if (read.variants[vi]?.name !== spec.variants[vi]!.name) diffs.push(`variantName${vi}`);
      if (read.variants[vi]?.priceOre !== spec.variants[vi]!.priceOre)
        diffs.push(`variantPrice${vi}`);
    }
    if (read.ingredients.length !== spec.ingredients.length) diffs.push("ingredientCount");
    for (let ii = 0; ii < spec.ingredients.length; ii++) {
      if (read.ingredients[ii]?.name !== spec.ingredients[ii])
        diffs.push(`ingredient${ii}`);
    }

    if (read.active === true) {
      throw new Error(
        `CRITICAL SAFETY FAILURE: canary active=true dbId=${match.databaseId}`,
      );
    }
    if (diffs.length) {
      throw new Error(`VERIFY_FAILED ${spec.name}: ${diffs.join(",")}`);
    }

    // Public invisibility (use fresh page context without admin? same browser ok)
    const pubPage = await context.newPage();
    const visible = await publicVisible(pubPage, spec.name);
    await pubPage.close();
    if (visible) {
      throw new Error(
        `CRITICAL SAFETY FAILURE: ${spec.name} visible publicly dbId=${match.databaseId}`,
      );
    }

    createdIds.push({
      name: spec.name,
      databaseId: match.databaseId,
      menuNumber: spec.menuNumber,
    });
    (report.mutations as unknown[]).push({
      planId: plan.planId,
      databaseId: match.databaseId,
      menuNumber: spec.menuNumber,
      name: spec.name,
      active: read.active,
      publicVisible: false,
      diffs,
      verified: true,
    });
  }

  report.createdIds = createdIds;
  report.capabilities = {
    createProduct: "CERTIFIED",
    writeDefaultVariant: "CERTIFIED",
    writeIngredients: "CERTIFIED",
    assignExistingCategory: "CERTIFIED",
    writeInactiveState: "CERTIFIED",
    writeNonZeroVariants: "CERTIFIED",
    writeMultipleVariants: "CERTIFIED",
    createCategory: "UNCERTIFIED",
    writeAdditions: "UNCERTIFIED",
    updateProduct: "UNCERTIFIED",
    activateProduct: "UNCERTIFIED",
    deleteProduct: "UNCERTIFIED",
    imageUpload: "UNCERTIFIED",
  };
  report.status = "CERTIFIED";
  report.customerSafety = {
    realMenuItemsCreated: 0,
    realMenuItemsModified: 0,
    activeCanaries: 0,
    publicVisibleCanaries: 0,
    categoryMutations: 0,
    deletes: 0,
    updates: 0,
    images: 0,
  };

  writeFileSync(join(outDir, "m3-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outDir, status: report.status, createdIds }, null, 2));

  await context.close();
  await browser.close();
} catch (err) {
  report.status = "BLOCKED";
  report.error = err instanceof Error ? err.message : String(err);
  report.createdIds = createdIds;
  writeFileSync(join(outDir, "m3-report.json"), JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ outDir, status: "BLOCKED", error: report.error, createdIds }, null, 2));
  process.exitCode = 1;
}
