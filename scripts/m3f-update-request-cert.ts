/**
 * M3F — ONE instrumented Opdater on Veroni canary 18 (description only).
 * Observes exact POST /admin/menu/18 + _method=put request/response.
 * No abort. No retry.
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
  semanticDiff,
  type SemanticProductSnapshot,
} from "../src/tah/write/updatePlan.js";
import {
  classifyUpdateOutcome,
  clickOpdaterAndObserveUpdate,
} from "../src/tah/write/updateRequestObserve.js";

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
const OLD_DESC = "Automated TakeAwayHero inactive canary test";
const NEW_DESC = "Automated TakeAwayHero canary test v2";

const outDir = join(root, "runs", "discovery", `m3f-update-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function toSnap(p: {
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
    variants: p.variants.map((v) => ({ ...v })),
    ingredients: p.ingredients.map((i) => ({ ...i })),
    additions: p.additions.map((a) => ({ ...a })),
  };
}

function finish(status: string, body: Record<string, unknown>, code = 0): never {
  const report = { status, ...body };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(code);
}

async function ensureAdmin(page: Page) {
  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  if (/\/login/i.test(page.url())) {
    const email = process.env.TAH_ADMIN_EMAIL!;
    const password = process.env.TAH_ADMIN_PASSWORD!;
    await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
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

try {
  await ensureAdmin(page);
  const lock = assertVeroniTargetLock({
    hostname: new URL(page.url()).hostname,
    restaurantName: "Veroni Pizza",
  });
  blockWriteUnlessTargetLocked(lock);

  const products = await adapter.listProducts();
  const row = products.find((p) => p.databaseId === CANARY.databaseId);
  if (!row || row.name !== CANARY.name || row.menuNumber !== CANARY.menuNumber) {
    finish("BLOCKED", { reason: "identity", row }, 2);
  }
  if ((row.statusText || "").trim() !== "Skjult") {
    finish("BLOCKED", { reason: "not_skjult", status: row.statusText }, 2);
  }
  if (products.some((p) => p.databaseId !== CANARY.databaseId)) {
    finish("BLOCKED", { reason: "other_products" }, 2);
  }

  const probe = await adapter.probeContract();
  if (probe.status !== "CONTRACT_MATCH") {
    finish("BLOCKED", { reason: "contract", probe }, 2);
  }

  const beforeProduct = await adapter.readProduct(CANARY.databaseId);
  const before = toSnap(beforeProduct);
  if (before.description !== OLD_DESC) {
    finish(
      "BLOCKED",
      { reason: "BASELINE_CHANGED", description: before.description },
      2,
    );
  }
  writeFileSync(join(outDir, "before.json"), JSON.stringify(before, null, 2));

  const pub1 = await context.newPage();
  const publicBefore = await publicCheck(pub1);
  await pub1.close();
  if (publicBefore.visibleCanary || publicBefore.visibleMenuNumber) {
    finish("BLOCKED", { reason: "public_before", publicBefore }, 2);
  }

  const plan = createDescriptionUpdatePlan({
    databaseId: "18",
    expectedBeforeDescription: OLD_DESC,
    expectedAfterDescription: NEW_DESC,
    preserved: {
      menuNumber: before.menuNumber,
      name: before.name,
      basePriceRaw: before.basePriceRaw,
    },
  });
  writeFileSync(join(outDir, "plan.json"), JSON.stringify(plan, null, 2));

  await page.goto(
    `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/18/edit`,
    { waitUntil: "domcontentloaded" },
  );

  const formMeta = await page.evaluate(() => {
    const form = document.querySelector("form:has(#menu_number)");
    const btn = form?.querySelector('button[type="submit"]');
    return {
      action: form?.getAttribute("action") || null,
      method: form?.getAttribute("method") || null,
      methodOverride:
        (form?.querySelector('input[name="_method"]') as HTMLInputElement | null)
          ?.value || null,
      buttonText: (btn?.textContent || "").trim(),
      buttonType: btn?.getAttribute("type"),
      buttonInUpdateForm: Boolean(btn && form?.contains(btn)),
    };
  });
  if (
    !formMeta.buttonInUpdateForm ||
    !/^Opdater$/i.test(formMeta.buttonText || "") ||
    String(formMeta.methodOverride || "").toLowerCase() !== "put"
  ) {
    finish("BLOCKED", { reason: "update_form_identification", formMeta }, 2);
  }

  await page.locator("form:has(#menu_number) #description").fill(NEW_DESC);
  const active = page.locator("form:has(#menu_number) #active");
  if (await active.isChecked()) await active.uncheck();
  if (await active.isChecked()) {
    finish("BLOCKED", { reason: "active_checked" }, 2);
  }

  const { payload, mutationRequests } = await inspectFormSubmission(
    page,
    "form:has(#menu_number)",
  );
  if (mutationRequests.length) {
    finish("BLOCKED", { reason: "UNEXPECTED_MUTATION_REQUEST", mutationRequests }, 2);
  }
  const o = payload.asObject;
  if (
    String(o._method || "").toLowerCase() !== "put" ||
    (payload.action || "").replace(/\/$/, "") !== "/admin/menu/18" ||
    String(o.description) !== NEW_DESC ||
    String(o.name) !== CANARY.name ||
    String(o.menu_number) !== CANARY.menuNumber ||
    !assertPayloadHasNoActiveTrue(payload) ||
    "active" in o
  ) {
    finish("BLOCKED", { reason: "payload_gate", payload: o }, 2);
  }

  // ONE instrumented submit
  const observed = await clickOpdaterAndObserveUpdate({
    page,
    databaseId: "18",
    timeoutMs: 25_000,
  });

  if (!observed.ok) {
    const diagnose = await page.evaluate(() => {
      const form = document.querySelector(
        "form:has(#menu_number)",
      ) as HTMLFormElement | null;
      const btn = form?.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement | null;
      const desc = form?.querySelector(
        "#description",
      ) as HTMLTextAreaElement | null;
      return {
        buttonDisabled: btn?.disabled ?? null,
        buttonType: btn?.type ?? null,
        formCheckValidity: form?.checkValidity?.() ?? null,
        descValidationMessage: desc?.validationMessage || null,
        pageErrors: [
          ...document.querySelectorAll(".text-red-500, .text-red-600, .error, [role=alert]"),
        ]
          .map((el) => (el.textContent || "").trim())
          .filter(Boolean)
          .slice(0, 10),
      };
    });
    finish(
      "VERIFY_FAILED",
      {
        errorClassification: "UPDATE_REQUEST_NOT_SENT",
        formMeta,
        diagnose,
        certification: {
          updatePersistBoundary: "UNCERTIFIED",
          updateProductDescription: "UNCERTIFIED",
        },
      },
      3,
    );
  }

  await page.waitForTimeout(1500);
  const messages = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".text-red-500, .text-red-600, .error, [role=alert], .bg-red-100, .bg-green-100",
      ),
    ]
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 15),
  );

  if (observed.response.status >= 400 || messages.some((m) => /error|ugyldig|fejl/i.test(m))) {
    finish(
      "VERIFY_FAILED",
      {
        errorClassification: "ADMIN_VALIDATION_ERROR",
        request: observed.request,
        response: observed.response,
        messages,
      },
      3,
    );
  }

  const listAfter = await adapter.listProducts();
  const rowAfter = listAfter.find((p) => p.databaseId === "18");
  const afterProduct = await adapter.readProduct("18");
  const after = toSnap(afterProduct);
  writeFileSync(join(outDir, "after.json"), JSON.stringify(after, null, 2));

  const outcome = classifyUpdateOutcome({
    requestObserved: true,
    responseStatus: observed.response.status,
    descriptionExpected: NEW_DESC,
    descriptionActual: after.description,
    validationMessages: [],
  });

  const diffs = semanticDiff(before, after);
  const diffOk = assertExactlyAllowedSemanticDiff(diffs, ["description"]);

  if (outcome.code !== "OK" || !diffOk.ok) {
    finish(
      "VERIFY_FAILED",
      {
        errorClassification:
          outcome.code === "OK" ? "READBACK_MISMATCH" : outcome.code,
        request: observed.request,
        response: { ...observed.response, finalUrl: page.url() },
        messages,
        diffs,
        afterDescription: after.description,
        formMeta,
        certification: {
          updatePersistBoundary: "UNCERTIFIED",
          updateProductDescription: "UNCERTIFIED",
          updateExistingProductForm: "UNCERTIFIED",
        },
      },
      3,
    );
  }

  const listStatus = (rowAfter?.statusText || "").trim();
  if (listStatus !== "Skjult") {
    finish(
      "CRITICAL_SAFETY_FAILURE",
      { listStatus, request: observed.request },
      4,
    );
  }
  const pub2 = await context.newPage();
  const publicAfter = await publicCheck(pub2);
  await pub2.close();
  if (publicAfter.visibleCanary || publicAfter.visibleMenuNumber) {
    finish("CRITICAL_SAFETY_FAILURE", { publicAfter }, 5);
  }

  finish("VERIFIED", {
    targetLock: lock,
    beforeDescription: before.description,
    formMeta,
    zeroNetworkPayload: {
      action: payload.action,
      _method: o._method,
      description: o.description,
      activeOmitted: !("active" in o),
    },
    mutationRequestObserved: true,
    httpMethod: observed.request.method,
    httpPath: observed.request.path,
    sanitizedMethodPut: observed.request.hasMethodPut,
    descriptionInRequest: observed.request.descriptionInPayload,
    responseStatus: observed.response.status,
    redirectFinalUrl: page.url(),
    messages,
    afterDescription: after.description,
    semanticDiff: diffs,
    unauthorizedFieldChanges: [],
    listStatus,
    publicAfter,
    certification: {
      updatePersistBoundary: "CERTIFIED",
      updateProductDescription: "CERTIFIED",
      updateScalarProductField: "CERTIFIED",
      updateExistingProductForm: "CERTIFIED",
      updateProduct: "UNCERTIFIED",
      setProductHidden: "UNCERTIFIED",
      setProductAvailable: "UNCERTIFIED",
    },
  });
} finally {
  await browser.close();
}
