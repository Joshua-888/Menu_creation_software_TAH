/**
 * M3G — Opdater submit-event diagnostics (ZERO server mutations).
 * Local capture-phase submit preventDefault — not network abort.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(path) {
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
const outDir = join(root, "runs", "discovery", `m3g-event-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const CANARY = {
  databaseId: "18",
  menuNumber: "99001",
  name: "__TAH_CANARY_PRODUCT_M3__",
  description: "Automated TakeAwayHero inactive canary test",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: existsSync(join(root, "playwright/.auth/tah-admin-veroni.json"))
    ? join(root, "playwright/.auth/tah-admin-veroni.json")
    : undefined,
});
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
});
page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));

const mutationMeta = [];
page.on("request", (req) => {
  const m = req.method().toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(m)) {
    mutationMeta.push({ method: m, url: req.url().split("?")[0] });
  }
});

async function ensureAdmin() {
  await page.goto(`${base}/admin/menu/18/edit`, { waitUntil: "domcontentloaded" });
  if (/\/login/i.test(page.url())) {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').first().fill(process.env.TAH_ADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.TAH_ADMIN_PASSWORD);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.waitForTimeout(1500);
    await page.goto(`${base}/admin/menu/18/edit`, { waitUntil: "domcontentloaded" });
  }
}

await ensureAdmin();

// Dismiss cookie banner if present (non-product mutation UI)
try {
  const allow = page.getByRole("button", { name: /allow cookies/i });
  if (await allow.count()) await allow.click({ timeout: 2000 }).catch(() => {});
} catch {
  /* ignore */
}

const identity = await page.evaluate(() => ({
  name: document.querySelector("#name")?.value,
  menuNumber: document.querySelector("#menu_number")?.value,
  description: document.querySelector("#description")?.value,
}));
if (
  identity.name !== CANARY.name ||
  identity.menuNumber !== CANARY.menuNumber ||
  identity.description !== CANARY.description
) {
  console.error(JSON.stringify({ status: "BLOCKED", reason: "identity", identity }, null, 2));
  process.exit(2);
}

/** Inspect form + button without clicking */
const formInspect = await page.evaluate(() => {
  const form = document.querySelector("form:has(#menu_number)");
  const btn = [...(form?.querySelectorAll("button, input[type=submit]") || [])].find(
    (b) => /opdater/i.test((b.textContent || b.value || "").trim()),
  );
  const attrs = (el) => {
    if (!el) return null;
    const out = {};
    for (const a of el.attributes) {
      if (/token|csrf|password|session/i.test(a.name)) {
        out[a.name] = "[REDACTED]";
        continue;
      }
      if (a.name === "value" && /token|csrf/i.test(el.getAttribute("name") || "")) {
        out[a.name] = "[REDACTED]";
        continue;
      }
      out[a.name] = a.value;
    }
    return out;
  };
  const box = btn?.getBoundingClientRect();
  const cx = box ? box.left + box.width / 2 : null;
  const cy = box ? box.top + box.height / 2 : null;
  const top = cx != null ? document.elementFromPoint(cx, cy) : null;
  const csrf = form?.querySelector('input[name="_token"]');
  const method = form?.querySelector('input[name="_method"]');
  return {
    form: form
      ? {
          tag: form.tagName,
          id: form.id || null,
          className: form.className || null,
          action: form.getAttribute("action"),
          method: form.getAttribute("method"),
          enctype: form.getAttribute("enctype"),
          target: form.getAttribute("target"),
          noValidate: form.noValidate,
          autocomplete: form.getAttribute("autocomplete"),
          attributes: attrs(form),
          _method: method?.value || null,
          hasCsrf: Boolean(csrf),
        }
      : null,
    button: btn
      ? {
          tag: btn.tagName,
          type: btn.getAttribute("type"),
          text: (btn.textContent || btn.value || "").trim(),
          id: btn.id || null,
          className: btn.className || null,
          name: btn.getAttribute("name"),
          value: btn.getAttribute("value"),
          disabled: btn.disabled,
          formAttr: btn.getAttribute("form"),
          formAction: btn.getAttribute("formaction"),
          formMethod: btn.getAttribute("formmethod"),
          formEnctype: btn.getAttribute("formenctype"),
          attributes: attrs(btn),
          buttonFormIsUpdateForm: btn.form === form,
          visible: !!(box && box.width > 0 && box.height > 0),
          boundingBox: box
            ? { x: box.x, y: box.y, w: box.width, h: box.height }
            : null,
          center: { x: cx, y: cy },
          elementFromPointTag: top?.tagName || null,
          elementFromPointText: (top?.textContent || "").trim().slice(0, 40),
          elementFromPointIsButtonOrChild: Boolean(
            top && (top === btn || btn.contains(top)),
          ),
          computedPointerEvents: top ? getComputedStyle(top).pointerEvents : null,
        }
      : null,
    validity: {
      checkValidity: form?.checkValidity() ?? null,
      invalidControls: form
        ? [...form.querySelectorAll("input,textarea,select")]
            .filter((el) => el.willValidate && !el.checkValidity())
            .map((el) => ({
              name: el.name,
              id: el.id,
              validationMessage: el.validationMessage,
            }))
        : [],
    },
  };
});

