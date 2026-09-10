/**
 * M3 CREATE PRODUCT certification — Veroni synthetic HIDDEN canaries only.
 * Two creates: (1) Alm.+Familie (2) five open-ended variants.
 * No PDF import. No deletes. No force-click through overlays.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { extractAdminFormCompletenessSnapshot } from "../src/tah/adapters/v1/pageScripts.mjs";
import { probeAdminContract } from "../src/tah/probe/contractProbe.js";
import {
  assertPayloadHasNoActiveTrue,
  inspectFormSubmission,
} from "../src/tah/write/formInspect.js";
import {
  validateAdminFormBeforeSubmit,
  type WritePlanDynamicCollections,
} from "../src/tah/write/formCompleteness.js";
import {
  assertActiveUnchecked,
  fillInactiveProductCreateForm,
} from "../src/tah/write/formFill.js";
import { clickSkabAndObserveCreate } from "../src/tah/write/createRequestObserve.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import {
  assertVeroniTargetLock,
  blockWriteUnlessTargetLocked,
} from "../src/tah/write/targetLock.js";
import { CANARY_NAMES, VERONI_CANARY_TARGET } from "../src/tah/write/types.js";

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

const CATEGORY_ID = "1";
const outDir = join(root, "runs", "discovery", `m3-create-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

type CreateSpec = {
  id: string;
  name: string;
  menuNumber: string;
  description: string;
  basePriceOre: number;
  basePriceKr: string;
  variants: Array<{ name: string; priceOre: number; priceKr: string }>;
  ingredients: string[];
};

const FIRST: CreateSpec = {
  id: "create-1",
  name: CANARY_NAMES.productCreate,
  menuNumber: CANARY_NAMES.reservedMenuNumberCreate,
  description: CANARY_NAMES.descriptionCreate,
  basePriceOre: 10_000,
  basePriceKr: "100",
  variants: [
    { name: "Alm.", priceOre: 0, priceKr: "0" },
    { name: "Familie", priceOre: 8000, priceKr: "80" },
  ],
  ingredients: [CANARY_NAMES.ingredientA, CANARY_NAMES.ingredientB],
};

const SECOND: CreateSpec = {
  id: "create-multi",
  name: CANARY_NAMES.productCreateMulti,
  menuNumber: CANARY_NAMES.reservedMenuNumberCreateMulti,
  description: CANARY_NAMES.descriptionCreate,
  basePriceOre: 10_000,
  basePriceKr: "100",
  variants: [
    { name: "Alm.", priceOre: 0, priceKr: "0" },
    { name: "Deep Pan", priceOre: 2000, priceKr: "20" },
    { name: "Glutenfri", priceOre: 2500, priceKr: "25" },
    { name: "Fuldkorn", priceOre: 1000, priceKr: "10" },
    { name: "Familie", priceOre: 8000, priceKr: "80" },
  ],
  ingredients: [CANARY_NAMES.ingredientA, CANARY_NAMES.ingredientB],
};

function finish(status: string, body: Record<string, unknown>, code = 0): never {
  const report = { milestone: "M3_CREATE", status, ...body };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  mkdirSync(join(root, "fixtures", "admin-contracts", "v1"), {
    recursive: true,
  });
  writeFileSync(
    join(
      root,
      "fixtures",
      "admin-contracts",
      "v1",
      "m3-create-certification-evidence.json",
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  process.exit(code);
}

async function ensureAdmin(page: Page) {
  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  if (/\/login/i.test(page.url())) {
    await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('input[type="email"]')
      .first()
      .fill(process.env.TAH_ADMIN_EMAIL!);
    await page
      .locator('input[type="password"]')
      .first()
      .fill(process.env.TAH_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
  }
}

async function publicCheck(page: Page, name: string, menuNumber: string) {
  await page.goto(VERONI_CANARY_TARGET.baseUrl + "/", {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  const text = await page.locator("body").innerText();
  return {
    visibleName: text.includes(name),
    visibleMenuNumber: text.includes(menuNumber),
  };
}

function writePlanFromSpec(spec: CreateSpec): WritePlanDynamicCollections {
  return {
    variants: spec.variants.map((v) => ({
      name: v.name,
      price: v.priceKr,
    })),
    ingredients: spec.ingredients.map((name) => ({ name })),
    additions: [],
  };
}

function verifyRead(
  spec: CreateSpec,
  read: Awaited<ReturnType<TahAdminAdapterV1["readProduct"]>>,
  listStatus: string,
): string[] {
  const diffs: string[] = [];
  if (read.menuNumber !== spec.menuNumber) diffs.push("menuNumber");
  if (read.name !== spec.name) diffs.push("name");
  if (read.description !== spec.description) diffs.push("description");
  if (read.basePriceOre !== spec.basePriceOre) diffs.push("basePrice");
  if (!read.categoryIds.includes(CATEGORY_ID)) diffs.push("category");
  if (read.variants.length !== spec.variants.length) diffs.push("variantCount");
  for (let i = 0; i < spec.variants.length; i++) {
    if (read.variants[i]?.name !== spec.variants[i]!.name)
      diffs.push(`variantName${i}`);
    if (read.variants[i]?.priceOre !== spec.variants[i]!.priceOre)
      diffs.push(`variantPrice${i}`);
  }
  if (read.ingredients.length !== spec.ingredients.length)
    diffs.push("ingredientCount");
  for (let i = 0; i < spec.ingredients.length; i++) {
    if (read.ingredients[i]?.name !== spec.ingredients[i])
      diffs.push(`ingredient${i}`);
  }
  if ((listStatus || "").trim() !== "Skjult") diffs.push("listStatus");
  return diffs;
}

async function createOnce(
  page: Page,
  adapter: TahAdminAdapterV1,
  context: Awaited<
    ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newContext"]>
  >,
  spec: CreateSpec,
): Promise<{
  databaseId: string;
  postObserved: boolean;
  responseStatus: number;
  finalUrl: string;
  cookieHandling: unknown;
  formCompleteness: unknown;
  preSubmit: unknown;
  diffs: string[];
  listStatus: string;
  publicAfter: { visibleName: boolean; visibleMenuNumber: boolean };
  read: unknown;
}> {
  const products = await adapter.listProducts();
  if (products.some((p) => p.name === spec.name)) {
    throw new Error(`CANARY_EXISTS: ${spec.name}`);
  }
  if (products.some((p) => p.menuNumber === spec.menuNumber)) {
    throw new Error(`MENU_NUMBER_IN_USE: ${spec.menuNumber}`);
  }

  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/menu/create`, {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);

  await fillInactiveProductCreateForm(page, {
    menuNumber: spec.menuNumber,
    name: spec.name,
    description: spec.description,
    basePriceKr: spec.basePriceKr,
    categoryDatabaseId: CATEGORY_ID,
    variants: spec.variants.map((v) => ({
      name: v.name,
      priceKr: v.priceKr,
    })),
    ingredients: spec.ingredients,
  });
  await assertActiveUnchecked(page);

  const snap = (await page.evaluate(
    extractAdminFormCompletenessSnapshot,
  )) as import("../src/tah/write/formCompleteness.js").AdminFormCompletenessSnapshot;
  const completeness = validateAdminFormBeforeSubmit(
    snap,
    writePlanFromSpec(spec),
  );
  if (!completeness.submitReady) {
    throw new Error(
      `ADMIN_FORM_NOT_SUBMIT_READY: ${JSON.stringify(completeness.issues)}`,
    );
  }

  const { payload, mutationRequests } = await inspectFormSubmission(
    page,
    "form:has(#menu_number)",
  );
  if (mutationRequests.length) {
    throw new Error(`UNEXPECTED_MUTATION_REQUEST: ${mutationRequests.join(",")}`);
  }
  const o = payload.asObject;
  const actionPath = (payload.action || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/\/$/, "");
  if (
    actionPath !== "/admin/menu" ||
    String(o.menu_number) !== spec.menuNumber ||
    String(o.name) !== spec.name ||
    String(o.description) !== spec.description ||
    String(o.price) !== spec.basePriceKr ||
    !assertPayloadHasNoActiveTrue(payload) ||
    "active" in o
  ) {
    throw new Error(
      `payload_gate: ${JSON.stringify({
        actionPath,
        menu_number: o.menu_number,
        name: o.name,
        description: o.description,
        price: o.price,
        active: o.active,
      })}`,
    );
  }

  // Variant/ingredient presence in FormData (keys vary by index)
  const fieldStr = JSON.stringify(o);
  for (const v of spec.variants) {
    if (!fieldStr.includes(v.name)) {
      throw new Error(`payload missing variant name ${v.name}`);
    }
  }
  for (const ing of spec.ingredients) {
    if (!fieldStr.includes(ing)) {
      throw new Error(`payload missing ingredient ${ing}`);
    }
  }
  const cats = o["categories[]"];
  const catOk =
    cats === CATEGORY_ID ||
    (Array.isArray(cats) && cats.includes(CATEGORY_ID));
  if (!catOk) throw new Error(`payload missing category ${CATEGORY_ID}`);

  const observed = await clickSkabAndObserveCreate({ page, timeoutMs: 30_000 });
  if (!observed.ok) {
    throw new Error(observed.code + (observed.detail ? `: ${observed.detail}` : ""));
  }
  if (observed.response.status >= 400) {
    throw new Error(`CREATE_RESPONSE_ERROR status=${observed.response.status}`);
  }

  await page.waitForTimeout(1500);
  const listed = await adapter.listProducts();
  const match = listed.find((p) => p.name === spec.name);
  if (!match?.databaseId) {
    throw new Error(`WRITE_FAILED: ${spec.name} not found after Skab`);
  }
  const read = await adapter.readProduct(match.databaseId);
  const listStatus = (match.statusText || "").trim();
  const diffs = verifyRead(spec, read, listStatus);
  if (diffs.length) {
    throw new Error(`READBACK_MISMATCH: ${diffs.join(",")}`);
  }

  const pub = await context.newPage();
  const publicAfter = await publicCheck(pub, spec.name, spec.menuNumber);
  await pub.close();
  if (publicAfter.visibleName || publicAfter.visibleMenuNumber) {
    throw new Error(
      `CRITICAL_SAFETY_FAILURE: public visible ${spec.name} / ${spec.menuNumber}`,
    );
  }

  return {
    databaseId: match.databaseId,
    postObserved: true,
    responseStatus: observed.response.status,
    finalUrl: observed.response.finalUrl || page.url(),
    cookieHandling: observed.interactability,
    formCompleteness: completeness,
    preSubmit: {
      action: payload.action,
      menu_number: o.menu_number,
      name: o.name,
      description: o.description,
      price: o.price,
      activeOmitted: !("active" in o),
      categoryOk: true,
    },
    diffs,
    listStatus,
    publicAfter,
    read: {
      menuNumber: read.menuNumber,
      name: read.name,
      description: read.description,
      basePriceOre: read.basePriceOre,
      categoryIds: read.categoryIds,
      variants: read.variants.map((v) => ({
        name: v.name,
        priceOre: v.priceOre,
      })),
      ingredients: read.ingredients.map((i) => i.name),
    },
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: existsSync(
    join(root, "playwright", ".auth", "tah-admin-veroni.json"),
  )
    ? join(root, "playwright", ".auth", "tah-admin-veroni.json")
    : undefined,
});
const page = await context.newPage();
const adapter = new TahAdminAdapterV1({
  page,
  baseUrl: VERONI_CANARY_TARGET.baseUrl,
  expectedHost: VERONI_CANARY_TARGET.host,
});

try {
  await ensureAdmin(page);
  const lock = assertVeroniTargetLock({
    hostname: new URL(page.url()).hostname,
    restaurantName: "Veroni Pizza",
  });
  blockWriteUnlessTargetLocked(lock);

  const probe = await probeAdminContract({
    page,
    baseUrl: VERONI_CANARY_TARGET.baseUrl,
    expectedHost: VERONI_CANARY_TARGET.host,
    inspectCreateForm: true,
    inspectEditForm: false,
  });
  if (probe.contractStatus !== "CONTRACT_MATCH") {
    finish(
      "BLOCKED",
      { reason: "contract", mismatches: probe.mismatches },
      2,
    );
  }

  const categories = await adapter.listCategories();
  if (!categories.some((c) => c.databaseId === CATEGORY_ID)) {
    finish(
      "BLOCKED",
      { reason: "category_1_missing", categories },
      2,
    );
  }

  const firstResult = await createOnce(page, adapter, context, FIRST);
  const multiResult = await createOnce(page, adapter, context, SECOND);

  finish("VERIFIED", {
    cookieOverlayHandling:
      "dismissKnownCookieBanner + assertSubmitControlInteractable before Skab (no force-click)",
    firstCanary: {
      ...firstResult,
      name: FIRST.name,
      menuNumber: FIRST.menuNumber,
    },
    multiCanary: {
      ...multiResult,
      name: SECOND.name,
      menuNumber: SECOND.menuNumber,
    },
    certification: {
      createProduct: "CERTIFIED",
      createHiddenProduct: "CERTIFIED",
      writeDefaultVariant: "CERTIFIED",
      writeNonZeroVariants: "CERTIFIED",
      writeIngredients: "CERTIFIED",
      assignExistingCategory: "CERTIFIED",
      writeMultipleVariants: "CERTIFIED",
      createCategory: "UNCERTIFIED",
      writeAdditions: "UNCERTIFIED",
      imageUpload: "UNCERTIFIED",
      createAvailableProduct: "UNCERTIFIED",
      deleteProduct: "UNCERTIFIED",
      updateProduct: "UNCERTIFIED",
      setProductHidden: "UNCERTIFIED",
      setProductAvailable: "UNCERTIFIED",
    },
    READY_FOR_REAL_MENU_DRY_RUN: false,
    note: "Synthetic create certified only. Do not import Veroni PDF automatically.",
  });
} catch (err) {
  finish(
    "FAILED",
    {
      error: err instanceof Error ? err.message : String(err),
      certification: {
        createProduct: "UNCERTIFIED",
        createHiddenProduct: "UNCERTIFIED",
      },
      READY_FOR_REAL_MENU_DRY_RUN: false,
    },
    3,
  );
} finally {
  await browser.close();
}
