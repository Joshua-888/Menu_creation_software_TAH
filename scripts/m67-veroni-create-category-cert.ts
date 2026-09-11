/**
 * M6.7 — Veroni createCategory canary certification.
 * Synthetic category only (__TAH_CANARY_CATEGORY_M67__). No Pasta. No products.
 * NO force-click. Target lock required.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { clickSkabAndObserveCategoryCreate } from "../src/tah/write/categoryCreateObserve.js";
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

const CANARY = CANARY_NAMES.categoryCreate;
const outDir = join(root, "runs", "discovery", `m67-category-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function finish(status: string, body: Record<string, unknown>, code = 0): never {
  const report = {
    milestone: "M67_CREATE_CATEGORY",
    status,
    capability: "createCategory",
    canaryName: CANARY,
    targetHost: VERONI_CANARY_TARGET.host,
    ...body,
  };
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
      "m67-create-category-evidence.json",
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  process.exit(code);
}

async function ensureAdmin(page: Page) {
  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/categories`, {
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

async function main() {
  const lock = assertVeroniTargetLock({
    hostname: new URL(VERONI_CANARY_TARGET.baseUrl).hostname,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    url: VERONI_CANARY_TARGET.baseUrl,
  });
  blockWriteUnlessTargetLocked(lock);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await ensureAdmin(page);
    await dismissKnownCookieBanner(page);

    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
    });

    const before = await adapter.listCategories();
    const preexisting = before.find(
      (c) => c.name.trim().toLowerCase() === CANARY.toLowerCase(),
    );
    if (preexisting) {
      finish("VERIFIED", {
        reason: "canary_already_present_from_prior_run",
        destinationId: preexisting.databaseId,
        categoriesBefore: before.length,
        requestObserved: false,
        readBack: true,
        evidenceLevel: "TESTED",
        createCategory: "CERTIFIED_CANDIDATE",
      });
    }

    await page.goto(
      `${VERONI_CANARY_TARGET.baseUrl}/admin/categories/create`,
      { waitUntil: "domcontentloaded" },
    );
    if (/404|not found/i.test(await page.locator("body").innerText())) {
      finish("FAILED", { reason: "category_create_route_404" }, 1);
    }

    const observed = await clickSkabAndObserveCategoryCreate({
      page,
      name: CANARY,
      order: 400,
    });
    if (!observed.ok) {
      finish(
        "FAILED",
        { reason: observed.code, detail: observed.detail ?? null },
        1,
      );
    }

    await page.waitForTimeout(1000);
    const after = await adapter.listCategories();
    const found = after.find(
      (c) => c.name.trim().toLowerCase() === CANARY.toLowerCase(),
    );
    if (!found?.databaseId) {
      finish(
        "FAILED",
        {
          reason: "read_back_missing_canary",
          request: observed.request,
          response: observed.response,
          categoriesAfter: after.map((c) => c.name),
        },
        1,
      );
    }

    finish("VERIFIED", {
      destinationId: found!.databaseId,
      editPath: found!.editPath,
      categoriesBefore: before.length,
      categoriesAfter: after.length,
      request: observed.request,
      response: observed.response,
      interactability: observed.interactability,
      readBack: true,
      evidenceLevel: "TESTED",
      createCategory: "CERTIFIED_CANDIDATE",
      notes: [
        "Synthetic canary only — customer Pasta create is a separate gated call site",
        "POST /admin/categories observed; listCategories read-back found canary",
      ],
    });
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
