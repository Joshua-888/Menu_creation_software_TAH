import type { Page } from "playwright";
import {
  assertAllowlistedAdminHost,
  assertVeroniTargetLock,
  blockWriteUnlessTargetLocked,
} from "./targetLock.js";
import { VERONI_CANARY_TARGET } from "./types.js";
import { normalizeDestinationHost } from "./hostAllowlist.js";

export type FillInactiveProductInput = {
  menuNumber: string;
  name: string;
  description: string;
  /** Kroner string for #price, e.g. "99" */
  basePriceKr: string;
  categoryDatabaseId: string;
  variants: Array<{ name: string; priceKr: string }>;
  ingredients: string[];
  /** Absolute addon price in kroner string, e.g. "17" for 1700 øre */
  additions?: Array<{ name: string; priceKr: string }>;
  /**
   * When true, leave Aktiv? unchecked (hidden from storefront).
   * When false, check Aktiv? so the product is available on the storefront.
   * Defaults to true for the legacy `fillInactiveProductCreateForm` helper.
   */
  intendedHidden?: boolean;
};

/**
 * Assert admin page is on an allowlisted host (multi-merchant).
 * Pass expectedHost from the job; defaults to hostname of the page URL.
 */
export async function assertPageIsAllowlistedAdmin(
  page: Page,
  expectedHost?: string,
): Promise<void> {
  const host =
    expectedHost ??
    normalizeDestinationHost(new URL(page.url()).host);
  const lock = assertAllowlistedAdminHost({
    pageUrl: page.url(),
    expectedHost: host,
  });
  blockWriteUnlessTargetLocked(lock);
  if (!page.url().includes("/admin/")) {
    throw new Error(`ADMIN_WRITE_BLOCKED: not on admin route: ${page.url()}`);
  }
}

/** @deprecated use assertPageIsAllowlistedAdmin — Veroni canary only */
export async function assertPageIsVeroniAdmin(page: Page): Promise<void> {
  const lock = assertVeroniTargetLock({
    hostname: new URL(page.url()).host,
    restaurantName: VERONI_CANARY_TARGET.restaurantName,
    url: page.url(),
  });
  if (!lock.ok) {
    throw new Error(`ADMIN_WRITE_BLOCKED: ${lock.reason}`);
  }
  if (!page.url().includes("/admin/")) {
    throw new Error(`ADMIN_WRITE_BLOCKED: not on Veroni admin route: ${page.url()}`);
  }
}

/** Set Aktiv? checkbox to match intended storefront visibility. */
export async function setActiveCheckbox(
  page: Page,
  intendedHidden: boolean,
): Promise<void> {
  const active = page.locator("form:has(#menu_number) #active");
  if (!(await active.count())) {
    throw new Error("ADMIN_WRITE_BLOCKED: #active missing");
  }
  if (intendedHidden) {
    if (await active.isChecked()) await active.uncheck();
    if (await active.isChecked()) {
      throw new Error("ADMIN_WRITE_BLOCKED: failed to uncheck #active");
    }
  } else {
    if (!(await active.isChecked())) await active.check();
    if (!(await active.isChecked())) {
      throw new Error("ADMIN_WRITE_BLOCKED: failed to check #active");
    }
  }
}

/**
 * Fill create form. Does not submit.
 * Defaults to storefront-available (`Aktiv?` checked) unless intendedHidden.
 */
export async function fillProductCreateForm(
  page: Page,
  input: FillInactiveProductInput,
  opts?: { expectedHost?: string },
): Promise<void> {
  await assertPageIsAllowlistedAdmin(page, opts?.expectedHost);
  await page.locator("#menu_number").fill(input.menuNumber);
  await page.locator("#name").fill(input.name);
  await page.locator("#description").fill(input.description);
  await page.locator("#price").fill(input.basePriceKr);

  // Variants: prefer list rows (ignore #blueprint-*)
  for (let i = 0; i < input.variants.length; i++) {
    if (i > 0) {
      await page.locator("#add-variant").click();
      await page.waitForTimeout(200);
    }
    const row = page.locator("#variant-list tr.variant-form").nth(i);
    await row.locator("input.variant-name").fill(input.variants[i]!.name);
    await row.locator("input.variant-price").fill(input.variants[i]!.priceKr);
  }

  // Ingredients start empty — add rows inside list
  for (let i = 0; i < input.ingredients.length; i++) {
    await page.locator("#add-ingredient").click();
    await page.waitForTimeout(200);
    const row = page.locator("#ingredient-list tr.ingredient-form").nth(i);
    await row.locator("input.ingredient-name").fill(input.ingredients[i]!);
  }

  // Additions / TILBEHØR — optional; green + adds instantiated rows
  const additions = input.additions ?? [];
  for (let i = 0; i < additions.length; i++) {
    await page.locator("#add-addition").click();
    await page.waitForTimeout(200);
    const row = page.locator("#addition-list tr.addition-form").nth(i);
    await row.locator("input.addition-name").fill(additions[i]!.name);
    await row.locator("input.addition-price").fill(additions[i]!.priceKr);
  }

  // Categories: check only the selected id
  const boxes = page.locator("input[type='checkbox'][name='categories[]']");
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    const id = await box.getAttribute("id");
    const value = await box.getAttribute("value");
    const match =
      id === `category-${input.categoryDatabaseId}` ||
      value === input.categoryDatabaseId;
    if (match) {
      if (!(await box.isChecked())) await box.check();
    } else if (await box.isChecked()) {
      await box.uncheck();
    }
  }

  await setActiveCheckbox(page, input.intendedHidden === true);
}

