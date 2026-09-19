/**
 * EXPLICIT_APPROVED_OPDATER_SUBMIT — ONE Opdater on Veroni canary product 18.
 * Preserves all business fields; only ensures #active unchecked (intended HIDDEN).
 * Does NOT certify setProductHidden (no AVAILABLE→HIDDEN transition).
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

const outDir = join(
  root,
  "runs",
  "discovery",
  `m3e-opdater-18-${Date.now()}`,
);
mkdirSync(outDir, { recursive: true });

function normalizeSnapshot(p: {
  databaseId: string;
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
  activeCheckbox: boolean | null;
  active: boolean | null;
  listAvailability?: string;
}) {
  return {
    databaseId: p.databaseId,
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
    activeCheckbox: p.activeCheckbox,
    active: p.active,
    listAvailability: p.listAvailability ?? null,
  };
}

type Snapshot = ReturnType<typeof normalizeSnapshot>;

function businessDiff(before: Snapshot, after: Snapshot): string[] {
  const diffs: string[] = [];
  const keys: (keyof Snapshot)[] = [
    "menuNumber",
    "name",
    "description",
    "basePriceOre",
    "basePriceRaw",
    "categoryIds",
    "variants",
    "ingredients",
    "additions",
  ];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      diffs.push(k);
    }
  }
  return diffs;
}

function fieldVal(
  obj: Record<string, string | string[]>,
  key: string,
): string | string[] | undefined {
  return obj[key];
}

async function ensureAdmin(page: Page) {
  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  if (/\/login/i.test(page.url())) {
    const email = process.env.TAH_ADMIN_EMAIL;
    const password = process.env.TAH_ADMIN_PASSWORD;
    if (!email || !password) throw new Error("Missing TAH_ADMIN_EMAIL/PASSWORD");
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

async function publicVisibility(page: Page): Promise<{
  visibleCanary: boolean;
  visibleMenuNumber: boolean;
}> {
  await page.goto(VERONI_CANARY_TARGET.baseUrl + "/", {
    waitUntil: "domcontentloaded",
  });
  const text = await page.locator("body").innerText();
  return {
    visibleCanary: text.includes(CANARY.name),
    visibleMenuNumber: text.includes(CANARY.menuNumber),
  };
}

function block(reason: string, extra?: unknown): never {
  const report = { status: "BLOCKED", reason, extra };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exit(2);
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
  // ---------- 2. TARGET LOCK ----------
  await ensureAdmin(page);
  const host = new URL(page.url()).hostname;
  const lock = assertVeroniTargetLock({
    hostname: host,
    restaurantName: "Veroni Pizza",
    url: page.url(),
  });
  blockWriteUnlessTargetLocked(lock);

  // ---------- 3. BEFORE SNAPSHOT ----------
  const products = await adapter.listProducts();
  const row = products.find((p) => p.databaseId === CANARY.databaseId);
  if (!row) block("product_18_missing_from_list");
  if (row.name !== CANARY.name || row.menuNumber !== CANARY.menuNumber) {
    block("canary_identity_mismatch", row);
  }
  if ((row.statusText || "").trim() !== "Skjult") {
    block("list_not_skjult", row.statusText);
  }
  const unexpected = products.filter((p) => p.databaseId !== CANARY.databaseId);
  // Allow only canary as product — warn/block if unexpected customer products appear
  // User: "No other Veroni products should unexpectedly exist."
  if (unexpected.length > 0) {
    block("unexpected_other_products", unexpected.map((p) => p.name));
  }

  const beforeProduct = await adapter.readProduct(CANARY.databaseId);
  if (
    beforeProduct.name !== CANARY.name ||
    beforeProduct.menuNumber !== CANARY.menuNumber ||
    beforeProduct.databaseId !== CANARY.databaseId
  ) {
    block("readProduct_identity_mismatch", beforeProduct);
  }
  const before = normalizeSnapshot(beforeProduct);
  writeFileSync(join(outDir, "before.json"), JSON.stringify(before, null, 2));

  const pubPage = await context.newPage();
  const publicBefore = await publicVisibility(pubPage);
  await pubPage.close();
  if (publicBefore.visibleCanary || publicBefore.visibleMenuNumber) {
    block("CRITICAL: canary already public before update", publicBefore);
  }

  // ---------- 4. CONTRACT PROBE ----------
  const probe = await adapter.probeContract();
  if (probe.status !== "CONTRACT_MATCH") {
    block("contract_not_match", probe);
  }

  // ---------- 5. PREPARE EDIT FORM ----------
  await page.goto(
    `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${CANARY.databaseId}/edit`,
    { waitUntil: "domcontentloaded" },
  );
  const editHost = new URL(page.url()).hostname;
  if (editHost !== VERONI_CANARY_TARGET.host) {
    block("edit_page_wrong_host", editHost);
  }

  const formIdentity = await page.evaluate(() => ({
    name: (document.querySelector("#name") as HTMLInputElement | null)?.value,
    menuNumber: (
      document.querySelector("#menu_number") as HTMLInputElement | null
    )?.value,
    activeChecked: (
      document.querySelector("#active") as HTMLInputElement | null
    )?.checked,
  }));
  if (
    formIdentity.name !== CANARY.name ||
    formIdentity.menuNumber !== CANARY.menuNumber
  ) {
    block("edit_form_identity_mismatch", formIdentity);
  }

  const active = page.locator("#active");
  if (await active.isChecked()) {
    await active.uncheck();
  }
  if (await active.isChecked()) {
    block("failed_to_uncheck_active");
  }

  // ---------- 6. ZERO-NETWORK FORMDATA ----------
  const { payload, mutationRequests } = await inspectFormSubmission(
    page,
    "form:has(#menu_number)",
  );
  if (mutationRequests.length > 0) {
    block("mutation_during_form_inspect", mutationRequests);
  }
  const asObj = payload.asObject;
  if (String(asObj._method || "").toLowerCase() !== "put") {
    block("form_method_not_put", asObj._method);
  }
  const action = (payload.action || "").replace(/\/$/, "");
  if (action !== "/admin/menu/18") {
    block("form_action_mismatch", payload.action);
  }
  if (!assertPayloadHasNoActiveTrue(payload) || "active" in asObj) {
    block("active_not_omitted", {
      present: "active" in asObj,
      value: asObj.active,
    });
  }
  if (String(asObj.name) !== CANARY.name) block("payload_name_mismatch", asObj.name);
  if (String(asObj.menu_number) !== CANARY.menuNumber) {
    block("payload_menu_number_mismatch", asObj.menu_number);
  }
  if (String(asObj.price) !== String(before.basePriceRaw)) {
    block("payload_price_mismatch", { got: asObj.price, expected: before.basePriceRaw });
  }
  const cats = fieldVal(asObj, "categories[]");
  const catList = Array.isArray(cats) ? cats : cats ? [cats] : [];
  if (
    JSON.stringify([...catList].sort()) !==
    JSON.stringify([...before.categoryIds].sort())
  ) {
    block("payload_categories_mismatch", { catList, expected: before.categoryIds });
  }
  for (let i = 0; i < before.variants.length; i++) {
    const vn = String(asObj[`variants[${i}][name]`] ?? "");
    const vp = String(asObj[`variants[${i}][price]`] ?? "");
    if (vn !== before.variants[i]!.name) {
      block("payload_variant_name_mismatch", { i, vn, expected: before.variants[i]!.name });
    }
    if (vp !== before.variants[i]!.priceRaw) {
      block("payload_variant_price_mismatch", { i, vp, expected: before.variants[i]!.priceRaw });
    }
  }
  for (let i = 0; i < before.ingredients.length; i++) {
    const iname = String(asObj[`ingredients[${i}][name]`] ?? "");
    if (iname !== before.ingredients[i]!.name) {
      block("payload_ingredient_mismatch", { i, iname });
    }
  }

  const sanitizedPayload = {
    method: payload.method,
    action: payload.action,
    asObject: Object.fromEntries(
      Object.entries(asObj).filter(([k]) => !/token|csrf|password|cookie|session/i.test(k)),
    ),
  };
  writeFileSync(
    join(outDir, "presubmit-formdata.json"),
    JSON.stringify(sanitizedPayload, null, 2),
  );

  // ---------- 7. FINAL PRE-SUBMIT ASSERTIONS ----------
  if (!(await active.count()) || (await active.isChecked())) {
    block("active_checked_at_final_gate");
  }
  const lock2 = assertVeroniTargetLock({
    hostname: new URL(page.url()).hostname,
    restaurantName: "Veroni Pizza",
  });
  blockWriteUnlessTargetLocked(lock2);

  // ---------- 8. ONE OPDATER ----------
  let updatePosted = false;
  page.once("request", (req) => {
    if (
      req.method().toUpperCase() === "POST" &&
      /\/admin\/menu\/18\/?$/i.test(new URL(req.url()).pathname)
    ) {
      updatePosted = true;
    }
  });

  await page.getByRole("button", { name: /^Opdater$/i }).click({ force: true });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  // ---------- 9–10. READ BACK ----------
  const listAfter = await adapter.listProducts();
  const rowAfter = listAfter.find((p) => p.databaseId === CANARY.databaseId);
  if (!rowAfter) block("VERIFY_FAILED: product_18_missing_after_update");

  const afterProduct = await adapter.readProduct(CANARY.databaseId);
  const after = normalizeSnapshot(afterProduct);
  writeFileSync(join(outDir, "after.json"), JSON.stringify(after, null, 2));

  const diffs = businessDiff(before, after);
  if (diffs.length > 0) {
    const report = {
      status: "VERIFY_FAILED",
      reason: "unintended_field_changes",
      diffs,
      before,
      after,
      updatePosted,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exit(3);
  }

  // ---------- 11. VISIBILITY ----------
  const listStatusAfter = (rowAfter.statusText || "").trim();
  if (listStatusAfter !== "Skjult") {
    const report = {
      status: "CRITICAL_SAFETY_FAILURE",
      reason: "list_not_skjult_after_update",
      listStatusAfter,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exit(4);
  }

  const pub2 = await context.newPage();
  const publicAfter = await publicVisibility(pub2);
  await pub2.close();
  if (publicAfter.visibleCanary || publicAfter.visibleMenuNumber) {
    const report = {
      status: "CRITICAL_SAFETY_FAILURE",
      reason: "canary_became_public",
      publicAfter,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exit(5);
  }

  // ---------- 12. EDIT CHECKBOX AFTER SAVE ----------
  await page.goto(
    `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${CANARY.databaseId}/edit`,
    { waitUntil: "domcontentloaded" },
  );
  const afterEditControl = await page.evaluate(() => {
    const el = document.querySelector("#active") as HTMLInputElement | null;
    return {
      checked: el?.checked ?? null,
      hasCheckedAttr: el?.hasAttribute("checked") ?? null,
      defaultChecked: el?.defaultChecked ?? null,
    };
  });

  const report = {
    status: "VERIFIED",
    EXPLICIT_APPROVED_OPDATER_SUBMIT: true,
    targetLock: lock,
    probe: probe.status,
    before,
    after,
    businessDiffs: diffs,
    listStatusBefore: "Skjult",
    listStatusAfter,
    publicBefore,
    publicAfter,
    preSubmitActiveUnchecked: true,
    formDataActiveOmitted: true,
    updatePosted,
    afterEditControl,
    layers: {
      formControl: afterEditControl.checked,
      persistedAdminList: listStatusAfter,
      storefrontVisible: false,
    },
    certification: {
      updateExistingProductForm: "CERTIFIED",
      updatePersistBoundary: "CERTIFIED",
      updateProduct: "UNCERTIFIED",
      setProductHidden: "UNCERTIFIED",
      setProductAvailable: "UNCERTIFIED",
      note: "Hidden→hidden Opdater with field preservation proves edit persist boundary only; no visibility state transition demonstrated.",
    },
    productsCreated: 0,
    deletes: 0,
    otherProductsModified: 0,
  };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