/** Install zero-network submit guard + click instrumentation via page.evaluateOnNewDocument won't work mid-page — use evaluate + addEventListener */
async function installGuardAndRun(mode) {
  mutationMeta.length = 0;
  consoleErrors.length = 0;
  pageErrors.length = 0;

  // Re-navigate for pristine state between modes
  await page.goto(`${base}/admin/menu/18/edit`, { waitUntil: "domcontentloaded" });
  try {
    const allow = page.getByRole("button", { name: /allow cookies/i });
    if (await allow.count()) await allow.click({ timeout: 1500 }).catch(() => {});
  } catch {
    /* ignore */
  }

  const result = await page.evaluate(async (runMode) => {
    const log = {
      mode: runMode,
      clickObserved: false,
      clickDefaultPrevented: null,
      submitEventObserved: false,
      submitterTag: null,
      submitterText: null,
      submitterIsOpdater: false,
      formActionObserved: null,
      formMethodObserved: null,
      preventDefaultCalls: [],
    };

    const form = document.querySelector("form:has(#menu_number)");
    const btn = [...(form?.querySelectorAll("button, input[type=submit]") || [])].find(
      (b) => /opdater/i.test((b.textContent || b.value || "").trim()),
    );
    if (!form || !btn) return { ...log, error: "missing_form_or_button" };

    // Temporary preventDefault spy (diagnostic only)
    const origPD = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function (...args) {
      try {
        log.preventDefaultCalls.push({
          type: this.type,
          targetTag: this.target?.tagName || null,
          currentTag: this.currentTarget?.tagName || null,
        });
      } catch {
        /* ignore */
      }
      return origPD.apply(this, args);
    };

    const submitGuard = (ev) => {
      log.submitEventObserved = true;
      const sub = ev.submitter;
      log.submitterTag = sub?.tagName || null;
      log.submitterText = (sub?.textContent || sub?.value || "").trim().slice(0, 40);
      log.submitterIsOpdater = /opdater/i.test(log.submitterText || "");
      log.formActionObserved = form.getAttribute("action");
      log.formMethodObserved = form.getAttribute("method");
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    form.addEventListener("submit", submitGuard, true);

    const clickSpy = (ev) => {
      log.clickObserved = true;
      // after microtask, check defaultPrevented on click
      queueMicrotask(() => {
        log.clickDefaultPrevented = ev.defaultPrevented;
      });
    };
    btn.addEventListener("click", clickSpy, true);

    try {
      if (runMode === "click") {
        btn.click();
      } else if (runMode === "requestSubmit") {
        form.requestSubmit(btn);
      }
      // allow sync handlers
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      form.removeEventListener("submit", submitGuard, true);
      btn.removeEventListener("click", clickSpy, true);
      Event.prototype.preventDefault = origPD;
    }
    return log;
  }, mode);

  await page.waitForTimeout(300);
  return {
    ...result,
    mutationRequestsAfter: [...mutationMeta],
    consoleErrors: [...consoleErrors],
    pageErrors: [...pageErrors],
  };
}

const clickPath = await installGuardAndRun("click");
const requestSubmitPath = await installGuardAndRun("requestSubmit");

// Reload pristine and confirm product unchanged
await page.goto(`${base}/admin/menu/18/edit`, { waitUntil: "domcontentloaded" });
const afterIdentity = await page.evaluate(() => ({
  description: document.querySelector("#description")?.value,
  name: document.querySelector("#name")?.value,
  menuNumber: document.querySelector("#menu_number")?.value,
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

function classifyClick(path) {
  if (!path.clickObserved && path.mode === "click") return "OPDATER_CLICK_NOT_DELIVERED";
  if (path.mode === "click" && path.clickObserved && !path.submitEventObserved) {
    return "OPDATER_CLICK_NO_SUBMIT_EVENT";
  }
  if (path.submitEventObserved) return "FORM_SUBMIT_EVENT_CONFIRMED";
  return "OPDATER_CLICK_NO_SUBMIT_EVENT";
}

const clickClass = classifyClick(clickPath);
const rsClass = requestSubmitPath.submitEventObserved
  ? "FORM_SUBMIT_EVENT_CONFIRMED"
  : "OPDATER_CLICK_NO_SUBMIT_EVENT";

let rootCause = clickClass;
let nextStep = "BLOCKED";
let recommended = "Investigate click-path interference; do not use form.submit()";

if (
  clickPath.submitEventObserved &&
  requestSubmitPath.submitEventObserved
) {
  rootCause = "FORM_SUBMIT_EVENT_CONFIRMED";
  nextStep = "READY_FOR_ONE_REAL_CANARY_UPDATE";
  recommended =
    "Prefer verifiedButton.click() with submit-event+request observation; M3F matcher may have been a false negative if submit reaches network";
} else if (!clickPath.submitEventObserved && requestSubmitPath.submitEventObserved) {
  rootCause = "OPDATER_CLICK_NO_SUBMIT_EVENT";
  nextStep = "READY_FOR_ONE_REAL_CANARY_UPDATE";
  recommended =
    "Click path blocked; candidate: form.requestSubmit(verifiedOpdaterButton) after separate canary certification — never form.submit()";
} else if (!clickPath.clickObserved) {
  rootCause = "OPDATER_CLICK_NOT_DELIVERED";
  nextStep = "BLOCKED";
  recommended = "Fix overlay/interactability before any real update";
} else {
  rootCause = "OPDATER_CLICK_NO_SUBMIT_EVENT";
  nextStep = "BLOCKED";
  recommended = "Neither click nor requestSubmit produced submit under guard — inspect handlers";
}

const unexpectedMutations = [
  ...clickPath.mutationRequestsAfter,
  ...requestSubmitPath.mutationRequestsAfter,
].filter((r) => /\/admin\/menu/i.test(r.url));

const report = {
  milestone: "M3G",
  mutationRule: "ZERO_SERVER_MUTATIONS",
  formInspect,
  matrix: {
    normalPlaywrightClick: {
      clickEvent: clickPath.clickObserved,
      submitEvent: clickPath.submitEventObserved,
      submitter: clickPath.submitterText,
      clickDefaultPrevented: clickPath.clickDefaultPrevented,
      preventDefaultCalls: clickPath.preventDefaultCalls,
      classification: clickClass,
    },
    nativeRequestSubmit: {
      submitEvent: requestSubmitPath.submitEventObserved,
      submitter: requestSubmitPath.submitterText,
      submitterIsOpdater: requestSubmitPath.submitterIsOpdater,
      classification: rsClass,
    },
  },
  consoleErrors: [...new Set([...clickPath.consoleErrors, ...requestSubmitPath.consoleErrors])],
  pageErrors: [...new Set([...clickPath.pageErrors, ...requestSubmitPath.pageErrors])],
  unexpectedMutationRequests: unexpectedMutations,
  m3fMatcherAudit: {
    requiresPost: true,
    requiresPathAdminMenuId: true,
    requiresMethodPutInBody: true,
    notes: [
      "Matcher requires POST + pathname /admin/menu/{id} + _method=put in postData",
      "If no submit event fires, UPDATE_REQUEST_NOT_SENT is correct (not a false negative)",
      "Possible false negative only if request fires with empty postData() or non-POST representation",
      "M3G shows whether submit event reaches browser before HTTP",
    ],
    falseNegativeLikely:
      clickPath.submitEventObserved || requestSubmitPath.submitEventObserved
        ? "POSSIBLE_IF_REQUEST_FIRED_BUT_POSTDATA_UNREADABLE"
        : "UNLIKELY_NO_SUBMIT_EVENT",
  },
  rootCauseClassification: rootCause,
  recommendedSubmissionMechanism: recommended,
  productUnchanged: {
    description: afterIdentity.description,
    descriptionMatchesBaseline: afterIdentity.description === CANARY.description,
    listStatus,
    publicAbsent,
  },
  nextStep,
};

if (unexpectedMutations.length) {
  report.status = "UNEXPECTED_MUTATION_REQUEST";
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exit(4);
}

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
