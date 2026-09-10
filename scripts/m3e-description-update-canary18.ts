/**
 * M3E — ONE controlled description update on Veroni canary 18.
 * EXPLICIT: description only. Opdater once. No visibility transition test.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import {
  assertPayloadHasNoActiveTrue,
  inspectFormSubmission,
} from "../src/tah/write/formInspect.js";
import {
  assertVeroniTargetLock,
  blockWriteUnlessTargetLocked,
} from "../src/tah/write/targetLock.js";
import { VERONI_CANARY_TARGET, CANARY_NAMES } from "../src/tah/write/types.js";
import {
  assertExactlyAllowedSemanticDiff,
  createDescriptionUpdatePlan,
  mayRetryOpdaterAfterAmbiguousResult,
  semanticDiff,
  type SemanticProductSnapshot,
} from "../src/tah/write/updatePlan.js";

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

const CANARY = {
  databaseId: "18",
  menuNumber: CANARY_NAMES.reservedMenuNumber,
  name: CANARY_NAMES.product,
} as const;

const NEW_DESCRIPTION = "Automated TakeAwayHero canary test v2";

const outDir = join(
  root,
  "runs",
  "discovery",
  `m3e-desc-18-${Date.now()}`,
);
mkdirSync(outDir, { recursive: true });

function toSnapshot(p: {
  menuNumber: string | null;
  name: string | null;
  description: string | null;
  basePriceOre: number | null;
  basePriceRaw: string | null;
  categoryIds: string[];
  variants: Array<{
    databaseId: string | null;
    name: string;
    priceOre: number | null;
    priceRaw: string;
  }>;
  ingredients: Array<{ databaseId: string | null; name: string }>;
  additions: Array<{
    databaseId: string | null;
    name: string;
    priceOre: number | null;
    priceRaw: string;
  }>;
}): SemanticProductSnapshot {
  return {
    menuNumber: p.menuNumber,
    name: p.name,
    description: p.description,
    basePriceOre: p.basePriceOre,
    basePriceRaw: p.basePriceRaw,
    categoryIds: [...p.categoryIds].sort(),
    variants: p.variants.map((v) => ({
      databaseId: v.databaseId,
      name: v.name,
      priceOre: v.priceOre,
      priceRaw: v.priceRaw,
    })),
    ingredients: p.ingredients.map((i) => ({
      databaseId: i.databaseId,
      name: i.name,
    })),
    additions: p.additions.map((a) => ({
      databaseId: a.databaseId,
      name: a.name,
      priceOre: a.priceOre,
      priceRaw: a.priceRaw,
    })),
  };
}

function block(reason: string, extra?: unknown): never {
  const report = { status: "BLOCKED", reason, extra };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exit(2);
}

async function ensureAdmin(page: Page) {
  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  if (/\/login/i.test(page.url())) {
    const email = process.env.TAH_ADMIN_EMAIL;
    const password = process.env.TAH_ADMIN_PASSWORD;
    if (!email || !password) throw new Error("Missing credentials");
    await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('input[type="email"], input[name="email"]')
      .first()
      .fill(email);
    await page
      .locator('input[type="password"], input[name="password"]')
      .first()
      .fill(password);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
  }
}

async function publicCheck(page: Page) {
  await page.goto(VERONI_CANARY_TARGET.baseUrl + "/", {
    waitUntil: "domcontentloaded",
  });
  const text = await page.locator("body").innerText();
  return {
    visibleCanary: text.includes(CANARY.name),
    visibleMenuNumber: text.includes(CANARY.menuNumber),
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

let opdaterClicked = false;

try {
  await ensureAdmin(page);
  const lock = assertVeroniTargetLock({
    hostname: new URL(page.url()).hostname,
    restaurantName: "Veroni Pizza",
  });
  blockWriteUnlessTargetLocked(lock);

  const products = await adapter.listProducts();
  const row = products.find((p) => p.databaseId === CANARY.databaseId);
  if (!row) block("product_missing");
  if (row.name !== CANARY.name || row.menuNumber !== CANARY.menuNumber) {
    block("identity_mismatch", row);
  }
  if ((row.statusText || "").trim() !== "Skjult") {
    block("not_skjult", row.statusText);
  }
  if (products.some((p) => p.databaseId !== CANARY.databaseId)) {
    block(
      "unexpected_other_products",
      products.filter((p) => p.databaseId !== CANARY.databaseId),
    );
  }

  const probe = await adapter.probeContract();
  if (probe.status !== "CONTRACT_MATCH") block("contract_drift", probe);

  const beforeProduct = await adapter.readProduct(CANARY.databaseId);
  const before = toSnapshot(beforeProduct);
  const beforeActive = {
    activeCheckbox: beforeProduct.activeCheckbox,
    listAvailability: beforeProduct.listAvailability,
  };
  writeFileSync(join(outDir, "before.json"), JSON.stringify({ before, beforeActive }, null, 2));

  const pub1 = await context.newPage();
  const publicBefore = await publicCheck(pub1);
  await pub1.close();
  if (publicBefore.visibleCanary || publicBefore.visibleMenuNumber) {
    block("CRITICAL_public_before", publicBefore);
  }

  const oldDescription = before.description ?? "";
  if (oldDescription === NEW_DESCRIPTION) {
    block("description_already_v2_noop");
  }

  const plan = createDescriptionUpdatePlan({
    databaseId: CANARY.databaseId,
    expectedBeforeDescription: oldDescription,
    expectedAfterDescription: NEW_DESCRIPTION,
    preserved: {
      menuNumber: before.menuNumber,
      name: before.name,
      basePriceRaw: before.basePriceRaw,
      categoryIds: before.categoryIds,
      variants: before.variants,
      ingredients: before.ingredients,
      additions: before.additions,
    },
  });
  writeFileSync(join(outDir, "update-plan.json"), JSON.stringify(plan, null, 2));

  await page.goto(
    `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${CANARY.databaseId}/edit`,
    { waitUntil: "domcontentloaded" },
  );

  // Preserve identity; set description only
  await page.locator("#description").fill(NEW_DESCRIPTION);

  // Keep intended HIDDEN form protocol: uncheck #active if checked
  const active = page.locator("#active");
  if (await active.isChecked()) {
    await active.uncheck();
  }
  if (await active.isChecked()) block("active_still_checked");

  const { payload, mutationRequests } = await inspectFormSubmission(
    page,
    "form:has(#menu_number)",
  );
  if (mutationRequests.length) block("mutation_during_inspect", mutationRequests);
  const o = payload.asObject;
  if (String(o._method || "").toLowerCase() !== "put") block("not_put", o._method);
  if ((payload.action || "").replace(/\/$/, "") !== "/admin/menu/18") {
    block("bad_action", payload.action);
  }
  if (String(o.description) !== NEW_DESCRIPTION) {
    block("payload_description_mismatch", o.description);
  }
  if (String(o.name) !== CANARY.name) block("payload_name", o.name);
  if (String(o.menu_number) !== CANARY.menuNumber) {
    block("payload_menu", o.menu_number);
  }
  if (String(o.price) !== String(before.basePriceRaw)) {
    block("payload_price", o.price);
  }
  if (!assertPayloadHasNoActiveTrue(payload) || "active" in o) {
    block("active_not_omitted", o.active);
  }
  const cats = o["categories[]"];
  const catList = Array.isArray(cats) ? cats : cats ? [cats] : [];
  if (
    JSON.stringify([...catList].sort()) !==
    JSON.stringify([...before.categoryIds].sort())
  ) {
    block("payload_cats", catList);
  }
  for (let i = 0; i < before.variants.length; i++) {
    if (String(o[`variants[${i}][name]`]) !== before.variants[i]!.name) {
      block("variant_name", i);
    }
    if (String(o[`variants[${i}][price]`]) !== before.variants[i]!.priceRaw) {
      block("variant_price", i);
    }
  }
  for (let i = 0; i < before.ingredients.length; i++) {
    if (String(o[`ingredients[${i}][name]`]) !== before.ingredients[i]!.name) {
      block("ingredient", i);
    }
  }

  writeFileSync(
    join(outDir, "presubmit-formdata.json"),
    JSON.stringify(
      {
        method: payload.method,
        action: payload.action,
        description: o.description,
        name: o.name,
        menu_number: o.menu_number,
        price: o.price,
        activePresent: "active" in o,
        _method: o._method,
      },
      null,
      2,
    ),
  );

  // ONE Opdater — no blind retry
  if (mayRetryOpdaterAfterAmbiguousResult()) {
    block("retry_policy_broken");
  }
  opdaterClicked = true;
  await page.getByRole("button", { name: /^Opdater$/i }).click({ force: true });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  const listAfter = await adapter.listProducts();
  const rowAfter = listAfter.find((p) => p.databaseId === CANARY.databaseId);
  if (!rowAfter) {
    const report = {
      status: "VERIFY_FAILED",
      reason: "product_missing_after",
      opdaterClicked,
      note: "no_blind_retry",
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exit(3);
  }

  const afterProduct = await adapter.readProduct(CANARY.databaseId);
  const after = toSnapshot(afterProduct);
  writeFileSync(join(outDir, "after.json"), JSON.stringify(after, null, 2));

  const diffs = semanticDiff(before, after);
  const diffCheck = assertExactlyAllowedSemanticDiff(diffs, ["description"]);
  if (!diffCheck.ok || after.description !== NEW_DESCRIPTION) {
    const report = {
      status: "VERIFY_FAILED",
      reason: "unauthorized_or_missing_diff",
      diffs,
      unauthorized: diffCheck.ok ? [] : diffCheck.unauthorized,
      afterDescription: after.description,
      expected: NEW_DESCRIPTION,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exit(3);
  }

  const listStatusAfter = (rowAfter.statusText || "").trim();
  if (listStatusAfter !== "Skjult") {
    const report = {
      status: "CRITICAL_SAFETY_FAILURE",
      reason: "not_skjult_after",
      listStatusAfter,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exit(4);
  }

  const pub2 = await context.newPage();
  const publicAfter = await publicCheck(pub2);
  await pub2.close();
  if (publicAfter.visibleCanary || publicAfter.visibleMenuNumber) {
    const report = {
      status: "CRITICAL_SAFETY_FAILURE",
      reason: "became_public",
      publicAfter,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exit(5);
  }

  await page.goto(
    `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${CANARY.databaseId}/edit`,
    { waitUntil: "domcontentloaded" },
  );
  const afterEditControl = await page.evaluate(() => {
    const el = document.querySelector("#active") as HTMLInputElement | null;
    return {
      checked: el?.checked ?? null,
      description: (
        document.querySelector("#description") as HTMLTextAreaElement | null
      )?.value,
    };
  });

  const report = {
    status: "VERIFIED",
    checkpointCommit: "b60d5e6",
    targetLock: lock,
    plan: {
      action: plan.action,
      databaseId: plan.databaseId,
      allowedChanges: plan.allowedChanges,
    },
    before,
    after,
    semanticDiff: diffs,
    unauthorizedFieldChanges: [],
    listStatusAfter,
    publicBefore,
    publicAfter,
    afterEditControl,
    layers: {
      formControl: afterEditControl.checked,
      persistedAdminList: listStatusAfter,
      storefrontVisible: false,
    },
    certification: {
      updateProductDescription: "CERTIFIED",
      updateScalarProductField: "CERTIFIED",
      updateExistingProductForm: "CERTIFIED",
      updateProduct: "UNCERTIFIED",
      setProductHidden: "UNCERTIFIED",
      setProductAvailable: "UNCERTIFIED",
    },
    opdaterClickedOnce: opdaterClicked,
    productsCreated: 0,
    realProductsModified: 0,
  };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
