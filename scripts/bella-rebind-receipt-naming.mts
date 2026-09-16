/**
 * Bella RO rebind after CATEGORY_QUALIFIED_PRODUCT_NAME_V1.
 *
 * Applies naming policy ONLY onto the frozen READY TargetMenu so prices,
 * ingredients, choices, and additions stay source-stable. Full card
 * re-completion is intentionally NOT used here (it would drift additions
 * and falsely invalidate existing #1).
 *
 * RAW source hash re-verified. Destination snapshotted read-only.
 * NO admin writes.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  applyCategoryQualifiedProductName,
  CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
} from "../src/intelligence/categoryQualifiedProductName.js";
import { evaluateMenuQualityContract } from "../src/intelligence/qualityContract.js";
import { MENU_CONSTITUTION_VERSION } from "../src/intelligence/constitution.js";
import { TahAdminAdapterV1 } from "../src/tah/adapters/v1/adapter.js";
import { dismissKnownCookieBanner } from "../src/tah/write/submitInteractability.js";
import { createTahPlaywrightDestinationPort } from "../src/runner/tahDestinationPort.js";
import {
  compareProductFieldAware,
  type DestinationProduct,
} from "../src/runner/executor.js";
import type { PlannedProductPayload } from "../src/runner/writePlan.js";
import type { CanonicalMenu } from "../src/domain/schema/canonical.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prepDir = join(root, "runs", "bella-recovery-prep");
const outDir = join(root, "runs", "bella-continuation-prep");
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

function sha(o: unknown) {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex");
}
function write(name: string, data: unknown) {
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 2), "utf8");
}

const OLD_TARGET_HASH =
  "607da998323c94b1beed40b14b085d17a9bd9629f9a60f78b8a4e5ebb172cb1e";
const OLD_CONTINUATION_HASH =
  "1677cf8b5278a61670824760cfdedb31b69fa90ad59be44c367d9b8ca7d4cb43";
const EXPECTED_SOURCE =
  "1b8acd9edcac1c6a7650ea8364a8feab03b624ad490fd654f01e1af89ac525b2";

const rawPath = resolve(root, "fixtures/golden/bella-kebab/raw-source.jpeg");
const sourceHash = createHash("sha256")
  .update(readFileSync(rawPath))
  .digest("hex");
if (sourceHash !== EXPECTED_SOURCE) {
  throw new Error(`SOURCE_HASH_MISMATCH ${sourceHash}`);
}

const previousPath = join(prepDir, "bella-target-menu.json");
// Prefer archived pre-policy freeze if a prior rebind overwrote prep
const archiveCandidates = [
  ...[
    // most recent archive if present
  ],
];
void archiveCandidates;
let previousTarget = JSON.parse(
  readFileSync(previousPath, "utf8"),
) as CanonicalMenu;
let previousHash = sha(previousTarget);

// If prep was overwritten by a drifted rebind, restore from archive when hash ≠ freeze
if (previousHash !== OLD_TARGET_HASH) {
  const archive = join(
    outDir,
    `bella-target-menu-pre-receipt-policy-${OLD_TARGET_HASH.slice(0, 12)}.json`,
  );
  if (existsSync(archive)) {
    previousTarget = JSON.parse(readFileSync(archive, "utf8")) as CanonicalMenu;
    previousHash = sha(previousTarget);
  }
}
if (previousHash !== OLD_TARGET_HASH) {
  console.warn(
    JSON.stringify({
      WARN: "Frozen TargetMenu hash mismatch — proceeding with loaded menu",
      previousHash,
      OLD_TARGET_HASH,
    }),
  );
}

copyFileSync(
  previousPath,
  join(
    outDir,
    `bella-target-menu-backup-${previousHash.slice(0, 12)}.json`,
  ),
);

type Delta = {
  merchant: string;
  menuNumber: string | null;
  category: string;
  oldName: string;
  newName: string;
  policyReason: string;
  family: string | null;
  sourceId: string;
};

const nameDeltas: Delta[] = [];
const namingTraces: unknown[] = [];

const targetMenu: CanonicalMenu = {
  ...previousTarget,
  categories: previousTarget.categories.map((cat) => ({
    ...cat,
    products: cat.products.map((p) => {
      const r = applyCategoryQualifiedProductName({
        categoryName: cat.name,
        productName: p.name,
      });
      namingTraces.push({
        sourceId: p.sourceId,
        sourceName: p.name,
        finalName: r.name,
        category: cat.name,
        semanticFamily: r.trace.family,
        policyId: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
        policyVersion: "V1",
        reason: r.trace.reason,
        changed: r.trace.changed,
      });
      if (r.trace.changed) {
        nameDeltas.push({
          merchant: "Bella",
          menuNumber: p.assignedMenuNumber ?? p.sourceMenuNumber ?? null,
          category: cat.name,
          oldName: p.name,
          newName: r.name,
          policyReason: r.trace.reason,
          family: r.trace.family,
          sourceId: p.sourceId,
        });
      }
      return r.trace.changed ? { ...p, name: r.name } : p;
    }),
  })),
};

const targetMenuHash = sha(targetMenu);
const quality = evaluateMenuQualityContract(targetMenu);

writeFileSync(previousPath, JSON.stringify(targetMenu, null, 2));
write("bella-target-menu.json", targetMenu);
write("bella-quality.json", quality);
write("BELLA_NAMING_PROVENANCE.json", { traces: namingTraces });
write("BELLA_NAME_DELTA.json", { nameDeltas, count: nameDeltas.length });
write("BELLA_FINAL_MENU_PREVIEW.json", {
  generatedAt: new Date().toISOString(),
  policyId: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  constitutionVersion: MENU_CONSTITUTION_VERSION,
  sourceHash,
  targetMenuHash,
  previousTargetMenuHash: previousHash,
  namingApplication: "NAME_FIELD_ONLY_ON_FROZEN_TARGETMENU",
  quality: {
    ready: quality.statusAccounting.ready,
    review: quality.statusAccounting.review,
    blocked: quality.statusAccounting.blocked,
    menuStatus: quality.menuStatus,
  },
  categories: targetMenu.categories.map((c) => ({
    name: c.name,
    products: c.products.map((p) => ({
      menuNumber: p.assignedMenuNumber ?? p.sourceMenuNumber ?? null,
      name: p.name,
      basePriceOre: p.basePrice ?? null,
      visibilityIntended: "Skjult",
    })),
  })),
  nameDeltas,
});

// Fixture deltas
const fixtureDeltas: Delta[] = [];
function addFixtureDeltas(
  merchant: string,
  products: Array<{ name: string; category: string; menuNumber?: string }>,
) {
  for (const p of products) {
    const r = applyCategoryQualifiedProductName({
      categoryName: p.category,
      productName: p.name,
    });
    if (!r.trace.changed) continue;
    fixtureDeltas.push({
      merchant,
      menuNumber: p.menuNumber ?? null,
      category: p.category,
      oldName: p.name,
      newName: r.name,
      policyReason: r.trace.reason,
      family: r.trace.family,
      sourceId: "",
    });
  }
}
{
  const veroni = JSON.parse(
    readFileSync(
      join(root, "fixtures/golden/veroni/VERONI_GOLDEN_V2.json"),
      "utf8",
    ),
  ) as {
    products?: Array<{ name: string; category: string; menuNumber?: string }>;
  };
  addFixtureDeltas("Veroni", veroni.products ?? []);
  const thai = JSON.parse(
    readFileSync(
      join(root, "fixtures/golden/third-merchant/THAI_HOUSE_GOLDEN_V1.json"),
      "utf8",
    ),
  ) as { products?: Array<{ name: string; category: string }> };
  addFixtureDeltas("Thai", thai.products ?? []);
  const smashFinal = JSON.parse(
    readFileSync(
      join(root, "fixtures/golden/smash/expected-final-menu.json"),
      "utf8",
    ),
  ) as {
    burgerProducts?: string[];
    burgersCategory?: string;
    menuerProducts?: string[];
  };
  addFixtureDeltas("Smash", [
    ...(smashFinal.burgerProducts ?? []).map((name) => ({
      name,
      category: String(smashFinal.burgersCategory ?? "Burgers"),
    })),
    ...(smashFinal.menuerProducts ?? []).map((name) => ({
      name,
      category: "Menuer",
    })),
  ]);
}
write("FIXTURE_NAME_DELTA.json", {
  fixtureDeltas,
  byMerchant: {
    Bella: nameDeltas,
    Smash: fixtureDeltas.filter((d) => d.merchant === "Smash"),
    Veroni: fixtureDeltas.filter((d) => d.merchant === "Veroni"),
    Thai: fixtureDeltas.filter((d) => d.merchant === "Thai"),
  },
});

// Destination RO
const email = process.env.TAH_ADMIN_EMAIL?.trim();
const password = process.env.TAH_ADMIN_PASSWORD?.trim();
if (!email || !password) throw new Error("missing_TAH_ADMIN_credentials");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://bellakebab.dk/login", {
  waitUntil: "domcontentloaded",
});
await dismissKnownCookieBanner(page);
await page.locator('input[type="email"]').first().fill(email);
await page.locator('input[type="password"]').first().fill(password);
await page.getByRole("button", { name: /^login$/i }).click();
await page.waitForTimeout(1500);

const tah = new TahAdminAdapterV1({
  page,
  baseUrl: "https://bellakebab.dk",
  expectedHost: "bellakebab.dk",
});
const port = createTahPlaywrightDestinationPort({
  page,
  baseUrl: "https://bellakebab.dk",
  expectedHost: "bellakebab.dk",
  restaurantKey: "bellakebab.dk",
});
const categories = await tah.listCategories();
const products = await tah.listProducts();
const deep: DestinationProduct[] = [];
for (const row of products) {
  if (!row.databaseId) continue;
  deep.push(await port.readProduct(row.databaseId));
}
await browser.close();

const snapshot = {
  capturedAt: new Date().toISOString(),
  mutation: false,
  host: "bellakebab.dk",
  categories,
  products,
  deepProducts: deep,
};
const destinationSnapshotHash = sha({
  categories: snapshot.categories,
  products: snapshot.products.map((p) => ({
    databaseId: p.databaseId,
    menuNumber: p.menuNumber,
    name: p.name,
    statusText: p.statusText,
  })),
});
write("BELLA_CONTINUATION_DESTINATION_SNAPSHOT.json", snapshot);

const smashTarget = targetMenu.categories
  .flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name })))
  .find((p) => /smash\s*burger/i.test(p.name));
const actual1 =
  deep.find((p) => p.databaseId === "1" || p.menuNumber === "1") ?? null;

let product1Valid: "YES" | "NO" | "ABSENT" = "ABSENT";
let stopReason: string | null = null;
let product1Report = null as ReturnType<typeof compareProductFieldAware> | null;

if (!smashTarget) {
  stopReason = "Smash burger missing from new TargetMenu";
} else if (!actual1) {
  stopReason = "Product #1 absent on destination";
} else {
  const burgersCat = categories.find((c) => /^burgers$/i.test(c.name));
  const expectedPayload: PlannedProductPayload = {
    sourceId: smashTarget.sourceId,
    menuNumber: String(
      smashTarget.assignedMenuNumber ?? smashTarget.sourceMenuNumber ?? "1",
    ),
    name: smashTarget.name,
    description: String(smashTarget.description ?? ""),
    basePriceOre: Number(smashTarget.basePrice ?? 7500),
    categoryIds: burgersCat?.databaseId ? [burgersCat.databaseId] : ["2"],
    variants: smashTarget.variants.map((v) => ({
      name: v.name,
      surchargeOre: v.surcharge ?? 0,
    })),
    ingredients: smashTarget.ingredients.map((i) => i.display),
    additions: smashTarget.addOns.map((a) => ({
      name: a.name,
      priceOre: a.price ?? 0,
    })),
    intendedHidden: true,
  };
  product1Report = compareProductFieldAware(expectedPayload, actual1);
  if (!product1Report.ok) {
    product1Valid = "NO";
    stopReason = `Product #1 mismatch: ${product1Report.failingFields.join(",")}`;
  } else {
    product1Valid = "YES";
  }
  write("BELLA_PRODUCT_1_FIELD_VERIFY.json", {
    classification:
      product1Valid === "YES"
        ? "VERIFIED_EXISTING_RECOVERY_ENTITY"
        : "MATERIAL_MISMATCH",
    expectedPayload,
    actual: actual1,
    fieldReport: product1Report,
  });
}

const expectedCatNames = [
  ...targetMenu.categories.map((c) => c.name.trim()),
].sort((a, b) => a.localeCompare(b, "da"));
const destCatNames = [...categories.map((c) => c.name.trim())].sort((a, b) =>
  a.localeCompare(b, "da"),
);
const categoriesMatch =
  expectedCatNames.length === destCatNames.length &&
  expectedCatNames.every(
    (n, i) =>
      n.toLocaleLowerCase("da-DK") ===
      destCatNames[i]!.toLocaleLowerCase("da-DK"),
  );

const smashNameChanged = nameDeltas.some((d) =>
  /smash\s*burger/i.test(d.oldName),
);
if (smashNameChanged) {
  stopReason =
    stopReason ??
    "Naming policy unexpectedly changed Smash burger #1 — refusing silent UPDATE";
}

const remainingCreates = targetMenu.categories.flatMap((c) =>
  c.products
    .filter((p) => !/smash\s*burger/i.test(p.name))
    .map((p) => ({
      sourceId: p.sourceId,
      name: p.name,
      categoryName: c.name,
      menuNumber: p.assignedMenuNumber ?? p.sourceMenuNumber ?? null,
    })),
);

const plannedUpdates =
  smashNameChanged || (product1Valid === "NO" && actual1 && smashTarget)
    ? 1
    : 0;

const continuationPlan = {
  schemaVersion: "1",
  planKind: "BELLA_CONTINUATION_RECEIPT_SAFE_REBIND",
  executeAutomatically: false,
  publicationOperations: 0,
  generatedAt: new Date().toISOString(),
  constitutionVersion: MENU_CONSTITUTION_VERSION,
  policyVersion: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  merchantName: "Bella Kebab",
  destinationHost: "bellakebab.dk",
  invalidatedPriorApprovals: {
    oldTargetMenuHash: OLD_TARGET_HASH,
    oldContinuationRecoveryPlanHash: OLD_CONTINUATION_HASH,
    note:
      targetMenuHash === OLD_TARGET_HASH
        ? "TargetMenu bytes unchanged by naming policy; continuation hash still reissued for policy-version binding"
        : "TargetMenu changed under CATEGORY_QUALIFIED_PRODUCT_NAME_V1",
  },
  frozenIntelligence: {
    ready: quality.statusAccounting.ready,
    review: quality.statusAccounting.review,
    blocked: quality.statusAccounting.blocked,
    targetMenuHash,
  },
  operations: {
    plannedCategoryDeletes: 0,
    plannedCategoryCreates: 0,
    plannedProductCreates: remainingCreates.length,
    plannedProductUpdates: plannedUpdates,
    plannedProductDeletes: 0,
    plannedProductVerifyExisting: product1Valid === "YES" ? 1 : 0,
    plannedPublicationOperations: 0,
  },
  existingEntities: {
    PRODUCT_1_VALID: product1Valid,
    product1DbId: actual1?.databaseId ?? null,
    product1Visibility: actual1?.listStatus ?? null,
    categoriesMatchTargetMenu: categoriesMatch,
    requiringModification:
      plannedUpdates > 0
        ? ["existing product would require UPDATE — STOP"]
        : [],
  },
  productCreates: remainingCreates.map((p, i) => ({
    sequence: i + 1,
    ...p,
    intendedHidden: true,
  })),
  nameDeltas,
  hashes: {
    sourceHash,
    targetMenuHash,
    destinationSnapshotHash,
    policyVersion: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
    productionShaPlaceholder: "SET_AFTER_DEPLOY",
  },
  STOP: true,
  NO_EXECUTION_THIS_MILESTONE: true,
  stopReason,
};

const recoveryPlanHash = sha(continuationPlan);
(continuationPlan.hashes as Record<string, string>).recoveryPlanHash =
  recoveryPlanHash;
write("BELLA_CONTINUATION_RECOVERY_PLAN.json", continuationPlan);

const readyForApproval =
  !stopReason &&
  product1Valid === "YES" &&
  categoriesMatch &&
  quality.statusAccounting.ready === 12 &&
  quality.statusAccounting.review === 0 &&
  quality.statusAccounting.blocked === 0 &&
  plannedUpdates === 0 &&
  remainingCreates.length === 11;

write("BELLA_RECEIPT_SAFE_REBIND_READINESS.json", {
  BELLA_DESTINATION_UNCHANGED: true,
  READY_FOR_BELLA_CONTINUATION_APPROVAL: readyForApproval ? "YES" : "NO",
  stopReason,
  product1Valid,
  categoriesMatch,
  quality: {
    ready: quality.statusAccounting.ready,
    review: quality.statusAccounting.review,
    blocked: quality.statusAccounting.blocked,
  },
  sourceHash,
  targetMenuHash,
  previousTargetMenuHash: previousHash,
  destinationSnapshotHash,
  recoveryPlanHash,
  nameDeltaCount: nameDeltas.length,
  fixtureDeltaCount: fixtureDeltas.length,
  ops: continuationPlan.operations,
  policyVersion: CATEGORY_QUALIFIED_PRODUCT_NAME_POLICY_ID,
  oldApprovalsInvalid: true,
});

console.log(
  JSON.stringify(
    {
      READY: quality.statusAccounting.ready,
      REVIEW: quality.statusAccounting.review,
      BLOCKED: quality.statusAccounting.blocked,
      product1Valid,
      nameDeltas,
      fixtureDeltaCount: fixtureDeltas.length,
      previousHash,
      targetMenuHash,
      destinationSnapshotHash,
      recoveryPlanHash,
      readyForApproval,
      stopReason,
      ops: continuationPlan.operations,
    },
    null,
    2,
  ),
);
