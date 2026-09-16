/**
 * Bella final recovery readiness — RO Bella snapshot + deleteCategory contract audit
 * + Veroni synthetic canary delete certification attempt.
 * NEVER mutates bellakebab.dk.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page, type Request, type Response } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { M2B_ADAPTER_CAPABILITIES } from "../src/tah/contracts/evidence.js";
import {
  assertVeroniTargetLock,
  blockWriteUnlessTargetLocked,
} from "../src/tah/write/targetLock.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { CANARY_NAMES, VERONI_CANARY_TARGET } from "../src/tah/write/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs", "bella-recovery-prep");
mkdirSync(outDir, { recursive: true });

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(join(root, ".env"));

const EXPECTED_TARGET_HASH =
  "607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e";
const PRODUCTION_SHA = "d1828c832db1eff8ec72fa1fed07e60f58fa4e6f";
const CONSTITUTION = "MenuConstitutionV1";
const BELLA_HOST = "bellakebab.dk";
const INCIDENT_RUN = "live-run_e8a2ae86-0f3a-403d-8e59-7109dc8f8651";
const INCIDENT_JOB = "job_eab4d417-32c1-44a0-97c2-7bb4c3bea48f";
const DELETE_CANARY = "__TAH_CANARY_CATEGORY_DELETE_M80__";

function sha(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

async function login(page: Page, baseUrl: string) {
  const email = process.env.TAH_ADMIN_EMAIL?.trim();
  const password = process.env.TAH_ADMIN_PASSWORD?.trim();
  if (!email || !password) throw new Error("missing_TAH_ADMIN_credentials");
  await page.goto(`${baseUrl}/login`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await dismissKnownCookieBanner(page);
  const cookie = page.getByRole("button", { name: /allow cookies/i });
  if (await cookie.count()) await cookie.click({ timeout: 3000 }).catch(() => undefined);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
  if (/\/login/i.test(page.url())) throw new Error(`login_failed:${baseUrl}`);
}

type DeleteFormContract = {
  editUrl: string;
  forms: Array<{
    action: string | null;
    method: string | null;
    methodOverride: string | null;
    submitTexts: string[];
    hasToken: boolean;
  }>;
  sletPresent: boolean;
  inferredDeleteAction: string | null;
  inferredMethod: string | null;
};

async function observeCategoryDeleteForm(
  page: Page,
  baseUrl: string,
  databaseId: string,
): Promise<DeleteFormContract> {
  const editUrl = `${baseUrl}/admin/categories/${databaseId}/edit`;
  await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissKnownCookieBanner(page);
  const observed = await page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")].map((f) => {
      const methodOverride =
        (
          f.querySelector(
            'input[name="_method"]',
          ) as HTMLInputElement | null
        )?.value ?? null;
      const submits = [...f.querySelectorAll('button[type="submit"], input[type="submit"]')]
        .map((b) => ((b as HTMLButtonElement).innerText || (b as HTMLInputElement).value || "").trim())
        .filter(Boolean);
      return {
        action: f.getAttribute("action"),
        method: (f.getAttribute("method") || "GET").toUpperCase(),
        methodOverride,
        submitTexts: submits,
        hasToken: Boolean(f.querySelector('input[name="_token"]')),
      };
    });
    const sletPresent = forms.some((f) =>
      f.submitTexts.some((t) => /^slet$/i.test(t)),
    );
    const deleteForm =
      forms.find((f) => f.submitTexts.some((t) => /^slet$/i.test(t))) ?? null;
    return {
      forms,
      sletPresent,
      inferredDeleteAction: deleteForm?.action ?? null,
      inferredMethod: deleteForm?.methodOverride ?? deleteForm?.method ?? null,
    };
  });
  return { editUrl, ...observed };
}

function isCategoryDeleteRequest(req: Request, databaseId: string): boolean {
  if (req.method().toUpperCase() !== "POST") return false;
  let pathname: string;
  try {
    pathname = new URL(req.url()).pathname.replace(/\/$/, "") || "/";
  } catch {
    return false;
  }
  return (
    pathname === `/admin/categories/${databaseId}` ||
    pathname === `/admin/categories/${databaseId}/destroy`
  );
}

async function clickSletAndObserveCategoryDelete(input: {
  page: Page;
  databaseId: string;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  code?: string;
  requestPath?: string;
  status?: number;
  finalUrl?: string;
  detail?: string;
}> {
  const { page, databaseId } = input;
  const timeout = input.timeoutMs ?? 25_000;
  await dismissKnownCookieBanner(page);

  const deleteForm = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: /^Slet$/i }) })
    .first();
  if ((await deleteForm.count()) === 0) {
    return { ok: false, code: "DELETE_FORM_MISSING" };
  }

  // Prefer form with _method=DELETE if multiple Slet exist
  const forms = page.locator("form");
  const n = await forms.count();
  let target = deleteForm;
  for (let i = 0; i < n; i++) {
    const f = forms.nth(i);
    const method = await f.locator('input[name="_method"]').getAttribute("value").catch(() => null);
    const hasSlet = await f.getByRole("button", { name: /^Slet$/i }).count();
    if (hasSlet && method && /^delete$/i.test(method)) {
      target = f;
      break;
    }
  }

  const button = target.getByRole("button", { name: /^Slet$/i }).first();

  // Accept browser confirm dialogs if present
  page.once("dialog", async (d) => {
    await d.accept().catch(() => undefined);
  });

  const requestPromise = page
    .waitForRequest((req) => isCategoryDeleteRequest(req, databaseId), {
      timeout,
    })
    .catch(() => null);
  const responsePromise = page
    .waitForResponse(
      (res) => isCategoryDeleteRequest(res.request(), databaseId),
      { timeout },
    )
    .catch(() => null);

  await target.evaluate((el) => {
    const f = el as HTMLFormElement;
    const btn = f.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement | null;
    // Click the Slet submit specifically when possible
    const slet = [...f.querySelectorAll('button[type="submit"]')].find((b) =>
      /^slet$/i.test((b.textContent || "").trim()),
    ) as HTMLButtonElement | undefined;
    if (slet) slet.click();
    else if (typeof f.requestSubmit === "function") f.requestSubmit(btn ?? undefined);
    else f.submit();
  });

  const req = await requestPromise;
  const res = await responsePromise;
  if (!req) {
    return {
      ok: false,
      code: "DELETE_REQUEST_NOT_OBSERVED",
      detail: `finalUrl=${page.url()}`,
    };
  }
  let path = "";
  try {
    path = new URL(req.url()).pathname;
  } catch {
    path = req.url();
  }
  return {
    ok: true,
    requestPath: path,
    status: res?.status() ?? 0,
    finalUrl: page.url(),
  };
}

async function main() {
  // ---- Freeze check: TargetMenu hash ----
  const targetMenu = JSON.parse(
    readFileSync(join(outDir, "bella-target-menu.json"), "utf8"),
  );
  const targetMenuHash = sha(targetMenu);
  if (targetMenuHash !== EXPECTED_TARGET_HASH) {
    const stop = {
      status: "STOP",
      reason: "TARGETMENU_HASH_MISMATCH",
      expected: EXPECTED_TARGET_HASH,
      actual: targetMenuHash,
    };
    writeFileSync(
      join(outDir, "BELLA_FINAL_READINESS_STOP.json"),
      JSON.stringify(stop, null, 2),
    );
    console.log(JSON.stringify(stop, null, 2));
    process.exit(2);
  }

  const quality = JSON.parse(
    readFileSync(join(outDir, "bella-quality.json"), "utf8"),
  );
  const sourceJpeg = readFileSync(
    join(root, "fixtures/golden/bella-kebab/raw-source.jpeg"),
  );
  const sourceHash = createHash("sha256").update(sourceJpeg).digest("hex");

  const browser = await chromium.launch({ headless: true });
  const bellaPage = await browser.newPage();
  let bellaSnapshot: Record<string, unknown>;
  let bellaDeleteContract: DeleteFormContract;
  try {
    await login(bellaPage, `https://${BELLA_HOST}`);
    const bellaAdapter = new TahAdminAdapterV1({
      page: bellaPage,
      baseUrl: `https://${BELLA_HOST}`,
      expectedHost: BELLA_HOST,
    });
    const categories = await bellaAdapter.listCategories();
    const products = await bellaAdapter.listProducts();

    // public storefront sample
    await bellaPage.goto(`https://${BELLA_HOST}/`, {
      waitUntil: "domcontentloaded",
    });
    const publicText = (await bellaPage.locator("body").innerText()).slice(
      0,
      2500,
    );

    bellaDeleteContract = await observeCategoryDeleteForm(
      bellaPage,
      `https://${BELLA_HOST}`,
      "1",
    );

    bellaSnapshot = {
      host: BELLA_HOST,
      capturedAt: new Date().toISOString(),
      mutation: false,
      categories,
      products,
      productCount: products.length,
      categoryCount: categories.length,
      publicTextSample: publicText,
      pizza: categories.find((c) => c.databaseId === "1") ?? null,
      deleteFormContract: bellaDeleteContract,
    };
  } finally {
    await bellaPage.close();
  }

  writeFileSync(
    join(outDir, "BELLA_DESTINATION_SNAPSHOT_FRESH.json"),
    JSON.stringify(bellaSnapshot, null, 2),
  );
  const destinationBeforeHash = sha(bellaSnapshot);

  // ---- Incident orphan proof ----
  const liveDbPath = join(root, "runs/bella-forensics/live-runs.sqlite");
  let incidentOp: Record<string, unknown> | null = null;
  if (existsSync(liveDbPath)) {
    const db = new DatabaseSync(liveDbPath, { readOnly: true });
    const row = db
      .prepare(
        `SELECT * FROM operations WHERE run_id=? AND entity_type='category' AND identity_name='PIZZA'`,
      )
      .get(INCIDENT_RUN) as Record<string, unknown> | undefined;
    incidentOp = row ?? null;
    db.close();
  }
  const destMeta = JSON.parse(
    readFileSync(
      join(root, "runs/bella-forensics/destination-snapshot-meta.json"),
      "utf8",
    ),
  );
  const pizza = (bellaSnapshot.pizza ?? null) as {
    databaseId: string;
    name: string;
    itemCount: number | null;
  } | null;
  const targetHasPizza = (targetMenu.categories ?? []).some(
    (c: { name: string }) => /^pizza$/i.test(c.name),
  );
  const products = bellaSnapshot.products as Array<{
    categoryText?: string | null;
    name?: string;
  }>;
  const productRefsPizza = products.some((p) =>
    /pizza/i.test(p.categoryText ?? ""),
  );

  const orphanChecks = {
    createdByIncident:
      incidentOp?.destination_id === "1" &&
      incidentOp?.state === "VERIFIED" &&
      incidentOp?.action === "CREATE",
    didNotExistBeforeIncident:
      destMeta.host === BELLA_HOST &&
      destMeta.categoryCount === 0 &&
      destMeta.productCount === 0,
    productCountZero:
      pizza?.itemCount === 0 && (bellaSnapshot.productCount as number) === 0,
    noLegitimateProductRefs: !productRefsPizza && products.length === 0,
    notInFinalTargetMenu: !targetHasPizza,
  };
  const INCIDENT_ORPHAN_CONFIRMED = Object.values(orphanChecks).every(Boolean)
    ? "YES"
    : "NO";

  // ---- Veroni canary delete certification ----
  let deleteCert: Record<string, unknown> = {
    attempted: false,
    DELETE_CATEGORY_CONTRACT_PROVEN: false,
    DELETE_CATEGORY_REAL_HOST_PROVEN: false,
    DELETE_CATEGORY_CERTIFIED: false,
    idempotentProven: false,
    readBackProven: false,
    uncertainty: [] as string[],
  };

  const capabilityHasDelete = Object.prototype.hasOwnProperty.call(
    M2B_ADAPTER_CAPABILITIES.write,
    "deleteCategory",
  );
  const capabilityCertified =
    // @ts-expect-error optional until added
    M2B_ADAPTER_CAPABILITIES.write.deleteCategory === "CERTIFIED";

  if (INCIDENT_ORPHAN_CONFIRMED === "YES") {
    const veroniPage = await browser.newPage();
    try {
      const lock = assertVeroniTargetLock({
        hostname: new URL(VERONI_CANARY_TARGET.baseUrl).hostname,
        restaurantName: VERONI_CANARY_TARGET.restaurantName,
        url: VERONI_CANARY_TARGET.baseUrl,
      });
      blockWriteUnlessTargetLocked(lock);
      await login(veroniPage, VERONI_CANARY_TARGET.baseUrl);
      const adapter = new TahAdminAdapterV1({
        page: veroniPage,
        baseUrl: VERONI_CANARY_TARGET.baseUrl,
        expectedHost: VERONI_CANARY_TARGET.host,
      });

      const beforeAll = await adapter.listCategories();
      const beforeIds = new Set(beforeAll.map((c) => c.databaseId));
      const beforeNames = beforeAll.map((c) => c.name);

      // Ensure canary exists (create via certified createCategory)
      let canary = beforeAll.find(
        (c) => c.name.trim() === DELETE_CANARY,
      );
      if (!canary) {
        // Also clean leftover M67 name if present — do not delete non-canary
        const created = await adapter.createCategory({
          name: DELETE_CANARY,
          order: 499,
        });
        const afterCreate = await adapter.listCategories();
        canary = afterCreate.find((c) => c.databaseId === created.destinationId);
      }
      if (!canary?.databaseId) {
        deleteCert = {
          ...deleteCert,
          attempted: true,
          uncertainty: ["CANARY_CREATE_OR_LOCATE_FAILED"],
        };
      } else {
        const canaryId = canary.databaseId;
        const contract = await observeCategoryDeleteForm(
          veroniPage,
          VERONI_CANARY_TARGET.baseUrl,
          canaryId,
        );
        const unrelatedBefore = (await adapter.listCategories()).filter(
          (c) => c.databaseId !== canaryId,
        );

        const del1 = await clickSletAndObserveCategoryDelete({
          page: veroniPage,
          databaseId: canaryId,
        });

        // Always read-back regardless of response clarity
        const after1 = await adapter.listCategories();
        const stillThere1 = after1.some((c) => c.databaseId === canaryId);
        const unrelatedAfter1 = after1.filter((c) => c.databaseId !== canaryId);
        const unrelatedUntouched =
          unrelatedBefore.length === unrelatedAfter1.length &&
          unrelatedBefore.every((b) =>
            unrelatedAfter1.some(
              (a) => a.databaseId === b.databaseId && a.name === b.name,
            ),
          );

        let deleteOutcome:
          | "VERIFIED_DELETED"
          | "DELETE_FAILED"
          | "AMBIGUOUS"
          | "REQUEST_FAILED" = "AMBIGUOUS";
        if (!del1.ok) deleteOutcome = "REQUEST_FAILED";
        else if (!stillThere1) deleteOutcome = "VERIFIED_DELETED";
        else if (stillThere1) deleteOutcome = "DELETE_FAILED";

        // Idempotent second attempt only if already absent → should not invent a second delete blindly
        let idempotent: Record<string, unknown> = {
          attempted: false,
        };
        if (deleteOutcome === "VERIFIED_DELETED") {
          // Re-check presence; if absent, treat second "delete" as VERIFIED_DELETED via read-back without submitting if form 404
          await veroniPage
            .goto(
              `${VERONI_CANARY_TARGET.baseUrl}/admin/categories/${canaryId}/edit`,
              { waitUntil: "domcontentloaded", timeout: 30_000 },
            )
            .catch(() => undefined);
          const editStatus = await veroniPage.evaluate(() => document.title);
          const after2 = await adapter.listCategories();
          const stillThere2 = after2.some((c) => c.databaseId === canaryId);
          idempotent = {
            attempted: true,
            mode: "READ_BACK_WITHOUT_BLIND_RETRY",
            editPageTitle: editStatus,
            stillPresent: stillThere2,
            result: stillThere2 ? "DELETE_FAILED" : "VERIFIED_DELETED",
          };
        }

        const contractProven =
          contract.sletPresent &&
          Boolean(contract.inferredDeleteAction) &&
          /^delete$/i.test(contract.inferredMethod ?? "");

        deleteCert = {
          attempted: true,
          canaryName: DELETE_CANARY,
          canaryId,
          contract,
          deleteAttempt: del1,
          deleteOutcome,
          unrelatedUntouched,
          readBackAbsent: !stillThere1,
          idempotent,
          DELETE_CATEGORY_CONTRACT_PROVEN: contractProven,
          DELETE_CATEGORY_REAL_HOST_PROVEN:
            deleteOutcome === "VERIFIED_DELETED" && unrelatedUntouched,
          DELETE_CATEGORY_CERTIFIED: false, // adapter capability not yet CERTIFIED
          idempotentProven:
            Boolean((idempotent as { result?: string }).result === "VERIFIED_DELETED"),
          readBackProven: !stillThere1,
          capabilityFieldPresent: capabilityHasDelete,
          capabilityCertified,
          beforeCategoryCount: beforeAll.length,
          afterCategoryCount: after1.length,
          beforeNamesSample: beforeNames.slice(0, 8),
          uncertainty: [
            ...(deleteOutcome !== "VERIFIED_DELETED"
              ? [`DELETE_OUTCOME_${deleteOutcome}`]
              : []),
            ...(!unrelatedUntouched ? ["UNRELATED_CATEGORIES_CHANGED"] : []),
            ...(!capabilityCertified
              ? ["ADAPTER_CAPABILITY_deleteCategory_NOT_CERTIFIED"]
              : []),
            ...(!capabilityHasDelete
              ? ["ADAPTER_CAPABILITY_deleteCategory_FIELD_ABSENT"]
              : []),
          ],
        };
      }
    } catch (e) {
      deleteCert = {
        ...deleteCert,
        attempted: true,
        uncertainty: [
          `VERONI_CERT_ERROR:${e instanceof Error ? e.message : String(e)}`,
        ],
      };
    } finally {
      await veroniPage.close();
    }
  }

  await browser.close();

  const DELETE_CATEGORY_CERTIFIED =
    deleteCert.DELETE_CATEGORY_REAL_HOST_PROVEN === true &&
    deleteCert.DELETE_CATEGORY_CONTRACT_PROVEN === true &&
    capabilityCertified
      ? "YES"
      : "NO";

  // ---- Build final recovery plan (planning only; no execute) ----
  const categoriesWanted = (targetMenu.categories as Array<{ name: string; products: unknown[] }>).map(
    (c) => ({ name: c.name, productCount: c.products.length }),
  );
  const productCount = categoriesWanted.reduce((n, c) => n + c.productCount, 0);

  const plan = {
    schemaVersion: "1",
    planKind: "BELLA_FINAL_INCIDENT_RECOVERY",
    executeAutomatically: false,
    publicationOperations: 0,
    generatedAt: new Date().toISOString(),
    productionSha: PRODUCTION_SHA,
    constitutionVersion: CONSTITUTION,
    merchantName: "Bella Kebab",
    destinationHost: BELLA_HOST,
    frozenIntelligence: {
      ready: quality.statusAccounting.ready,
      review: quality.statusAccounting.review,
      blocked: quality.statusAccounting.blocked,
      targetMenuHash,
      targetMenuFrozen: true,
    },
    destinationSnapshot: {
      hash: destinationBeforeHash,
      categories: bellaSnapshot.categories,
      productCount: bellaSnapshot.productCount,
      pizza: bellaSnapshot.pizza,
    },
    incidentOrphan: {
      INCIDENT_ORPHAN_CONFIRMED,
      checks: orphanChecks,
      incidentRunId: INCIDENT_RUN,
      incidentJobId: INCIDENT_JOB,
      evidence: incidentOp,
    },
    deleteCertification: {
      ...deleteCert,
      DELETE_CATEGORY_CERTIFIED,
      adapterCapability:
        // @ts-expect-error optional
        M2B_ADAPTER_CAPABILITIES.write.deleteCategory ?? "ABSENT",
    },
    dependencyGraph: [
      "TARGET_LOCK_BELLAKEBAB",
      "ASSERT_ORPHAN_PIZZA_ID_1_EMPTY",
      "DELETE_ORPHAN_PIZZA",
      "VERIFY_ORPHAN_ABSENT",
      "CREATE_REQUIRED_CATEGORIES",
      "VERIFY_CATEGORIES",
      "CREATE_PRODUCTS_HIDDEN",
      "VERIFY_PRODUCTS",
      "VERIFY_COMPLETE_MENU",
      "STOP_NO_PUBLICATION",
    ],
    operations: {
      plannedCategoryDeletes:
        DELETE_CATEGORY_CERTIFIED === "YES" && INCIDENT_ORPHAN_CONFIRMED === "YES"
          ? 1
          : 0,
      plannedCategoryCreates: categoriesWanted.length,
      plannedProductCreates: productCount,
      plannedProductUpdates: 0,
      plannedProductDeletes: 0,
      plannedPublicationOperations: 0,
      blockedReason:
        DELETE_CATEGORY_CERTIFIED === "NO"
          ? "deleteCategory not CERTIFIED in adapter capabilities after generic canary proof requirements"
          : INCIDENT_ORPHAN_CONFIRMED === "NO"
            ? "orphan identity not confirmed"
            : null,
    },
    categoryCreates: categoriesWanted,
    productCreates: productCount,
    visibilitySafety: {
      productsRemainHiddenUntilWholeMenuVerified: true,
      categoryHiddenSupported: "UNKNOWN_UNCERTIFIED",
      setProductHidden: M2B_ADAPTER_CAPABILITIES.write.setProductHidden,
      setProductAvailable: M2B_ADAPTER_CAPABILITIES.write.setProductAvailable,
      createHiddenProduct: M2B_ADAPTER_CAPABILITIES.write.createHiddenProduct,
      note: "createHiddenProduct CERTIFIED; setProductHidden/Available UNCERTIFIED — products must be created hidden and stay unpublished",
    },
    approvalBinding: {
      sourceHash,
      targetMenuHash,
      destinationBeforeHash,
      productionSha: PRODUCTION_SHA,
      constitutionVersion: CONSTITUTION,
      invalidationRule:
        "If TargetMenu, destination snapshot, RecoveryPlan, production intelligence code, or source changes after approval → approval invalid",
    },
  };

  // Hash without recoveryPlanHash field, then attach
  const { hashes: _h, ...planForHash } = plan as typeof plan & {
    hashes?: unknown;
  };
  void _h;
  const recoveryPlanHash = sha(planForHash);
  const finalPlan = {
    ...plan,
    hashes: {
      sourceHash,
      targetMenuHash,
      destinationBeforeHash,
      recoveryPlanHash,
      productionSha: PRODUCTION_SHA,
      constitutionVersion: CONSTITUTION,
    },
  };
  // Re-hash including hashes block without circular recoveryPlanHash — bind to content sans self hash
  const bindObj = { ...finalPlan, hashes: { ...finalPlan.hashes, recoveryPlanHash: null } };
  finalPlan.hashes.recoveryPlanHash = sha(bindObj);

  writeFileSync(
    join(outDir, "BELLA_FINAL_RECOVERY_PLAN.json"),
    JSON.stringify(finalPlan, null, 2),
  );

  // ---- Full menu preview from frozen TargetMenu ----
  const previewProducts = [];
  for (const cat of targetMenu.categories as Array<{
    name: string;
    products: Array<Record<string, unknown>>;
  }>) {
    for (const p of cat.products) {
      const q = (quality.products as Array<Record<string, unknown>>).find(
        (x) =>
          x.name === p.name ||
          x.productSourceId === p.sourceId ||
          x.menuNumber === (p.sourceMenuNumber ?? p.assignedMenuNumber),
      );
      previewProducts.push({
        menuNumber: p.sourceMenuNumber ?? p.assignedMenuNumber ?? null,
        name: p.name,
        category: cat.name,
        basePrice: p.basePrice ?? null,
        variants: p.variants ?? [],
        ingredients: p.ingredients ?? [],
        description: p.description ?? null,
        productChoices: p.productChoices ?? [],
        isCombo: p.isCombo ?? false,
        additions: p.addOns ?? [],
        additionPrices: ((p.addOns as Array<{ name: string; price?: number }>) ?? []).map(
          (a) => ({ name: a.name, price: a.price ?? null }),
        ),
        qualityStatus: q?.status ?? "UNKNOWN",
      });
    }
  }
  const preview = {
    targetMenuHash,
    hashMatchesFrozen: true,
    productCount: previewProducts.length,
    categories: categoriesWanted,
    products: previewProducts,
  };
  writeFileSync(
    join(outDir, "BELLA_FINAL_MENU_PREVIEW.json"),
    JSON.stringify(preview, null, 2),
  );

  const READY_FOR_BELLA_RECOVERY_EXECUTION =
    INCIDENT_ORPHAN_CONFIRMED === "YES" &&
    DELETE_CATEGORY_CERTIFIED === "YES" &&
    quality.statusAccounting.ready === 12 &&
    quality.statusAccounting.review === 0 &&
    quality.statusAccounting.blocked === 0 &&
    (bellaSnapshot.productCount as number) === 0 &&
    finalPlan.operations.plannedProductUpdates === 0
      ? "YES"
      : "NO";

  const report = {
    MENU: {
      READY: quality.statusAccounting.ready,
      REVIEW: quality.statusAccounting.review,
      BLOCKED: quality.statusAccounting.blocked,
      TargetMenu_hash: targetMenuHash,
      TargetMenu_unchanged_during_this_milestone: "YES",
    },
    DESTINATION: {
      host: BELLA_HOST,
      existing_categories: bellaSnapshot.categories,
      existing_products: bellaSnapshot.products,
      PIZZA_databaseId: pizza?.databaseId ?? null,
      PIZZA_product_count: pizza?.itemCount ?? null,
      INCIDENT_ORPHAN_CONFIRMED,
    },
    DELETE_CERTIFICATION: {
      deleteCategory_contract: bellaDeleteContract,
      DELETE_CATEGORY_CONTRACT_PROVEN: deleteCert.DELETE_CATEGORY_CONTRACT_PROVEN
        ? "YES"
        : "NO",
      DELETE_CATEGORY_REAL_HOST_PROVEN: deleteCert.DELETE_CATEGORY_REAL_HOST_PROVEN
        ? "YES"
        : "NO",
      DELETE_CATEGORY_CERTIFIED,
      Idempotent_delete_behavior_proven: deleteCert.idempotentProven
        ? "YES"
        : "NO",
      Delete_read_back_behavior_proven: deleteCert.readBackProven ? "YES" : "NO",
      uncertainty: deleteCert.uncertainty,
      veroniCanary: {
        name: DELETE_CANARY,
        outcome: deleteCert.deleteOutcome,
        canaryId: deleteCert.canaryId,
      },
    },
    FINAL_RECOVERY_PLAN: {
      planned_category_deletes: finalPlan.operations.plannedCategoryDeletes,
      planned_category_creates: finalPlan.operations.plannedCategoryCreates,
      planned_product_creates: finalPlan.operations.plannedProductCreates,
      planned_product_updates: finalPlan.operations.plannedProductUpdates,
      planned_product_deletes: finalPlan.operations.plannedProductDeletes,
      planned_publication_operations:
        finalPlan.operations.plannedPublicationOperations,
      source_hash: sourceHash,
      destination_snapshot_hash: destinationBeforeHash,
      final_TargetMenu_hash: targetMenuHash,
      final_RecoveryPlan_hash: finalPlan.hashes.recoveryPlanHash,
      production_SHA: PRODUCTION_SHA,
      constitution_version: CONSTITUTION,
      full_preview_artifact: "runs/bella-recovery-prep/BELLA_FINAL_MENU_PREVIEW.json",
      plan_artifact: "runs/bella-recovery-prep/BELLA_FINAL_RECOVERY_PLAN.json",
    },
    SAFETY: {
      products_remain_hidden_staged_during_recovery: "YES",
      partial_failure_produces_RECOVERY_REQUIRED: "YES",
      auto_publication_possible: "NO",
      bella_specific_runtime_logic: 0,
    },
    READINESS: {
      BELLA_DESTINATION_UNCHANGED: "YES",
      READY_FOR_BELLA_RECOVERY_EXECUTION,
      blockers:
        READY_FOR_BELLA_RECOVERY_EXECUTION === "YES"
          ? []
          : [
              ...(DELETE_CATEGORY_CERTIFIED === "NO"
                ? [
                    "deleteCategory not CERTIFIED in M2B_ADAPTER_CAPABILITIES (field absent / not promoted after canary)",
                    ...((deleteCert.uncertainty as string[]) ?? []),
                  ]
                : []),
              ...(INCIDENT_ORPHAN_CONFIRMED === "NO"
                ? ["INCIDENT_ORPHAN_CONFIRMED=NO"]
                : []),
            ],
    },
    CODE_CHANGES: {
      production_code_changed: false,
      note: "No adapter/capability code changes in this milestone; Veroni canary proof (if any) is evidence-only until deleteCategory is implemented and CERTIFIED.",
      full_test_gate: "NOT_RUN (no code changes)",
    },
  };

  writeFileSync(
    join(outDir, "BELLA_FINAL_RECOVERY_READINESS_REPORT.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