/**
 * Legacy hidden create helper (Aktiv? unchecked). Prefer fillProductCreateForm.
 */
export async function fillInactiveProductCreateForm(
  page: Page,
  input: FillInactiveProductInput,
  opts?: { expectedHost?: string },
): Promise<void> {
  await fillProductCreateForm(
    page,
    { ...input, intendedHidden: true },
    opts,
  );
}

export async function assertActiveUnchecked(page: Page): Promise<void> {
  const active = page.locator("#active");
  if (!(await active.count())) {
    throw new Error("ADMIN_WRITE_BLOCKED: #active missing before submit");
  }
  if (await active.isChecked()) {
    throw new Error("ADMIN_WRITE_BLOCKED: #active is checked before submit");
  }
}

export async function assertActiveChecked(page: Page): Promise<void> {
  const active = page.locator("#active");
  if (!(await active.count())) {
    throw new Error("ADMIN_WRITE_BLOCKED: #active missing before submit");
  }
  if (!(await active.isChecked())) {
    throw new Error("ADMIN_WRITE_BLOCKED: #active is unchecked before submit");
  }
}

/** Trim excess dynamic rows via red X, then fill intended rows. */
async function trimThenFillNamedPriceRows(
  page: Page,
  opts: {
    listSelector: string;
    rowSelector: string;
    addSelector: string;
    nameInput: string;
    priceInput: string;
    rows: Array<{ name: string; priceKr: string }>;
  },
): Promise<void> {
  const form = page.locator("form:has(#menu_number)");
  const rows = form.locator(opts.rowSelector);
  let count = await rows.count();
  let guard = 0;
  while (count > opts.rows.length && count > 0 && guard < 60) {
    const last = rows.nth(count - 1);
    const btn = last.locator("button, a").last();
    if (await btn.count()) await btn.click().catch(() => undefined);
    else {
      await last.locator(opts.nameInput).fill("");
      if (await last.locator(opts.priceInput).count()) {
        await last.locator(opts.priceInput).fill("0");
      }
      break;
    }
    await page.waitForTimeout(120);
    count = await rows.count();
    guard += 1;
  }
  for (let i = 0; i < opts.rows.length; i++) {
    count = await rows.count();
    if (i >= count) {
      await form.locator(opts.addSelector).click();
      await page.waitForTimeout(150);
    }
    const row = form.locator(opts.rowSelector).nth(i);
    await row.locator(opts.nameInput).fill(opts.rows[i]!.name);
    await row.locator(opts.priceInput).fill(opts.rows[i]!.priceKr);
  }
}

/** Replace VARIANTER rows on an edit form (Opdater path). */
export async function setVariantRows(
  page: Page,
  variants: Array<{ name: string; priceKr: string }>,
): Promise<void> {
  await trimThenFillNamedPriceRows(page, {
    listSelector: "#variant-list",
    rowSelector: "#variant-list tr.variant-form",
    addSelector: "#add-variant",
    nameInput: "input.variant-name",
    priceInput: "input.variant-price",
    rows: variants,
  });
}

/** Replace TILBEHØR / addition rows on an edit form (Opdater path). */
export async function setAdditionRows(
  page: Page,
  additions: Array<{ name: string; priceKr: string }>,
): Promise<void> {
  await trimThenFillNamedPriceRows(page, {
    listSelector: "#addition-list",
    rowSelector: "#addition-list tr.addition-form",
    addSelector: "#add-addition",
    nameInput: "input.addition-name",
    priceInput: "input.addition-price",
    rows: additions,
  });
}

/** Replace INGREDIENSER rows on an edit form (Opdater path). */
export async function setIngredientRows(
  page: Page,
  ingredients: string[],
): Promise<void> {
  const form = page.locator("form:has(#menu_number)");
  const rows = form.locator("#ingredient-list tr.ingredient-form");
  let count = await rows.count();
  let guard = 0;
  while (count > ingredients.length && count > 0 && guard < 60) {
    const last = rows.nth(count - 1);
    const btn = last.locator("button, a").last();
    if (await btn.count()) await btn.click().catch(() => undefined);
    else {
      await last.locator("input.ingredient-name").fill("");
      break;
    }
    await page.waitForTimeout(120);
    count = await rows.count();
    guard += 1;
  }
  for (let i = 0; i < ingredients.length; i++) {
    count = await rows.count();
    if (i >= count) {
      await form.locator("#add-ingredient").click();
      await page.waitForTimeout(150);
    }
    await form
      .locator("#ingredient-list tr.ingredient-form")
      .nth(i)
      .locator("input.ingredient-name")
      .fill(ingredients[i]!);
  }
}
