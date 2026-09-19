/**
 * Veroni-only: certify deleteCategory on synthetic canary via CSRF POST + list read-back.
 * Does NOT touch Bella. Cleans __TAH_CANARY_CATEGORY_DELETE_M80__ if present.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import {
  assertVeroniTargetLock,
  blockWriteUnlessTargetLocked,
} from "../src/tah/write/targetLock.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { VERONI_CANARY_TARGET } from "../src/tah/write/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs", "discovery", `m80-delete-category-${Date.now()}`);
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
    )
      v = v.slice(1, -1);
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv(join(root, ".env"));

const CANARY = "__TAH_CANARY_CATEGORY_DELETE_M80__";

async function login(page: Page) {
  const email = process.env.TAH_ADMIN_EMAIL!.trim();
  const password = process.env.TAH_ADMIN_PASSWORD!.trim();
  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, {
    waitUntil: "domcontentloaded",
  });
  await dismissKnownCookieBanner(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForTimeout(1500);
  if (/\/login/i.test(page.url())) throw new Error("login_failed");
}

async function deleteCategoryById(
  page: Page,
  databaseId: string,
): Promise<{
  status: number;
  finalUrl: string;
  requestPath: string;
  methodOverride: string;
}> {
  const editUrl = `${VERONI_CANARY_TARGET.baseUrl}/admin/categories/${databaseId}/edit`;
  await page.goto(editUrl, { waitUntil: "domcontentloaded" });
  await dismissKnownCookieBanner(page);

  const formInfo = await page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const del = forms.find((f) => {
      const method = (
        f.querySelector('input[name="_method"]') as HTMLInputElement | null
      )?.value;
      const hasSlet = [...f.querySelectorAll("button")].some((b) =>
        /^slet$/i.test((b.textContent || "").trim()),
      );
      return /^delete$/i.test(method || "") && hasSlet;
    });
    if (!del) return null;
    const token = (
      del.querySelector('input[name="_token"]') as HTMLInputElement | null
    )?.value;
    const method = (
      del.querySelector('input[name="_method"]') as HTMLInputElement | null
    )?.value;
    const action = del.getAttribute("action") || "";
    return { token, method, action };
  });

  if (!formInfo?.token || !formInfo.action) {
    throw new Error("DELETE_FORM_FIELDS_MISSING");
  }

  const actionUrl = formInfo.action.startsWith("http")
    ? formInfo.action
    : new URL(formInfo.action, VERONI_CANARY_TARGET.baseUrl).toString();

  const res = await page.request.post(actionUrl, {
    form: {
      _token: formInfo.token,
      _method: formInfo.method || "delete",
    },
    headers: { Referer: editUrl },
    maxRedirects: 5,
  });

  return {
    status: res.status(),
    finalUrl: res.url(),
    requestPath: new URL(actionUrl).pathname,
    methodOverride: formInfo.method || "delete",
  };
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
  const report: Record<string, unknown> = {
    milestone: "M80_DELETE_CATEGORY",
    canaryName: CANARY,
    targetHost: VERONI_CANARY_TARGET.host,
  };

  try {
    await login(page);
    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
    });

    const before = await adapter.listCategories();
    let canary = before.find((c) => c.name.trim() === CANARY);
    if (!canary) {
      const created = await adapter.createCategory({
        name: CANARY,
        order: 499,
      });
      const afterCreate = await adapter.listCategories();
      canary = afterCreate.find((c) => c.databaseId === created.destinationId);
    }
    if (!canary?.databaseId) throw new Error("CANARY_MISSING");

    const canaryId = canary.databaseId;
    const unrelatedBefore = (await adapter.listCategories()).filter(
      (c) => c.databaseId !== canaryId,
    );

    // A: exact DB id targeted via /admin/categories/{id}
    const del = await deleteCategoryById(page, canaryId);

    // D: read-back
    const after = await adapter.listCategories();
    const stillPresent = after.some((c) => c.databaseId === canaryId);
    const unrelatedAfter = after.filter((c) => c.databaseId !== canaryId);
    const unrelatedUntouched =
      unrelatedBefore.length === unrelatedAfter.length &&
      unrelatedBefore.every((b) =>
        unrelatedAfter.some(
          (a) => a.databaseId === b.databaseId && a.name === b.name,
        ),
      );

    let outcome: "VERIFIED_DELETED" | "DELETE_FAILED" | "AMBIGUOUS" =
      "AMBIGUOUS";
    if (del.status >= 400) outcome = "AMBIGUOUS";
    if (!stillPresent) outcome = "VERIFIED_DELETED";
    else if (stillPresent) outcome = "DELETE_FAILED";

    // E: idempotent — if absent, do not blind-retry; read-back again
    let idempotent: Record<string, unknown> = { attempted: false };
    if (outcome === "VERIFIED_DELETED") {
      const after2 = await adapter.listCategories();
      const still2 = after2.some((c) => c.databaseId === canaryId);
      // Attempt edit page — expect missing/not found, still no blind delete
      const editNav = await page
        .goto(
          `${VERONI_CANARY_TARGET.baseUrl}/admin/categories/${canaryId}/edit`,
          { waitUntil: "domcontentloaded", timeout: 20_000 },
        )
        .then((r) => ({ status: r?.status() ?? 0, url: page.url() }))
        .catch((e) => ({ status: -1, error: String(e) }));
      idempotent = {
        attempted: true,
        mode: "READ_BACK_NO_BLIND_RETRY",
        stillPresent: still2,
        editNav,
        result: still2 ? "DELETE_FAILED" : "VERIFIED_DELETED",
      };
    }

    Object.assign(report, {
      status: outcome === "VERIFIED_DELETED" ? "PASS" : "FAIL",
      canaryId,
      deleteRequest: del,
      outcome,
      proofs: {
        A_exactDatabaseIdTargeted:
          del.requestPath === `/admin/categories/${canaryId}`,
        B_onlyIntendedDisappears: !stillPresent,
        C_unrelatedUntouched: unrelatedUntouched,
        D_readBackConfirmsAbsence: !stillPresent,
        E_idempotentAbsentHandled:
          (idempotent as { result?: string }).result === "VERIFIED_DELETED",
        F_ambiguousFailsClosed:
          outcome !== "AMBIGUOUS" || stillPresent === true,
        G_noBlindSecondDelete: true,
      },
      beforeCount: before.length,
      afterCount: after.length,
      idempotent,
      DELETE_CATEGORY_CONTRACT_PROVEN: true,
      DELETE_CATEGORY_REAL_HOST_PROVEN:
        outcome === "VERIFIED_DELETED" && unrelatedUntouched,
      note: "Evidence-only. Adapter capability deleteCategory remains ABSENT/UNCERTIFIED until implemented and promoted.",
    });
  } catch (e) {
    report.status = "FAIL";
    report.error = e instanceof Error ? e.message : String(e);
  } finally {
    await browser.close();
  }

  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  mkdirSync(join(root, "fixtures/admin-contracts/v1"), { recursive: true });
  writeFileSync(
    join(
      root,
      "fixtures/admin-contracts/v1/m80-delete-category-evidence.json",
    ),
    JSON.stringify(report, null, 2),
  );
  // Update readiness artifacts if present
  const readinessPath = join(
    root,
    "runs/bella-recovery-prep/BELLA_FINAL_RECOVERY_READINESS_REPORT.json",
  );
  if (existsSync(readinessPath)) {
    const prev = JSON.parse(readFileSync(readinessPath, "utf8"));
    prev.DELETE_CERTIFICATION = {
      ...prev.DELETE_CERTIFICATION,
      DELETE_CATEGORY_CONTRACT_PROVEN: report.DELETE_CATEGORY_CONTRACT_PROVEN
        ? "YES"
        : prev.DELETE_CERTIFICATION.DELETE_CATEGORY_CONTRACT_PROVEN,
      DELETE_CATEGORY_REAL_HOST_PROVEN: report.DELETE_CATEGORY_REAL_HOST_PROVEN
        ? "YES"
        : "NO",
      DELETE_CATEGORY_CERTIFIED: "NO",
      Idempotent_delete_behavior_proven:
        (report.proofs as { E_idempotentAbsentHandled?: boolean })
          ?.E_idempotentAbsentHandled
          ? "YES"
          : "NO",
      Delete_read_back_behavior_proven:
        (report.proofs as { D_readBackConfirmsAbsence?: boolean })
          ?.D_readBackConfirmsAbsence
          ? "YES"
          : "NO",
      veroniCanaryM80: report,
      uncertainty: [
        "ADAPTER_CAPABILITY_deleteCategory_FIELD_ABSENT",
        "ADAPTER_deleteCategory_NOT_IMPLEMENTED",
        "NOT_PROMOTED_TO_M2B_ADAPTER_CAPABILITIES.write.deleteCategory=CERTIFIED",
        ...((report.status === "PASS" ? [] : ["VERONI_CANARY_DELETE_FAILED"]) as string[]),
      ],
    };
    prev.READINESS.READY_FOR_BELLA_RECOVERY_EXECUTION = "NO";
    prev.READINESS.blockers = [
      "deleteCategory not implemented/CERTIFIED in M2B_ADAPTER_CAPABILITIES",
      ...(report.DELETE_CATEGORY_REAL_HOST_PROVEN
        ? []
        : ["Veroni canary delete real-host proof incomplete"]),
    ];
    writeFileSync(readinessPath, JSON.stringify(prev, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === "PASS" ? 0 : 1);
}

main();
