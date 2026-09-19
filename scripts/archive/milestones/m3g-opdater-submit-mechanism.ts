/**
 * M3G — Find actual Opdater submit mechanism (ZERO server mutations).
 * Local capture-phase submit preventDefault — not network abort.
 * Compares Playwright locator.click vs form.requestSubmit(opdater).
 * Never uses form.submit().
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  cleanupM3gSubmitGuard,
  inspectUpdateFormAndOpdater,
  installM3gSubmitGuard,
  readM3gSubmitGuard,
  runM3gRequestSubmit,
} from "../src/tah/adapters/v1/pageScripts.mjs";

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

const base = "https://veronipizza.dk";
const outDir = join(
  root,
  "runs",
  "discovery",
  `m3g-submit-mech-${Date.now()}`,
);
mkdirSync(outDir, { recursive: true });

const CANARY = {
  databaseId: "18",
  menuNumber: "99001",
  name: "__TAH_CANARY_PRODUCT_M3__",
  description: "Automated TakeAwayHero inactive canary test",
};

type GuardLog = {
  submitEventObserved: boolean;
  submitterTag: string | null;
  submitterText: string | null;
  submitterIsOpdater: boolean;
  formActionObserved: string | null;
  formMethodObserved: string | null;
  preventDefaultCalls: Array<{
    type: string;
    targetTag: string | null;
    currentTag: string | null;
  }>;
  clickObserved: boolean;
  clickDefaultPrevented: boolean | null;
  formValid: boolean | null;
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: existsSync(join(root, "playwright/.auth/tah-admin-veroni.json"))
    ? join(root, "playwright/.auth/tah-admin-veroni.json")
    : undefined,
});
const page = await context.newPage();

const consoleErrors: string[] = [];
const pageErrors: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
});
page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));

const mutationMeta: Array<{ method: string; url: string; postDataLen: number }> =
  [];
page.on("request", (req) => {
  const m = req.method().toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(m)) {
    mutationMeta.push({
      method: m,
      url: req.url().split("?")[0]!,
      postDataLen: (req.postData() || "").length,
    });
  }
});

async function ensureAdmin(p: Page) {
  await p.goto(`${base}/admin/menu/18/edit`, { waitUntil: "domcontentloaded" });
  if (/\/login/i.test(p.url())) {
    await p.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await p
      .locator('input[type="email"]')
      .first()
      .fill(process.env.TAH_ADMIN_EMAIL!);
    await p
      .locator('input[type="password"]')
      .first()
      .fill(process.env.TAH_ADMIN_PASSWORD!);
    await p.getByRole("button", { name: /^login$/i }).click();
    await p.waitForTimeout(1500);
    await p.goto(`${base}/admin/menu/18/edit`, {
      waitUntil: "domcontentloaded",
    });
  }
}

async function dismissCookies(p: Page) {
  try {
    const allow = p.getByRole("button", { name: /allow cookies/i });
    if (await allow.count()) await allow.click({ timeout: 2000 }).catch(() => {});
  } catch {
    /* ignore */
  }
}

await ensureAdmin(page);
await dismissCookies(page);

const identity = await page.evaluate(() => ({
  name: (document.querySelector("#name") as HTMLInputElement | null)?.value,
  menuNumber: (
    document.querySelector("#menu_number") as HTMLInputElement | null
  )?.value,
  description: (
    document.querySelector("#description") as HTMLTextAreaElement | null
  )?.value,
}));
const descriptionDrift =
  identity.description !== CANARY.description
    ? {
        expected: CANARY.description,
        actual: identity.description,
        code: "BASELINE_DESCRIPTION_DRIFT",
      }
    : null;
if (
  identity.name !== CANARY.name ||
  identity.menuNumber !== CANARY.menuNumber
) {
  console.error(
    JSON.stringify({ status: "BLOCKED", reason: "identity", identity }, null, 2),
  );
  process.exit(2);
}
if (descriptionDrift) {
  console.error(
    JSON.stringify(
      {
        warning: "BASELINE_DESCRIPTION_DRIFT",
        note: "Proceeding with submit-mechanism diagnostic only; no write authorized",
        descriptionDrift,
      },
      null,
      2,
    ),
  );
}

const formInspect = (await page.evaluate(
  inspectUpdateFormAndOpdater,
)) as ReturnType<typeof inspectUpdateFormAndOpdater>;

function classifyPlaywrightClick(log: GuardLog): string {
  if (!log.clickObserved) return "A_CLICK_NOT_DELIVERED";
  if (log.clickObserved && !log.submitEventObserved)
    return "B_CLICK_DELIVERED_BUT_NO_SUBMIT";
  return "C_CLICK_AND_SUBMIT_CONFIRMED";
}

