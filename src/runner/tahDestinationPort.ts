/**
 * Playwright-backed DestinationPort wrapping certified TahAdminAdapterV1 writes.
 */
import type { Page } from "playwright";
import { TahAdminAdapterV1 } from "../tah/adapters/v1/adapter.js";
import { V1_ROUTES } from "../tah/adapters/v1/selectors.js";
import { clickSkabAndObserveCreate } from "../tah/write/createRequestObserve.js";
import {
  assertActiveUnchecked,
  fillInactiveProductCreateForm,
} from "../tah/write/formFill.js";
import { dismissKnownCookieBanner } from "../tah/write/submitInteractability.js";
import {
  matchDestinationByEvidence,
  resolveDestinationIdentity,
  type DestinationMatchResult,
  type DestinationPort,
  type DestinationProduct,
} from "./executor.js";
import type { PlannedProductPayload, ProductIdentityKey } from "./writePlan.js";

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

        // Identity check against current catalog
        const evidenceMatch = matchDestinationByEvidence(catalog, {
          menuNumber: payload.menuNumber,
          name: payload.name,
        });
        if (evidenceMatch.outcome === "AMBIGUOUS") {
          return { outcome: "AMBIGUOUS" as const };
        }
        if (evidenceMatch.outcome === "FOUND") {
          return {
            outcome: "CREATED" as const,
            databaseId: evidenceMatch.product.databaseId,
          };
        }

        const { page, baseUrl } = options;
        await page.goto(new URL(V1_ROUTES.menuCreate, baseUrl).toString(), {
          waitUntil: "domcontentloaded",
        });
        await dismissKnownCookieBanner(page);
        await fillInactiveProductCreateForm(page, {
          menuNumber: payload.menuNumber,
          name: payload.name,
          description: payload.description,
          basePriceKr: oreToKrString(payload.basePriceOre),
          categoryDatabaseId: categoryId,
          variants: payload.variants.map((v) => ({
            name: v.name,
            priceKr: oreToKrString(v.surchargeOre),
          })),
          ingredients: payload.ingredients,
          additions: payload.additions.map((a) => ({
            name: a.name,
            priceKr: oreToKrString(a.priceOre),
          })),
        });
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
        if (observed.response.status >= 400) {
          return {
            outcome: "FAILED" as const,
            error: `CREATE_RESPONSE_ERROR status=${observed.response.status}`,
          };
        }

        await page.waitForTimeout(1000);
        await refreshCatalogFromList();
        const found = catalog.find(
          (p) =>
            p.name.trim().toLowerCase() === payload.name.trim().toLowerCase() &&
            p.menuNumber.trim() === payload.menuNumber.trim(),
        );
        if (!found) {
          return {
            outcome: "FAILED" as const,
            error: "createHiddenProduct read-back missing product",
          };
        }
        sourceIdMap.set(payload.sourceId, found.databaseId);
        return { outcome: "CREATED" as const, databaseId: found.databaseId };
      } catch (err) {
        return {
          outcome: "FAILED" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
