/**
 * Browser-side scripts for Playwright page.evaluate.
 * Kept as plain .mjs so tsx/esbuild do not inject __name into serialized functions.
 */
/* global document */
/* eslint-disable no-undef */

export function extractProductListRows() {
  const rows = [...document.querySelectorAll("table tbody tr")];
  return rows.map((tr) => {
    const cells = [...tr.querySelectorAll("td")];
    const cellText = (td) =>
      (td?.textContent || "").replace(/\s+/g, " ").trim();
    const nameSpan = cells[2]?.querySelector("span");
    const name =
      (nameSpan?.textContent || "").replace(/\s+/g, " ").trim() ||
      cellText(cells[2]);
    const editHref =
      tr
        .querySelector("a[href*='/admin/menu/'][href$='/edit']")
        ?.getAttribute("href") || "";
    const showHref =
      [...tr.querySelectorAll("a[href]")].find((a) => {
        const h = a.getAttribute("href") || "";
        return /\/admin\/menu\/\d+\/?$/i.test(h) && !/\/edit/i.test(h);
      })?.getAttribute("href") || "";
    const editPath = editHref.replace(/^https?:\/\/[^/]+/i, "");
    const showPath = showHref.replace(/^https?:\/\/[^/]+/i, "") || null;
    const idMatch = /\/admin\/menu\/(\d+)/i.exec(editPath || showPath || "");
    return {
      databaseId: idMatch?.[1] ?? null,
      menuNumber: cellText(cells[0]) || null,
      name,
      categoryText: cellText(cells[3]) || null,
      priceText: cellText(cells[4]) || null,
      statusText: cellText(cells[5]) || null,
      editPath: editPath || null,
      showPath,
    };
  });
}

export function extractCategoryRows() {
  const rows = [...document.querySelectorAll("table tbody tr")];
  return rows.map((tr) => {
    const cells = [...tr.querySelectorAll("td")].map((td) =>
      (td.textContent || "").replace(/\s+/g, " ").trim(),
    );
    const edit =
      tr
        .querySelector("a[href*='/admin/categories/'][href$='/edit']")
        ?.getAttribute("href") || "";
    const path = edit.replace(/^https?:\/\/[^/]+/i, "");
    const idMatch = /\/admin\/categories\/(\d+)/i.exec(path);
    return {
      databaseId: idMatch?.[1] || "",
      name: cells[0] || "",
      order: cells[1] && !Number.isNaN(Number(cells[1])) ? Number(cells[1]) : null,
      itemCount:
        cells[2] && !Number.isNaN(Number(cells[2])) ? Number(cells[2]) : null,
      editPath: path,
    };
  });
}

/**
 * @param {{
 *   productUpdateForm: string,
 *   menuNumber: string,
 *   productName: string,
 *   description: string,
 *   basePrice: string,
 *   active: string,
 *   categoryCheckboxes: string,
 * }} selectors
 */
