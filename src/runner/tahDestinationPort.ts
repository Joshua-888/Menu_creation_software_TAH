/**
 * Playwright-backed DestinationPort wrapping certified TahAdminAdapterV1 writes.
 */
import type { Page } from "playwright";
import { TahAdminAdapterV1 } from "../tah/adapters/v1/adapter.js";
import { V1_ROUTES } from "../tah/adapters/v1/selectors.js";
import { clickSkabAndObserveCreate } from "../tah/write/createRequestObserve.js";
import { clickOpdaterAndObserveUpdate } from "../tah/write/updateRequestObserve.js";
import {
  assertActiveUnchecked,
  fillInactiveProductCreateForm,
} from "../tah/write/formFill.js";
import { dismissKnownCookieBanner } from "../tah/write/submitInteractability.js";
import {
  resolveDestinationIdentity,
  type DestinationMatchResult,
  type DestinationPort,
  type DestinationProduct,
} from "./executor.js";
import type { PlannedProductPayload, ProductIdentityKey } from "./writePlan.js";
import { gateWriteLabels } from "../decisions/labelQuality.js";
import type { DecisionStore } from "../decisions/store.js";

function oreToKrString(ore: number): string {
  return String(Math.round(ore / 100));
}

export type TahDestinationPortOptions = {
  page: Page;
  baseUrl: string;
  expectedHost: string;
  /** In-memory catalog seed (refreshed after writes when possible). */
  catalog?: DestinationProduct[];
  sourceIdMap?: Map<string, string>;
  /** Restaurant key for learned label precedents (e.g. veronipizza.dk). */
  restaurantKey?: string;
  decisionStore?: DecisionStore | null;
};

