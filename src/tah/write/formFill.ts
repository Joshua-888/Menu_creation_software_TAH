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

/**
 * Fill create form and force #active unchecked. Does not submit.
 */
export async function fillInactiveProductCreateForm(
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

  const active = page.locator("#active");
  if (!(await active.count())) {
    throw new Error("ADMIN_WRITE_BLOCKED: #active missing");
  }
  if (await active.isChecked()) {
    await active.uncheck();
  }
  if (await active.isChecked()) {
    throw new Error("ADMIN_WRITE_BLOCKED: failed to uncheck #active");
  }
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