export function extractProductEdit(selectors) {
  const form =
    document.querySelector(selectors.productUpdateForm) ||
    document.querySelector("#menu_number")?.closest("form");
  const root = form || document;

  const val = (sel) => {
    const el = root.querySelector(sel);
    return el ? el.value : null;
  };
  const checked = (sel) => {
    const el = root.querySelector(sel);
    return el ? el.checked : null;
  };
  const categoryIds = [...root.querySelectorAll(selectors.categoryCheckboxes)]
    .filter((el) => el.checked)
    .map((el) => {
      const id = el.id || "";
      const m = /category-(\d+)/i.exec(id);
      return m?.[1] || el.value;
    });

  const variants = [...root.querySelectorAll("tr.variant-form")].map(
    (tr, index) => ({
      databaseId: tr.querySelector('input[name*="[id]"]')?.value || null,
      name: tr.querySelector("input.variant-name")?.value || "",
      priceRaw: tr.querySelector("input.variant-price")?.value || "",
      index,
    }),
  );
  const ingredients = [...root.querySelectorAll("tr.ingredient-form")].map(
    (tr, index) => ({
      databaseId: tr.querySelector('input[name*="[id]"]')?.value || null,
      name: tr.querySelector("input.ingredient-name")?.value || "",
      index,
    }),
  );
  const additions = [...root.querySelectorAll("tr.addition-form")].map(
    (tr, index) => ({
      databaseId: tr.querySelector('input[name*="[id]"]')?.value || null,
      name: tr.querySelector("input.addition-name")?.value || "",
      priceRaw: tr.querySelector("input.addition-price")?.value || "",
      index,
    }),
  );

  const methodOverride =
    form?.querySelector('input[name="_method"]')?.value || null;
  const existingImg = document.querySelector(
    "img[src*='menu'], img[src*='storage'], .existing-image, img.product-image",
  );

  return {
    menuNumber: val(selectors.menuNumber),
    name: val(selectors.productName),
    description: val(selectors.description),
    basePriceRaw: val(selectors.basePrice),
    active: checked(selectors.active),
    categoryIds,
    variants,
    ingredients,
    additions,
    formAction: form
      ? (form.getAttribute("action") || "").replace(/^https?:\/\/[^/]+/i, "")
      : null,
    formMethod: form?.getAttribute("method") || null,
    formMethodOverride: methodOverride,
    hasExistingImageHint: Boolean(existingImg),
  };
}

/** Raw visible fields for live readProduct certification compare. */
export function extractVisibleProductFields() {
  const form =
    document.querySelector("form:has(#menu_number)") ||
    document.querySelector("#menu_number")?.closest("form");
  const root = form || document;
  const q = (sel) => root.querySelector(sel)?.value ?? null;
  return {
    menuNumber: q("#menu_number"),
    name: q("#name"),
    description: q("#description"),
    basePrice: q("#price"),
    active: root.querySelector("#active")?.checked ?? null,
    activeHasCheckedAttr: root.querySelector("#active")?.hasAttribute("checked") ?? null,
    activeDefaultChecked: root.querySelector("#active")?.defaultChecked ?? null,
    variantNames: [
      ...root.querySelectorAll("tr.variant-form input.variant-name"),
    ].map((el) => el.value),
    variantPrices: [
      ...root.querySelectorAll("tr.variant-form input.variant-price"),
    ].map((el) => el.value),
    ingredientNames: [
      ...root.querySelectorAll("tr.ingredient-form input.ingredient-name"),
    ].map((el) => el.value),
    additionNames: [
      ...root.querySelectorAll("tr.addition-form input.addition-name"),
    ]
      .slice(0, 5)
      .map((el) => el.value),
    additionPrices: [
      ...root.querySelectorAll("tr.addition-form input.addition-price"),
    ]
      .slice(0, 5)
      .map((el) => el.value),
    categoryIds: [
      ...root.querySelectorAll("input[name='categories[]']:checked"),
    ].map((el) => {
      const m = /category-(\d+)/i.exec(el.id || "");
      return m?.[1] || el.value;
    }),
  };
}

/**
 * Zero-network successful-control serialization (FormData).
 * Unchecked checkboxes are omitted. CSRF-like names filtered by caller too.
 */
export function serializeSuccessfulControlsInPage(formSelector) {
  const SENSITIVE_RE = /token|csrf|password|cookie|session/i;
  const form = document.querySelector(formSelector);
  if (!form) {
    return { action: null, method: null, fields: [], asObject: {} };
  }
  const fd = new FormData(form);
  const fields = [];
  const asObject = {};
  for (const [name, value] of fd.entries()) {
    if (SENSITIVE_RE.test(name)) continue;
    if (typeof value !== "string") continue;
    fields.push({ name, value });
    const existing = asObject[name];
    if (existing === undefined) asObject[name] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else asObject[name] = [existing, value];
  }
  return {
    action: (form.getAttribute("action") || "").replace(/^https?:\/\/[^/]+/i, "") || null,
    method: (form.getAttribute("method") || "GET").toUpperCase(),
    fields,
    asObject,
  };
}

