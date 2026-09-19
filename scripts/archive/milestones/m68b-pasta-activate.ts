/**
 * Activate Pasta #33–35 (database ids 22/23/24) via #active + Opdater.
 * Storefront read-back required. Does not certify setProductAvailable globally.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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

const TARGETS = [
  { databaseId: "22", menuNumber: "33", name: "Spaghetti Bolognese" },
  { databaseId: "23", menuNumber: "34", name: "Pasta Alfredo med Kylling" },
  { databaseId: "24", menuNumber: "35", name: "Pasta Ai Gamberi" },
] as const;

const outDir = join(root, "runs", "discovery", `m68b-pasta-activate-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function finish(status: string, body: Record<string, unknown>, code = 0): never {
  const report = { milestone: "M68B_PASTA_ACTIVATE", status, ...body };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(code);
}

async function ensureAdmin(page: Page) {
  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  if (/\/login/i.test(page.url())) {
    const email = process.env.TAH_ADMIN_EMAIL;
    const password = process.env.TAH_ADMIN_PASSWORD;
    if (!email || !password) {
      finish("BLOCKED", { reason: "missing_TAH_ADMIN_credentials" }, 1);
    }
    await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('input[type="email"]').first().fill(email!);
    await page.locator('input[type="password"]').first().fill(password!);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
  }
}

async function activateOne(
  page: Page,
  adapter: TahAdminAdapterV1,
  target: (typeof TARGETS)[number],
) {
  await page.goto(
    `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${target.databaseId}/edit`,
    { waitUntil: "domcontentloaded" },
  );
  await dismissKnownCookieBanner(page);

  const nameVal = await page.locator("form:has(#menu_number) #name").inputValue();
  if (nameVal.trim().toLowerCase() !== target.name.toLowerCase()) {
    throw new Error(
      `name mismatch for id ${target.databaseId}: got "${nameVal}" expected "${target.name}"`,
    );
  }

  const active = page.locator("form:has(#menu_number) #active");
  if (!(await active.count())) throw new Error("#active missing");
  if (!(await active.isChecked())) await active.check();
  if (!(await active.isChecked())) throw new Error("failed to check #active");

  const observed = await clickOpdaterAndObserveUpdate({
    page,
    databaseId: target.databaseId,
    timeoutMs: 25_000,
  });
  if (!observed.ok) {
    throw new Error(`${observed.code}${observed.detail ? `: ${observed.detail}` : ""}`);
  }
  if (observed.response.status >= 400) {
    throw new Error(`Opdater HTTP ${observed.response.status}`);
  }

  await page.waitForTimeout(1000);
  const listed = await adapter.listProducts();
  const row = listed.find((p) => p.databaseId === target.databaseId);
  const listStatus = (row?.statusText || "").trim();
  if (!row) throw new Error("product missing from list after Opdater");
  if (/skjult/i.test(listStatus)) {
    throw new Error(`still Skjult after activate: ${listStatus}`);
  }

  await page.goto(VERONI_CANARY_TARGET.baseUrl + "/", {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  const body = await page.locator("body").innerText();
  const publicVisible =
    body.includes(target.name) || body.includes(target.menuNumber);

  return {
    databaseId: target.databaseId,
    menuNumber: target.menuNumber,
    name: target.name,
    listStatus,
    publicVisible,
    observed: {
      status: observed.response.status,
      path: observed.request.path,
    },
  };
}

async function main() {
  const lock = assertVeroniTargetLock({
    hostname: VERONI_CANARY_TARGET.host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    url: VERONI_CANARY_TARGET.baseUrl,
  });
  blockWriteUnlessTargetLocked(lock);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await ensureAdmin(page);
    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
    });

    const results = [];
    for (const target of TARGETS) {
      results.push(await activateOne(page, adapter, target));
    }

    const allPublic = results.every((r) => r.publicVisible);
    const anyHidden = results.some((r) => /skjult/i.test(r.listStatus));
    finish(
      allPublic && !anyHidden ? "VERIFIED" : "PARTIAL",
      {
        results,
        notes: [
          "Customer Pasta #33–35 activated via #active + Opdater",
          "setProductAvailable remains UNCERTIFIED as a general capability",
        ],
      },
      allPublic && !anyHidden ? 0 : 1,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  finish(
    "FAILED",
    { reason: "uncaught", error: err instanceof Error ? err.message : String(err) },
    1,
  );
});
