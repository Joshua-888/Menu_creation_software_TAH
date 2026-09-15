/**
 * M74 — Reconcile Veroni live additions using peer probability policy:
 * dips only finger_food / menu_with_fries; never on drinks; no meat on vegetarian.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
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
import {
  filterAdditionsForProduct,
  productAllowsDips,
  classifyProductKind,
  type ProbabilityPolicyMap,
} from "../src/learning/categoryLikelihood.js";
import { loadProbabilityPolicy } from "../src/learning/peerArtifacts.js";
import { veroniDefaultTilbehorAdditions } from "../src/planning/structureMapping.js";

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

const outDir = join(root, "runs", "discovery", `m74-prob-reconcile-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function loadPolicy(): ProbabilityPolicyMap {
  const policy = loadProbabilityPolicy(root);
  if (!policy) {
    throw new Error(
      "No probability policy found. Run npm run m71:peer-observe then npm run m73:likelihood.",
    );
  }
  return policy;
}

async function ensureAdmin(page: Page) {
  await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/admin/menu`, {
    waitUntil: "domcontentloaded",
  });
  if (/\/login/i.test(page.url())) {
    await page.goto(`${VERONI_CANARY_TARGET.baseUrl}/login`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL!);
    await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
  }
}

async function setAdditionRows(
  page: Page,
  additions: Array<{ name: string; priceKr: string }>,
) {
  const form = page.locator("form:has(#menu_number)");
  const rows = form.locator("#addition-list tr.addition-form");
  let count = await rows.count();
  // Clear all existing rows first
  while (count > 0) {
    const last = rows.nth(count - 1);
    const btn = last.locator("button, a").last();
    if (await btn.count()) {
      await btn.click().catch(() => undefined);
    } else {
      await last.locator("input.addition-name").fill("");
      await last.locator("input.addition-price").fill("0");
      break;
    }
    await page.waitForTimeout(100);
    count = await rows.count();
    if (count > 40) break;
  }
  for (let i = 0; i < additions.length; i++) {
    count = await rows.count();
    if (i >= count) {
      await form.locator("#add-addition").click();
      await page.waitForTimeout(120);
    }
    const row = form.locator("#addition-list tr.addition-form").nth(i);
    await row.locator("input.addition-name").fill(additions[i]!.name);
    await row.locator("input.addition-price").fill(additions[i]!.priceKr);
  }
}

function sameAdds(
  a: Array<{ name: string; priceOre: number }>,
  b: Array<{ name: string; priceOre: number }>,
): boolean {
  const norm = (xs: typeof a) =>
    xs
      .map((x) => `${x.name.toLowerCase()}|${x.priceOre}`)
      .sort()
      .join(";");
  return norm(a) === norm(b);
}

async function main() {
  const lock = assertVeroniTargetLock({
    hostname: VERONI_CANARY_TARGET.host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    url: VERONI_CANARY_TARGET.baseUrl,
  });
  blockWriteUnlessTargetLocked(lock);
  if (!process.env.TAH_ADMIN_EMAIL || !process.env.TAH_ADMIN_PASSWORD) {
    throw new Error("missing TAH_ADMIN credentials");
  }

  const policyPath = join(root, "runs", "decisions", "peer-probability-policy.json");
  const policy = loadPolicy();
  if (!existsSync(policyPath)) {
    writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);
  const results: Array<Record<string, unknown>> = [];

  try {
    await ensureAdmin(page);
    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: VERONI_CANARY_TARGET.baseUrl,
      expectedHost: VERONI_CANARY_TARGET.host,
    });
    const listed = await adapter.listProducts();
    const work = listed.filter(
      (p) => p.databaseId && !p.name.startsWith("__TAH_CANARY_"),
    );

    console.log(
      JSON.stringify({
        phase: "start",
        products: work.length,
        dipAllow: policy.policy.dipAllowKinds,
        dipDeny: policy.policy.dipDenyKinds,
      }),
    );

    for (let i = 0; i < work.length; i++) {
      const row = work[i]!;
      try {
        const full = await adapter.readProduct(row.databaseId!);
        const name = full.name ?? row.name;
        const categoryNames = row.categoryText
          ? [row.categoryText]
          : undefined;
        const kind = classifyProductKind({
          name,
          ...(categoryNames ? { categoryNames } : {}),
        });
        const liveAdds = full.additions.map((a) => ({
          name: a.name,
          priceOre: a.priceOre ?? 0,
        }));

        let desired = filterAdditionsForProduct({
          name,
          ...(categoryNames ? { categoryNames } : {}),
          additions: liveAdds,
          policy,
        });

        // Ensure dips present on allow kinds
        if (
          productAllowsDips(
            { name, ...(categoryNames ? { categoryNames } : {}) },
            policy,
          )
        ) {
          for (const d of veroniDefaultTilbehorAdditions()) {
            if (
              !desired.some(
                (a) => a.name.toLowerCase() === d.name.toLowerCase(),
              )
            ) {
              desired.push({ name: d.name, priceOre: d.priceMinor ?? 1000 });
            }
          }
        }

        if (sameAdds(liveAdds, desired)) {
          results.push({ menu: row.menuNumber, name, kind, skipped: true, ok: true });
          continue;
        }

        await page.goto(
          `${VERONI_CANARY_TARGET.baseUrl}/admin/menu/${row.databaseId}/edit`,
          { waitUntil: "domcontentloaded" },
        );
        await dismissKnownCookieBanner(page);
        await setAdditionRows(
          page,
          desired.map((a) => ({
            name: a.name,
            priceKr: String(Math.round(a.priceOre / 100)),
          })),
        );
        const observed = await clickOpdaterAndObserveUpdate({
          page,
          databaseId: row.databaseId!,
          timeoutMs: 25_000,
        });
        const ok = observed.ok && observed.response.status < 400;
        results.push({
          menu: row.menuNumber,
          name,
          kind,
          ok,
          before: liveAdds.map((a) => a.name),
          after: desired.map((a) => a.name),
          status: observed.response.status,
        });
        console.log(
          JSON.stringify({
            i: i + 1,
            of: work.length,
            menu: row.menuNumber,
            kind,
            ok,
            before: liveAdds.length,
            after: desired.length,
          }),
        );
      } catch (err) {
        results.push({
          menu: row.menuNumber,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const report = {
      milestone: "M74_PROBABILITY_RECONCILE",
      status: results.every((r) => r.ok) ? "VERIFIED" : "PARTIAL",
      policy: policy.policy,
      updated: results.filter((r) => r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