// --- Mode 1: Playwright locator.click
mutationMeta.length = 0;
consoleErrors.length = 0;
pageErrors.length = 0;
await page.goto(`${base}/admin/menu/18/edit`, { waitUntil: "domcontentloaded" });
await dismissCookies(page);
await page.evaluate(installM3gSubmitGuard);

const formLoc = page.locator("form:has(#menu_number)");
const opdaterBtn = formLoc.getByRole("button", { name: /^Opdater$/i });
await opdaterBtn.scrollIntoViewIfNeeded();
const beforeClickBox = await opdaterBtn.boundingBox();
let playwrightClickError: string | null = null;
try {
  await opdaterBtn.click({ timeout: 10_000 });
} catch (e) {
  playwrightClickError = String(e).slice(0, 400);
  try {
    await opdaterBtn.click({ force: true, timeout: 5_000 });
  } catch (e2) {
    playwrightClickError += " | force: " + String(e2).slice(0, 200);
  }
}
await page.waitForTimeout(200);
const playwrightClickPath = (await page.evaluate(
  readM3gSubmitGuard,
)) as GuardLog;
await page.evaluate(cleanupM3gSubmitGuard);
const playwrightMutations = [...mutationMeta];
const playwrightConsole = [...consoleErrors];
const playwrightPageErrors = [...pageErrors];

// --- Mode 2: requestSubmit(opdater)
mutationMeta.length = 0;
consoleErrors.length = 0;
pageErrors.length = 0;
await page.goto(`${base}/admin/menu/18/edit`, { waitUntil: "domcontentloaded" });
await dismissCookies(page);
await page.evaluate(installM3gSubmitGuard);
const requestSubmitPath = (await page.evaluate(runM3gRequestSubmit)) as {
  error: string | null;
  formValid?: boolean;
  action?: string | null;
  method?: string | null;
};
await page.waitForTimeout(200);
const requestSubmitGuard = (await page.evaluate(
  readM3gSubmitGuard,
)) as GuardLog;
await page.evaluate(cleanupM3gSubmitGuard);
const requestSubmitMutations = [...mutationMeta];
const requestSubmitConsole = [...consoleErrors];
const requestSubmitPageErrors = [...pageErrors];

// --- Product safety
await page.goto(`${base}/admin/menu/18/edit`, { waitUntil: "domcontentloaded" });
const afterIdentity = await page.evaluate(() => ({
  description: (
    document.querySelector("#description") as HTMLTextAreaElement | null
  )?.value,
  name: (document.querySelector("#name") as HTMLInputElement | null)?.value,
  menuNumber: (
    document.querySelector("#menu_number") as HTMLInputElement | null
  )?.value,
}));

await page.goto(`${base}/admin/menu`, { waitUntil: "domcontentloaded" });
const listStatus = await page.evaluate(() => {
  const tr = [...document.querySelectorAll("table tbody tr")].find((row) =>
    (row.textContent || "").includes("__TAH_CANARY_PRODUCT_M3__"),
  );
  const cells = tr ? [...tr.querySelectorAll("td")] : [];
  return (cells[5]?.textContent || "").replace(/\s+/g, " ").trim();
});

const pub = await context.newPage();
await pub.goto(base + "/", { waitUntil: "domcontentloaded" });
const pubText = await pub.locator("body").innerText();
const publicAbsent =
  !pubText.includes(CANARY.name) && !pubText.includes(CANARY.menuNumber);
await pub.close();

const clickClass = classifyPlaywrightClick(playwrightClickPath);
const bothSubmit =
  playwrightClickPath.submitEventObserved &&
  requestSubmitGuard.submitEventObserved;
const clickFailsRsWorks =
  !playwrightClickPath.submitEventObserved &&
  requestSubmitGuard.submitEventObserved;

let interpretation = "neither works → form/button/client-JS contract issue";
let recommended: "A_PLAYWRIGHT_CLICK" | "B_REQUEST_SUBMIT" | "BLOCKED" =
  "BLOCKED";
let rootCause = clickClass;
let ready = false;

if (bothSubmit) {
  interpretation =
    "CLICK and requestSubmit both work → M3F request observer was probably wrong (FALSE_NEGATIVE_REQUEST_OBSERVER / multipart postData)";
  recommended = "A_PLAYWRIGHT_CLICK";
  rootCause = "FORM_SUBMIT_EVENT_CONFIRMED_BOTH_PATHS";
  ready = true;
} else if (clickFailsRsWorks) {
  interpretation =
    "CLICK fails, requestSubmit works → Playwright/UI click-path issue";
  recommended = "B_REQUEST_SUBMIT";
  rootCause = "OPDATER_CLICK_NO_SUBMIT_EVENT";
  ready = true;
} else if (
  playwrightClickPath.submitEventObserved &&
  !requestSubmitGuard.submitEventObserved
) {
  interpretation = "Playwright click works; requestSubmit did not — prefer A";
  recommended = "A_PLAYWRIGHT_CLICK";
  rootCause = "FORM_SUBMIT_EVENT_CONFIRMED_CLICK_ONLY";
  ready = true;
}

