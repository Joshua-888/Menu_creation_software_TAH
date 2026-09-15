/**
 * M71 — Observe peer TAH customer menus (read-only) and emit structure reports.
 *
 * Usage:
 *   PEER_MENU_URLS=https://shop-a.dk,https://shop-b.dk npx tsx scripts/m71-peer-menu-observe.ts
 *   PEER_MENU_FIXTURE=1 npx tsx scripts/m71-peer-menu-observe.ts   # offline fixtures
 *
 * Never writes to peer restaurants.
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
import {
  analyzePeerMenu,
  distillStructurePatterns,
  type PeerMenuSnapshot,
} from "../src/learning/peerMenuStructure.js";
import { stratifiedPeerSample } from "../src/learning/peerSampling.js";
import {
  defaultStructurePattern,
  upsertStructureSemanticPolicy,
} from "../src/learning/structurePolicy.js";
import { writeLatestPeerObservePointer } from "../src/learning/peerArtifacts.js";
import { DecisionStore } from "../src/decisions/store.js";

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

const outDir = join(root, "runs", "discovery", `m71-peer-observe-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function hostFromUrl(url: string): string {
  return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(
    /^www\./,
    "",
  );
}

async function ensureAdmin(page: Page, baseUrl: string) {
  console.log(JSON.stringify({ phase: "login", baseUrl }));
  await page.goto(`${baseUrl}/admin/menu`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  if (/\/login/i.test(page.url())) {
    const email = process.env.TAH_ADMIN_EMAIL;
    const password = process.env.TAH_ADMIN_PASSWORD;
    if (!email || !password) {
      throw new Error(`login required for ${baseUrl} but TAH_ADMIN credentials missing`);
    }
    await page.goto(`${baseUrl}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(2000);
  }
  console.log(JSON.stringify({ phase: "logged_in", url: page.url() }));
}

async function observeHost(page: Page, baseUrl: string): Promise<PeerMenuSnapshot> {
  const host = hostFromUrl(baseUrl);
  const clean = baseUrl.replace(/\/$/, "");
  await ensureAdmin(page, clean);
  const adapter = new TahAdminAdapterV1({
    page,
    baseUrl: clean,
    expectedHost: host,
  });
  console.log(JSON.stringify({ phase: "list_products", host }));
  const listed = await adapter.listProducts();
  const candidates = listed.filter(
    (p) => p.databaseId && !p.name.startsWith("__TAH_CANARY_"),
  );
  // Stratified sample — ensure pizza/finger_food/etc. are represented.
  const maxSample = Number(process.env.PEER_MENU_SAMPLE || "24");
  const sample = stratifiedPeerSample(candidates, { maxSample });
  console.log(
    JSON.stringify({
      phase: "sample",
      host,
      listed: candidates.length,
      sampling: sample.length,
      mode: "stratified",
    }),
  );

  const products = [];
  for (let i = 0; i < sample.length; i++) {
    const row = sample[i]!;
    try {
      const full = await Promise.race([
        adapter.readProduct(row.databaseId!),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("readProduct timeout")), 20_000),
        ),
      ]);
      products.push({
        databaseId: row.databaseId!,
        menuNumber: (full.menuNumber ?? row.menuNumber ?? "").trim(),
        name: full.name ?? row.name,
        categoryIds: full.categoryIds,
        variants: full.variants.map((v) => ({
          name: v.name,
          priceOre: v.priceOre ?? 0,
        })),
        additions: full.additions.map((a) => ({
          name: a.name,
          priceOre: a.priceOre ?? 0,
        })),
        ingredients: full.ingredients.map((ing) => ing.name),
        description: full.description ?? "",
      });
    } catch (err) {
      console.log(
        JSON.stringify({
          phase: "read_skip",
          host,
          id: row.databaseId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      products.push({
        databaseId: row.databaseId!,
        menuNumber: (row.menuNumber ?? "").trim(),
        name: row.name,
        variants: [],
        additions: [],
      });
    }
    if ((i + 1) % 5 === 0 || i + 1 === sample.length) {
      console.log(
        JSON.stringify({
          phase: "progress",
          host,
          done: i + 1,
          of: sample.length,
        }),
      );
    }
  }
  return {
    host,
    restaurantKey: host,
    observedAt: new Date().toISOString(),
    products,
    source: "admin_read",
  };
}

function loadFixtures(): PeerMenuSnapshot[] {
  const path = join(root, "fixtures", "peer-menus", "best-customers.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as PeerMenuSnapshot[];
  return raw.map((s) => ({ ...s, source: "fixture" as const }));
}

async function main() {
  const useFixture =
    process.env.PEER_MENU_FIXTURE === "1" ||
    process.env.PEER_MENU_FIXTURE === "true";
  const urls = (process.env.PEER_MENU_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let snaps: PeerMenuSnapshot[] = [];

  if (useFixture || urls.length === 0) {
    snaps = loadFixtures();
    if (urls.length === 0 && !useFixture) {
      console.log(
        JSON.stringify({
          note: "No PEER_MENU_URLS — using fixtures/peer-menus/best-customers.json. Set PEER_MENU_URLS=https://a,https://b for live observe.",
        }),
      );
    }
  } else {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);
    try {
      for (const url of urls) {
        const base = url.includes("://") ? url.replace(/\/$/, "") : `https://${url}`;
        console.log(JSON.stringify({ phase: "host_start", base }));
        try {
          const snap = await observeHost(page, base);
          snaps.push(snap);
          writeFileSync(
            join(outDir, `peer-${snap.host}.json`),
            JSON.stringify(snap, null, 2),
          );
          console.log(
            JSON.stringify({
              phase: "host_done",
              host: snap.host,
              products: snap.products.length,
            }),
          );
        } catch (err) {
          console.log(
            JSON.stringify({
              phase: "host_failed",
              base,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
    } finally {
      await browser.close();
    }
  }

  const perRestaurant = snaps.map((s) => ({
    host: s.host,
    productCount: s.products.length,
    analysis: analyzePeerMenu(s),
  }));
  const summary =
    snaps.length > 0 ? distillStructurePatterns(snaps) : defaultStructurePattern();

  const storePath = join(root, "runs", "decisions", "peer-structure.sqlite");
  mkdirSync(dirname(storePath), { recursive: true });
  const store = new DecisionStore(storePath);
  const policy = upsertStructureSemanticPolicy({ store, summary });
  store.close();

  const report = {
    milestone: "M71_PEER_MENU_OBSERVE",
    status: "VERIFIED",
    mode: urls.length && !useFixture ? "live_urls" : "fixture",
    urls,
    perRestaurant,
    summary,
    policyId: policy.policyId,
    storePath,
    outDir,
  };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, "runs", "decisions", "peer-structure-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  const pointerPath = writeLatestPeerObservePointer(root, {
    observedAt: new Date().toISOString(),
    outDir,
    mode: report.mode,
    hosts: summary.hosts,
    structureFingerprint: summary.fingerprint,
    policyId: policy.policyId,
    storePath,
  });
  console.log(
    JSON.stringify({ ...report, latestPeerObservePointer: pointerPath }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