/**
 * Read-only snapshot of product form fields + dynamic rows.
 * Instantiated rows = list containers only; #blueprint-* / template ignored.
 */
export function extractAdminFormCompletenessSnapshot() {
  const form =
    document.querySelector("form:has(#menu_number)") ||
    document.querySelector("#menu_number")?.closest("form");
  const root = form || document;

  const isBlueprintNode = (el) => {
    if (!el) return true;
    if (el.closest("template")) return true;
    if (el.closest("[id^='blueprint-']")) return true;
    if (el.id && /^blueprint-/i.test(el.id)) return true;
    return false;
  };

  const mapRows = (listSel, rowSel, nameSel, priceSel) => {
    const list = root.querySelector(listSel);
    const scope = list || root;
    const all = [...scope.querySelectorAll(rowSel)];
    const out = [];
    for (const tr of all) {
      const blueprint = isBlueprintNode(tr);
      const inList = Boolean(list && list.contains(tr));
      out.push({
        name: tr.querySelector(nameSel)?.value || "",
        price: priceSel ? tr.querySelector(priceSel)?.value || "" : undefined,
        databaseId: tr.querySelector('input[name*="[id]"]')?.value || null,
        isBlueprint: blueprint,
        isInstantiated: inList && !blueprint,
      });
    }
    // Also record blueprints outside the list so callers can prove ignore
    for (const bp of document.querySelectorAll(
      "[id^='blueprint-'] tr, tr[id^='blueprint-'], [id^='blueprint-'].variant-form, [id^='blueprint-'].ingredient-form, [id^='blueprint-'].addition-form",
    )) {
      if (all.includes(bp)) continue;
      if (
        rowSel.includes("variant") &&
        !/variant/i.test(bp.className + bp.id)
      )
        continue;
      if (
        rowSel.includes("ingredient") &&
        !/ingredient/i.test(bp.className + bp.id)
      )
        continue;
      if (
        rowSel.includes("addition") &&
        !/addition/i.test(bp.className + bp.id)
      )
        continue;
      out.push({
        name: bp.querySelector?.(nameSel)?.value || "",
        price: priceSel ? bp.querySelector?.(priceSel)?.value || "" : undefined,
        databaseId: null,
        isBlueprint: true,
        isInstantiated: false,
      });
    }
    return out;
  };

  const categoryIds = [
    ...root.querySelectorAll("input[name='categories[]']:checked"),
  ].map((el) => {
    const m = /category-(\d+)/i.exec(el.id || "");
    return m?.[1] || el.value;
  });

  return {
    menuNumber: root.querySelector("#menu_number")?.value || "",
    name: root.querySelector("#name")?.value || "",
    description: root.querySelector("#description")?.value || "",
    basePrice: root.querySelector("#price")?.value || "",
    categoryIds,
    variants: mapRows(
      "#variant-list",
      "tr.variant-form",
      "input.variant-name",
      "input.variant-price",
    ),
    ingredients: mapRows(
      "#ingredient-list",
      "tr.ingredient-form",
      "input.ingredient-name",
      null,
    ),
    additions: mapRows(
      "#addition-list",
      "tr.addition-form",
      "input.addition-name",
      "input.addition-price",
    ),
    nativeCheckValidity: form ? form.checkValidity() : null,
    formAction: form
      ? (form.getAttribute("action") || "").replace(/^https?:\/\/[^/]+/i, "")
      : null,
  };
}