const menuMutations = [...playwrightMutations, ...requestSubmitMutations].filter(
  (r) => /\/admin\/menu/i.test(r.url),
);

const m3fObserverAudit = {
  waitForRequestAttachedBeforeClick: true,
  usesForceClick: true,
  predicateRequires: [
    "POST",
    "pathname === /admin/menu/{id} (trailing slash stripped)",
    "_method=put visible in request.postData()",
  ],
  multipartRisk:
    formInspect.form?.enctype === "multipart/form-data"
      ? "HIGH: Playwright request.postData() is often null/empty for multipart; isProductUpdateRequest then returns false → UPDATE_REQUEST_NOT_SENT false negative"
      : "LOW_OR_UNKNOWN_ENCTYPE",
  pageOnceUnrelatedConsumer: false,
  notes: [
    "Listener ordering in clickOpdaterAndObserveUpdate is correct (waitForRequest before click).",
    "URL matcher strips trailing slash — unlikely false negative for /admin/menu/18.",
    "Critical: multipart FormData bodies frequently yield empty postData(); matcher requires _method=put IN BODY → false negative if request fired.",
    "M3F used force:true; this diagnostic also tests normal Playwright click with scrollIntoViewIfNeeded.",
    "If submit event fires under local preventDefault, HTTP would fire without guard — UPDATE_REQUEST_NOT_SENT then implicates observer, not missing submit.",
  ],
};

const flakyTestNote = {
  code: "FLAKY_TEST_DETECTED",
  tests: [
    "tests/contract/admin-contract-m2b.test.ts > parses list rows...",
    "tests/contract/admin-contract-v1.test.ts > recognizes certified structure selectors",
  ],
  observation:
    "Intermittent 5000ms Playwright launch/timeout failures under load; later full run passed (~2s).",
  recommendedFollowUp:
    "Replace arbitrary waits with deterministic readiness; raise testTimeout only if justified for chromium.launch + fixture setContent.",
};

const report = {
  milestone: "M3G",
  mutationRule: "ZERO_SERVER_MUTATIONS",
  formInspect,
  beforeClickBox,
  playwrightClickError,
  matrix: {
    normalPlaywrightClick: {
      clickEvent: playwrightClickPath.clickObserved,
      submitEvent: playwrightClickPath.submitEventObserved,
      submitter: playwrightClickPath.submitterText,
      clickDefaultPrevented: playwrightClickPath.clickDefaultPrevented,
      preventDefaultCalls: playwrightClickPath.preventDefaultCalls,
      classification: clickClass,
      mutations: playwrightMutations,
    },
    requestSubmit: {
      submitEvent: requestSubmitGuard.submitEventObserved,
      submitter: requestSubmitGuard.submitterText,
      submitterIsOpdater: requestSubmitGuard.submitterIsOpdater,
      formValid: requestSubmitPath.formValid ?? requestSubmitGuard.formValid,
      action: requestSubmitPath.action ?? requestSubmitGuard.formActionObserved,
      method: requestSubmitPath.method ?? requestSubmitGuard.formMethodObserved,
      mutations: requestSubmitMutations,
    },
  },
  interpretation,
  consoleErrors: [
    ...new Set([...playwrightConsole, ...requestSubmitConsole]),
  ],
  pageErrors: [
    ...new Set([...playwrightPageErrors, ...requestSubmitPageErrors]),
  ],
  unexpectedMutationRequests: menuMutations,
  m3fObserverAudit,
  rootCause,
  recommendedSubmissionMechanism: recommended,
  productUnchanged: {
    exists: afterIdentity.name === CANARY.name,
    description: afterIdentity.description,
    descriptionMatchesExpectedBaseline:
      afterIdentity.description === CANARY.description,
    descriptionUnchangedDuringDiag:
      afterIdentity.description === identity.description,
    descriptionDriftBeforeDiag: descriptionDrift,
    listStatus,
    listSkjult: listStatus === "Skjult",
    publicAbsent,
  },
  flakyTestNote,
  READY_FOR_ONE_REAL_UPDATE:
    ready &&
    menuMutations.length === 0 &&
    descriptionDrift === null,
};

if (menuMutations.length) {
  (report as { status?: string }).status = "UNEXPECTED_MUTATION_REQUEST";
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(4);
}

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
mkdirSync(join(root, "fixtures", "admin-contracts", "v1"), { recursive: true });
writeFileSync(
  join(
    root,
    "fixtures",
    "admin-contracts",
    "v1",
    "m3g-submit-mechanism-evidence.json",
  ),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
