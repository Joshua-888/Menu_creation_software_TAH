/**
 * M3 writeAdditions certification — one synthetic HIDDEN canary on Veroni.
 * Reuses certified createProduct path. Does not certify addition UPDATE.
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
const SPEC = {
  name: CANARY_NAMES.productAdditions,
  menuNumber: CANARY_NAMES.reservedMenuNumberAdditions,
  description: CANARY_NAMES.descriptionAdditions,
  basePriceOre: 10_000,
  basePriceKr: "100",
  variants: [{ name: "Alm.", priceOre: 0, priceKr: "0" }],
  ingredients: [CANARY_NAMES.ingredient],
  additions: [
    { name: "Extra test A", priceOre: 1700, priceKr: "17" },
    { name: "Extra test B", priceOre: 2900, priceKr: "29" },
  ],
};

const WRITE_PLAN: WritePlanDynamicCollections = {
  variants: SPEC.variants.map((v) => ({ name: v.name, price: v.priceKr })),
  ingredients: SPEC.ingredients.map((name) => ({ name })),
  additions: SPEC.additions.map((a) => ({ name: a.name, price: a.priceKr })),
};

const outDir = join(root, "runs", "discovery", `m3-additions-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function finish(status: string, body: Record<string, unknown>, code = 0): never {
  const report = { milestone: "M3_ADDITIONS", status, ...body };
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
      "m3-additions-certification-evidence.json",
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
    finish("BLOCKED", { reason: "contract", mismatches: probe.mismatches }, 2);
  }

  const products = await adapter.listProducts();
  if (products.some((p) => p.name === SPEC.name)) {
    finish("BLOCKED", { reason: "CANARY_EXISTS", name: SPEC.name }, 2);
  }
  if (products.some((p) => p.menuNumber === SPEC.menuNumber)) {
    finish(
      "BLOCKED",
      { reason: "MENU_NUMBER_IN_USE", menuNumber: SPEC.menuNumber },
      2,
    );
  }

  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/menu/create`, {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);

  await fillInactiveProductCreateForm(page, {
    menuNumber: SPEC.menuNumber,
    name: SPEC.name,
    description: SPEC.description,
    basePriceKr: SPEC.basePriceKr,
    categoryDatabaseId: CATEGORY_ID,
    variants: SPEC.variants.map((v) => ({
      name: v.name,
      priceKr: v.priceKr,
    })),
    ingredients: SPEC.ingredients,
    additions: SPEC.additions.map((a) => ({
      name: a.name,
      priceKr: a.priceKr,
    })),
  });
  await assertActiveUnchecked(page);

  const snap = (await page.evaluate(
    extractAdminFormCompletenessSnapshot,
  )) as import("../src/tah/write/formCompleteness.js").AdminFormCompletenessSnapshot;
  const completeness = validateAdminFormBeforeSubmit(snap, WRITE_PLAN);
  if (!completeness.submitReady) {
    finish("FAILED", { reason: "ADMIN_FORM_NOT_SUBMIT_READY", completeness }, 2);
  }

  const { payload, mutationRequests } = await inspectFormSubmission(
    page,
    "form:has(#menu_number)",
  );
  if (mutationRequests.length) {
    finish("FAILED", { reason: "UNEXPECTED_MUTATION_REQUEST", mutationRequests }, 2);
  }
  const o = payload.asObject;
  const fieldStr = JSON.stringify(o);
  if (
    String(o.menu_number) !== SPEC.menuNumber ||
    String(o.name) !== SPEC.name ||
    String(o.description) !== SPEC.description ||
    String(o.price) !== SPEC.basePriceKr ||
    !assertPayloadHasNoActiveTrue(payload) ||
    "active" in o ||
    !fieldStr.includes("Extra test A") ||
    !fieldStr.includes("Extra test B") ||
    !fieldStr.includes("17") ||
    !fieldStr.includes("29")
  ) {
    finish("FAILED", { reason: "payload_gate", fields: o }, 2);
  }

  const observed = await clickSkabAndObserveCreate({ page, timeoutMs: 30_000 });
  if (!observed.ok) {
    finish(
      "FAILED",
      { reason: observed.code, detail: "detail" in observed ? observed.detail : undefined },
      3,
    );
  }
  if (observed.response.status >= 400) {
    finish(
      "FAILED",
      { reason: "CREATE_RESPONSE_ERROR", status: observed.response.status },
      3,
    );
  }

  await page.waitForTimeout(1500);
  const listed = await adapter.listProducts();
  const match = listed.find((p) => p.name === SPEC.name);
  if (!match?.databaseId) {
    finish("FAILED", { reason: "WRITE_FAILED_NOT_FOUND" }, 3);
  }

  const read = await adapter.readProduct(match.databaseId);
  const diffs: string[] = [];
  if (read.menuNumber !== SPEC.menuNumber) diffs.push("menuNumber");
  if (read.name !== SPEC.name) diffs.push("name");
  if (read.description !== SPEC.description) diffs.push("description");
  if (read.basePriceOre !== SPEC.basePriceOre) diffs.push("basePrice");
  if (!read.categoryIds.includes(CATEGORY_ID)) diffs.push("category");
  if (read.variants.length !== 1 || read.variants[0]?.name !== "Alm." || read.variants[0]?.priceOre !== 0) {
    diffs.push("variants");
  }
  if (
    read.ingredients.length !== 1 ||
    read.ingredients[0]?.name !== CANARY_NAMES.ingredient
  ) {
    diffs.push("ingredients");
  }
  if (read.additions.length !== 2) diffs.push("additionCount");
  if (
    read.additions[0]?.name !== "Extra test A" ||
    read.additions[0]?.priceOre !== 1700
  ) {
    diffs.push("addition0");
  }
  if (
    read.additions[1]?.name !== "Extra test B" ||
    read.additions[1]?.priceOre !== 2900
  ) {
    diffs.push("addition1");
  }
  const listStatus = (match.statusText || "").trim();
  if (listStatus !== "Skjult") diffs.push("listStatus");

  if (diffs.length) {
    finish(
      "FAILED",
      {
        reason: "READBACK_MISMATCH",
        diffs,
        read: {
          additions: read.additions,
          variants: read.variants,
          ingredients: read.ingredients,
        },
      },
      3,
    );
  }

  const pub = await context.newPage();
  await pub.goto(VERONI_CANARY_TARGET.baseUrl + "/", {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(pub);
  const body = await pub.locator("body").innerText();
  await pub.close();
  if (body.includes(SPEC.name) || body.includes(SPEC.menuNumber)) {
    finish(
      "CRITICAL_SAFETY_FAILURE",
      { databaseId: match.databaseId, publicVisible: true },
      5,
    );
  }

  finish("VERIFIED", {
    databaseId: match.databaseId,
    menuNumber: SPEC.menuNumber,
    postObserved: true,
    responseStatus: observed.response.status,
    completeness,
    listStatus,
    publicAbsent: true,
    additions: read.additions.map((a) => ({
      name: a.name,
      priceOre: a.priceOre,
    })),
    certification: { writeAdditions: "CERTIFIED" },
  });
} catch (err) {
  finish(
    "FAILED",
    { error: err instanceof Error ? err.message : String(err) },
    3,
  );
} finally {
  await browser.close();
}