/** M3G: inspect update form + Opdater (no mutation). */
export function inspectUpdateFormAndOpdater() {
  const form = document.querySelector("form:has(#menu_number)");
  const btn = [...(form?.querySelectorAll("button, input[type=submit]") || [])].find(
    (b) => /opdater/i.test((b.textContent || b.value || "").trim()),
  );
  const box = btn?.getBoundingClientRect();
  const cx = box ? box.left + box.width / 2 : null;
  const cy = box ? box.top + box.height / 2 : null;
  const top = cx != null && cy != null ? document.elementFromPoint(cx, cy) : null;
  const method = form?.querySelector('input[name="_method"]');
  const csrf = form?.querySelector('input[name="_token"]');
  return {
    form: form
      ? {
          action: form.getAttribute("action"),
          method: form.getAttribute("method"),
          enctype: form.getAttribute("enctype"),
          _method: method?.value || null,
          hasCsrf: Boolean(csrf),
          checkValidity: form.checkValidity(),
        }
      : null,
    button: btn
      ? {
          tag: btn.tagName,
          type: btn.getAttribute("type") || btn.type,
          text: (btn.textContent || "").trim(),
          disabled: btn.disabled,
          buttonFormIsUpdateForm: btn.form === form,
          visible: !!(box && box.width > 0 && box.height > 0),
          boundingBox: box
            ? { x: box.x, y: box.y, w: box.width, h: box.height }
            : null,
          elementFromPointTag: top?.tagName || null,
          elementFromPointIsButtonOrChild: Boolean(
            top && (top === btn || btn.contains(top)),
          ),
          inViewport:
            !!box &&
            box.top < window.innerHeight &&
            box.bottom > 0 &&
            box.left < window.innerWidth &&
            box.right > 0,
        }
      : null,
  };
}

/** M3G: capture-phase submit preventDefault guard (zero network). */
export function installM3gSubmitGuard() {
  window.__m3gCleanup?.();
  const log = {
    submitEventObserved: false,
    submitterTag: null,
    submitterText: null,
    submitterIsOpdater: false,
    formActionObserved: null,
    formMethodObserved: null,
    preventDefaultCalls: [],
    clickObserved: false,
    clickDefaultPrevented: null,
    formValid: null,
  };
  const form = document.querySelector("form:has(#menu_number)");
  const btn = [...(form?.querySelectorAll("button, input[type=submit]") || [])].find(
    (b) => /opdater/i.test((b.textContent || b.value || "").trim()),
  );
  if (!form || !btn) throw new Error("missing_form_or_button");

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
    log.formValid = form.checkValidity();
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
  const clickSpy = (ev) => {
    log.clickObserved = true;
    queueMicrotask(() => {
      log.clickDefaultPrevented = ev.defaultPrevented;
    });
  };
  form.addEventListener("submit", submitGuard, true);
  btn.addEventListener("click", clickSpy, true);
  window.__m3gGuardLog = log;
  window.__m3gCleanup = () => {
    form.removeEventListener("submit", submitGuard, true);
    btn.removeEventListener("click", clickSpy, true);
    Event.prototype.preventDefault = origPD;
  };
  return { ok: true };
}

export function readM3gSubmitGuard() {
  return (
    window.__m3gGuardLog || {
      submitEventObserved: false,
      submitterTag: null,
      submitterText: null,
      submitterIsOpdater: false,
      formActionObserved: null,
      formMethodObserved: null,
      preventDefaultCalls: [],
      clickObserved: false,
      clickDefaultPrevented: null,
      formValid: null,
    }
  );
}

export function cleanupM3gSubmitGuard() {
  window.__m3gCleanup?.();
}

export function runM3gRequestSubmit() {
  const form = document.querySelector("form:has(#menu_number)");
  const btn = [...(form?.querySelectorAll("button, input[type=submit]") || [])].find(
    (b) => /opdater/i.test((b.textContent || b.value || "").trim()),
  );
  if (!form || !btn) return { error: "missing_form_or_button" };
  form.requestSubmit(btn);
  return {
    error: null,
    formValid: form.checkValidity(),
    action: form.getAttribute("action"),
    method: form.getAttribute("method"),
  };
}