export function createTahPlaywrightDestinationPort(
  options: TahDestinationPortOptions,
): DestinationPort {
  const adapter = new TahAdminAdapterV1({
    page: options.page,
    baseUrl: options.baseUrl,
    expectedHost: options.expectedHost,
  });
  let catalog = [...(options.catalog ?? [])];
  const sourceIdMap = options.sourceIdMap ?? new Map<string, string>();

  async function refreshCatalogFromList(): Promise<void> {
    const listed = await adapter.listProducts();
    const next: DestinationProduct[] = [];
    for (const row of listed) {
      if (!row.databaseId) continue;
      try {
        const full = await adapter.readProduct(row.databaseId);
        next.push({
          databaseId: row.databaseId,
          menuNumber: full.menuNumber ?? row.menuNumber ?? "",
          name: full.name ?? row.name,
          description: full.description ?? "",
          basePriceOre: full.basePriceOre ?? 0,
          categoryIds: full.categoryIds,
          variants: full.variants.map((v) => ({
            name: v.name,
            priceOre: v.priceOre ?? 0,
          })),
          ingredients: full.ingredients.map((i) => ({ name: i.name })),
          additions: full.additions.map((a) => ({
            name: a.name,
            priceOre: a.priceOre ?? 0,
          })),
          listStatus: (row.statusText || "").trim(),
        });
      } catch {
        next.push({
          databaseId: row.databaseId,
          menuNumber: row.menuNumber ?? "",
          name: row.name,
          description: "",
          basePriceOre: 0,
          categoryIds: [],
          variants: [],
          ingredients: [],
          additions: [],
          listStatus: (row.statusText || "").trim(),
        });
      }
    }
    catalog = next;
  }

  return {
    async findByIdentity(
      identity: ProductIdentityKey,
    ): Promise<DestinationMatchResult> {
      if (catalog.length === 0) {
        await refreshCatalogFromList();
      }
      return resolveDestinationIdentity(identity, catalog, sourceIdMap);
    },

    async readProduct(databaseId: string): Promise<DestinationProduct> {
      const full = await adapter.readProduct(databaseId);
      const listed = await adapter.listProducts();
      const row = listed.find((p) => p.databaseId === databaseId);
      return {
        databaseId,
        menuNumber: full.menuNumber ?? "",
        name: full.name ?? "",
        description: full.description ?? "",
        basePriceOre: full.basePriceOre ?? 0,
        categoryIds: full.categoryIds,
        variants: full.variants.map((v) => ({
          name: v.name,
          priceOre: v.priceOre ?? 0,
        })),
        ingredients: full.ingredients.map((i) => ({ name: i.name })),
        additions: full.additions.map((a) => ({
          name: a.name,
          priceOre: a.priceOre ?? 0,
        })),
        listStatus: (row?.statusText || "").trim(),
      };
    },

    async listCategories() {
      const cats = await adapter.listCategories();
      return cats.map((c) => ({ databaseId: c.databaseId, name: c.name }));
    },

    async createCategory(input) {
      try {
        const { destinationId } = await adapter.createCategory({
          name: input.name,
          allowCustomerCategory: input.allowCustomerCategory === true,
        });
        return { outcome: "CREATED" as const, databaseId: destinationId };
      } catch (err) {
        return {
          outcome: "FAILED" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async createHiddenProduct(payload: PlannedProductPayload) {
      try {
        const categoryId = payload.categoryIds[0];
        if (!categoryId || categoryId.startsWith("__resolve__:")) {
          return {
            outcome: "FAILED" as const,
            error: "createHiddenProduct requires a resolved category id",
          };
        }

        // Fast path: already on destination list by menu number
        const listedBefore = await adapter.listProducts();
        const existingRow = listedBefore.find(
          (p) =>
            p.databaseId &&
            (p.menuNumber || "").trim() === payload.menuNumber.trim(),
        );
        if (existingRow?.databaseId) {
          sourceIdMap.set(payload.sourceId, existingRow.databaseId);
          return {
            outcome: "CREATED" as const,
            databaseId: existingRow.databaseId,
          };
        }

        const { page, baseUrl } = options;
        await page.goto(new URL(V1_ROUTES.menuCreate, baseUrl).toString(), {
          waitUntil: "domcontentloaded",
        });
        await dismissKnownCookieBanner(page);

        const gated = gateWriteLabels({
          store: options.decisionStore ?? null,
          restaurantKey: options.restaurantKey ?? options.expectedHost,
          menuNumber: payload.menuNumber,
          name: payload.name,
          description: payload.description,
          ingredients: payload.ingredients,
        });
        if (!gated.ok) {
          return {
            outcome: "FAILED" as const,
            error:
              gated.failure ??
              "LABEL_QUALITY_REVIEW: correct name/ingredients before create",
          };
        }

        const safeName = gated.name.trim().slice(0, 80);
        const safeDesc = gated.description.trim().slice(0, 240);
        const safeIngredients = gated.ingredients
          .map((i) => i.trim())
          .filter(Boolean)
          .slice(0, 12);
        const safeVariants =
          payload.variants.length > 0
            ? payload.variants.slice(0, 8)
            : [{ name: "Alm.", surchargeOre: 0 }];

        await fillInactiveProductCreateForm(
          page,
          {
            menuNumber: payload.menuNumber,
            name: safeName,
            description: safeDesc,
            basePriceKr: oreToKrString(payload.basePriceOre),
            categoryDatabaseId: categoryId,
            variants: safeVariants.map((v) => ({
              name: v.name.slice(0, 40),
              priceKr: oreToKrString(v.surchargeOre),
            })),
            ingredients: safeIngredients,
            additions: payload.additions.slice(0, 8).map((a) => ({
              name: a.name.slice(0, 40),
              priceKr: oreToKrString(a.priceOre),
            })),
          },
          { expectedHost: options.expectedHost },
        );
        await assertActiveUnchecked(page);

        const observed = await clickSkabAndObserveCreate({
          page,
          timeoutMs: 30_000,
        });
        if (!observed.ok) {
          return {
            outcome: "FAILED" as const,
            error: `${observed.code}${observed.detail ? `: ${observed.detail}` : ""}`,
          };
        }
        // 302 redirect is success; only hard-fail on 4xx/5xx final statuses.
        if (observed.response.status >= 400) {
          // Still try list read-back — some servers return 500 after writing.
          await page.waitForTimeout(800);
          const listedAfterErr = await adapter.listProducts();
          const rowAfterErr = listedAfterErr.find(
            (p) =>
              p.databaseId &&
              (p.menuNumber || "").trim() === payload.menuNumber.trim(),
          );
          if (rowAfterErr?.databaseId) {
            sourceIdMap.set(payload.sourceId, rowAfterErr.databaseId);
            return {
              outcome: "CREATED" as const,
              databaseId: rowAfterErr.databaseId,
            };
          }
          return {
            outcome: "FAILED" as const,
            error: `CREATE_RESPONSE_ERROR status=${observed.response.status}`,
          };
        }

        await page.waitForTimeout(1200);
        // Lightweight read-back: list rows only (avoid full edit-form crawl).
        let foundId: string | null = null;
        for (let attempt = 0; attempt < 3 && !foundId; attempt++) {
          const listed = await adapter.listProducts();
          const row = listed.find(
            (p) =>
              p.databaseId &&
              (p.menuNumber || "").trim() === payload.menuNumber.trim(),
          );
          if (row?.databaseId) foundId = row.databaseId;
          else await page.waitForTimeout(800);
        }
        if (!foundId) {
          return {
            outcome: "FAILED" as const,
            error: "createHiddenProduct read-back missing product",
          };
        }
        sourceIdMap.set(payload.sourceId, foundId);
        catalog = []; // invalidate cache
        return { outcome: "CREATED" as const, databaseId: foundId };
      } catch (err) {
        return {
          outcome: "FAILED" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async updateProductViaOpdater(input: {
      databaseId: string;
      payload: PlannedProductPayload;
    }) {
      try {
        const { page, baseUrl } = options;
        const gated = gateWriteLabels({
          store: options.decisionStore ?? null,
          restaurantKey: options.restaurantKey ?? options.expectedHost,
          menuNumber: input.payload.menuNumber,
          name: input.payload.name,
          description: input.payload.description,
          ingredients: input.payload.ingredients,
        });
        if (!gated.ok) {
          return {
            outcome: "FAILED" as const,
            error:
              gated.failure ??
              "LABEL_QUALITY_REVIEW: correct name/ingredients before update",
          };
        }
        await page.goto(
          new URL(`/admin/menu/${input.databaseId}/edit`, baseUrl).toString(),
          { waitUntil: "domcontentloaded" },
        );
        await dismissKnownCookieBanner(page);
        const form = page.locator("form:has(#menu_number)");
        await form.locator("#name").fill(gated.name.slice(0, 120));
        await form
          .locator("#description")
          .fill(gated.description.slice(0, 2000));
        await replaceIngredientRows(page, gated.ingredients.slice(0, 40));

        const observed = await clickOpdaterAndObserveUpdate({
          page,
          databaseId: input.databaseId,
          timeoutMs: 25_000,
        });
        if (!observed.ok) {
          return {
            outcome: "FAILED" as const,
            error: `${observed.code}${observed.detail ? `: ${observed.detail}` : ""}`,
          };
        }
        if (observed.response.status >= 400) {
          return {
            outcome: "FAILED" as const,
            error: `Opdater HTTP ${observed.response.status}`,
          };
        }
        catalog = [];
        return { outcome: "UPDATED" as const };
      } catch (err) {
        return {
          outcome: "FAILED" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

async function replaceIngredientRows(
  page: Page,
  ingredients: string[],
): Promise<void> {
  const form = page.locator("form:has(#menu_number)");
  const rows = form.locator("#ingredient-list tr.ingredient-form");
  const count = await rows.count();
  for (let i = 0; i < Math.max(count, ingredients.length); i++) {
    if (i >= ingredients.length) {
      const nameInput = rows.nth(i).locator("input.ingredient-name");
      if (await nameInput.count()) await nameInput.fill("");
      continue;
    }
    if (i >= count) {
      const addBtn = form.locator(
        'button:has-text("Tilføj"), a:has-text("Tilføj ingredient"), button:has-text("Add")',
      ).first();
      if (await addBtn.count()) await addBtn.click();
      await page.waitForTimeout(200);
    }
    await form
      .locator("#ingredient-list tr.ingredient-form")
      .nth(i)
      .locator("input.ingredient-name")
      .fill(ingredients[i]!);
  }
}
