import type { Page } from "playwright";
import type { CanonicalProduct } from "../../../domain/schema/canonical.js";
import type {
  AdminAdapterLifecycle,
  ContractProbeResult,
  TahAdminAdapter,
} from "../../types.js";
import { ADMIN_CONTRACT_V1 } from "../../contracts/v1.js";
import { M2B_ADAPTER_CAPABILITIES } from "../../contracts/evidence.js";
import {
  checkboxToBoolean,
  normalizeWhitespace,
  parseAdminPriceToOre,
} from "../../normalize/destination.js";
import { interpretActiveState } from "../../contracts/activeSemantics.js";
import {
  parseDatabaseIdFromPath,
  probeAdminContract,
} from "../../probe/contractProbe.js";
import {
  clickSkabAndObserveCategoryCreate,
  isTahCanaryCategoryName,
} from "../../write/categoryCreateObserve.js";
import {
  interpretCategoryDeleteReadBack,
  postCategoryDelete,
} from "../../write/categoryDeleteObserve.js";
import {
  assertPageIsAllowlistedAdmin,
} from "../../write/formFill.js";
import {
  extractCategoryRows,
  extractProductEdit,
  extractProductListRows,
} from "./pageScripts.mjs";
import { menuEditPath, V1_ROUTES, V1_SELECTORS } from "./selectors.js";

export type DestinationCategory = {
  databaseId: string;
  name: string;
  order: number | null;
  itemCount: number | null;
  editPath: string;
};

export type DestinationProductListItem = {
  databaseId: string | null;
  menuNumber: string | null;
  name: string;
  categoryText: string | null;
  priceText: string | null;
  statusText: string | null;
  editPath: string | null;
  showPath: string | null;
};

export type DestinationVariant = {
  databaseId: string | null;
  name: string;
  priceRaw: string;
  priceOre: number | null;
  /** Contract semantics: SURCHARGE over base when certified. */
  index: number;
};

export type DestinationIngredient = {
  databaseId: string | null;
  name: string;
  index: number;
};

export type DestinationAddition = {
  databaseId: string | null;
  name: string;
  priceRaw: string;
  priceOre: number | null;
  index: number;
};

export type DestinationProduct = {
  databaseId: string;
  menuNumber: string | null;
  name: string | null;
  description: string | null;
  basePriceRaw: string | null;
  basePriceOre: number | null;
  /**
   * Raw edit-form #active checkbox (DOM checked) = EDIT_CONTROL_STATE only.
   * Not storefront visibility; Opdater submit required to persist (HUMAN_CONFIRMED).
   */
  activeCheckbox: boolean | null;
  /**
   * Customer-availability interpretation when scoped semantics allow;
   * null when UNKNOWN / unsafe to infer from checkbox alone.
   * Prefer list / storefront over temporary DOM checkbox.
   */
  active: boolean | null;
  activeSemantics: string;
  listAvailability?: "AVAILABLE" | "HIDDEN" | "UNKNOWN";
  categoryIds: string[];
  variants: DestinationVariant[];
  ingredients: DestinationIngredient[];
  additions: DestinationAddition[];
  editPath: string;
  formAction: string | null;
  formMethod: string | null;
  formMethodOverride: string | null;
  hasExistingImageHint: boolean;
};

export type V1AdapterOptions = {
  page: Page;
  baseUrl: string;
  expectedHost?: string;
};

function mutationBlocked(op: string): Error {
  return new Error(
    `ADMIN_WRITE_BLOCKED: ${op} is not implemented in Milestone 2B (read-only). Writes start only in Milestone 3 against a canary.`,
  );
}

/**
 * TakeAwayHero Admin adapter v1 — READ certified (M2B); WRITE blocked.
 */
export class TahAdminAdapterV1 implements TahAdminAdapter {
  readonly version = "1.0.0";
  lifecycle: AdminAdapterLifecycle = "DEVELOPMENT";
  readonly capabilities = M2B_ADAPTER_CAPABILITIES;

  constructor(private readonly options: V1AdapterOptions) {}

  async detectVersion(): Promise<string | null> {
    const { page, baseUrl } = this.options;
    await page.goto(new URL(V1_ROUTES.menuList, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    const attr = await page
      .locator("body")
      .getAttribute("data-admin-contract-version");
    return attr;
  }

  async probeContract(): Promise<ContractProbeResult> {
    const detailed = await probeAdminContract({
      page: this.options.page,
      baseUrl: this.options.baseUrl,
      ...(this.options.expectedHost
        ? { expectedHost: this.options.expectedHost }
        : {}),
      inspectCreateForm: true,
      inspectEditForm: true,
    });

    if (detailed.contractStatus === "CONTRACT_MATCH") {
      return {
        status: "CONTRACT_MATCH",
        contractVersion: ADMIN_CONTRACT_V1.version,
        details: detailed.details,
      };
    }
    if (detailed.contractStatus === "UNKNOWN") {
      return {
        status: "ADMIN_CONTRACT_DRIFT",
        expectedVersion: ADMIN_CONTRACT_V1.version,
        detectedVersion: null,
        mismatches: ["UNKNOWN", ...detailed.mismatches],
      };
    }
    return {
      status: "ADMIN_CONTRACT_DRIFT",
      expectedVersion: ADMIN_CONTRACT_V1.version,
      detectedVersion:
        detailed.adminVersion === ADMIN_CONTRACT_V1.adminVersionMarker
          ? null
          : detailed.adminVersion,
      mismatches: detailed.mismatches,
    };
  }

  async listCategories(): Promise<DestinationCategory[]> {
    const { page, baseUrl } = this.options;
    await page.goto(new URL(V1_ROUTES.categoriesList, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    return page.evaluate(extractCategoryRows);
  }

  async listProducts(): Promise<DestinationProductListItem[]> {
    const { page, baseUrl } = this.options;
    const all: DestinationProductListItem[] = [];
    const seen = new Set<string>();
    for (let pageNum = 1; pageNum <= 20; pageNum++) {
      const url =
        pageNum === 1
          ? new URL(V1_ROUTES.menuList, baseUrl).toString()
          : new URL(
              `${V1_ROUTES.menuList}?page=${pageNum}`,
              baseUrl,
            ).toString();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const rows = await page.evaluate(extractProductListRows);
      let newOnPage = 0;
      for (const row of rows) {
        const key = row.databaseId || `${row.menuNumber}:${row.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row);
        newOnPage += 1;
      }
      if (rows.length === 0 || newOnPage === 0) break;
      // Stop when no "Next" pagination control remains
      const hasNext = await page.evaluate(`(() => {
        const links = [...document.querySelectorAll("a")];
        return links.some((a) => /next|næste|»/i.test((a.textContent || "").trim()));
      })()`);
      if (!hasNext) break;
    }
    return all;
  }

  async findProduct(query: {
    menuNumber?: string;
    name?: string;
  }): Promise<DestinationProductListItem | null> {
    const products = await this.listProducts();
    return (
      products.find((p) => {
        if (
          query.menuNumber !== undefined &&
          p.menuNumber?.trim() === query.menuNumber.trim()
        ) {
          return true;
        }
        if (
          query.name !== undefined &&
          p.name.trim().toLowerCase() === query.name.trim().toLowerCase()
        ) {
          return true;
        }
        return false;
      }) ?? null
    );
  }

  async readProduct(destinationId: string): Promise<DestinationProduct> {
    const { page, baseUrl } = this.options;
    const host = (() => {
      try {
        return new URL(baseUrl).host;
      } catch {
        return undefined;
      }
    })();

    // List status is often a stronger availability signal than edit #active
    // (M3D Veroni: Skjult + public absent while #active is server-checked).
    const listRows = await this.listProducts();
    const listRow = listRows.find((p) => p.databaseId === destinationId);
    const listStatusText = listRow?.statusText ?? null;

    const editPath = menuEditPath(destinationId);
    const response = await page.goto(new URL(editPath, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    if (response && response.status() === 404) {
      throw new Error(`Product databaseId ${destinationId} not found (404)`);
    }

    const data = await page.evaluate(extractProductEdit, {
      productUpdateForm: V1_SELECTORS.productUpdateForm,
      menuNumber: V1_SELECTORS.menuNumber,
      productName: V1_SELECTORS.productName,
      description: V1_SELECTORS.description,
      basePrice: V1_SELECTORS.basePrice,
      active: V1_SELECTORS.active,
      categoryCheckboxes: V1_SELECTORS.categoryCheckboxes,
    });

    const activeCheckbox = checkboxToBoolean(data.active);
    const interpreted = interpretActiveState({
      ...(host ? { host } : {}),
      activeCheckbox,
      listStatusText,
    });

    return {
      databaseId: destinationId,
      editPath,
      menuNumber: normalizeWhitespace(data.menuNumber),
      name: normalizeWhitespace(data.name),
      description: normalizeWhitespace(data.description),
      basePriceRaw: data.basePriceRaw,
      basePriceOre: parseAdminPriceToOre(data.basePriceRaw),
      activeCheckbox,
      active: interpreted.customerAvailable,
      activeSemantics: interpreted.semantics.value,
      listAvailability: interpreted.listAvailability,
      categoryIds: data.categoryIds,
      variants: data.variants.map((v) => ({
        ...v,
        name: normalizeWhitespace(v.name) || "",
        priceOre: parseAdminPriceToOre(v.priceRaw),
      })),
      ingredients: data.ingredients.map((i) => ({
        ...i,
        name: normalizeWhitespace(i.name) || "",
      })),
      additions: data.additions.map((a) => ({
        ...a,
        name: normalizeWhitespace(a.name) || "",
        priceOre: parseAdminPriceToOre(a.priceRaw),
      })),
      formAction: data.formAction,
      formMethod: data.formMethod,
      formMethodOverride: data.formMethodOverride,
      hasExistingImageHint: data.hasExistingImageHint,
    };
  }

  async createCategory(input: {
    name: string;
    order?: number;
    allowCustomerCategory?: boolean;
  }): Promise<{ destinationId: string }> {
    if (this.capabilities.write.createCategory !== "CERTIFIED") {
      throw mutationBlocked("createCategory");
    }
    const name = input.name.trim();
    if (!name) {
      throw new Error("ADMIN_WRITE_BLOCKED: createCategory requires a non-empty name");
    }
    if (!isTahCanaryCategoryName(name) && !input.allowCustomerCategory) {
      throw new Error(
        "ADMIN_WRITE_BLOCKED: createCategory refuses non-canary names unless allowCustomerCategory: true",
      );
    }

    const { page, baseUrl } = this.options;

    const before = await this.listCategories();
    const preexisting = before.find(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (preexisting?.databaseId) {
      return { destinationId: preexisting.databaseId };
    }

    await page.goto(new URL("/admin/categories/create", baseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    await assertPageIsAllowlistedAdmin(
      page,
      this.options.expectedHost ?? new URL(baseUrl).hostname,
    );

    const observed = await clickSkabAndObserveCategoryCreate({
      page,
      name,
      order: input.order ?? 10,
    });
    if (!observed.ok) {
      throw new Error(
        `ADMIN_WRITE_BLOCKED: createCategory failed (${observed.code}${
          observed.detail ? `: ${observed.detail}` : ""
        })`,
      );
    }
    if (observed.response.status >= 400) {
      throw new Error(
        `ADMIN_WRITE_BLOCKED: createCategory HTTP ${observed.response.status}`,
      );
    }

    const after = await this.listCategories();
    const found = after.find(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (!found?.databaseId) {
      throw new Error(
        "ADMIN_WRITE_BLOCKED: createCategory read-back missing destination id",
      );
    }
    return { destinationId: found.databaseId };
  }

  /**
   * Delete a category by exact database id.
   * Idempotent: if already absent before submit → VERIFIED_DELETED (no blind retry).
   * Success requires listCategories read-back proving absence.
   */
  async deleteCategory(input: {
    databaseId: string;
    allowCustomerCategory?: boolean;
  }): Promise<{ outcome: "VERIFIED_DELETED" | "DELETE_FAILED" | "AMBIGUOUS" }> {
    if (this.capabilities.write.deleteCategory !== "CERTIFIED") {
      throw mutationBlocked("deleteCategory");
    }
    const databaseId = String(input.databaseId ?? "").trim();
    if (!/^\d+$/.test(databaseId)) {
      throw new Error(
        "ADMIN_WRITE_BLOCKED: deleteCategory requires numeric databaseId",
      );
    }

    const { page, baseUrl } = this.options;
    await assertPageIsAllowlistedAdmin(
      page,
      this.options.expectedHost ?? new URL(baseUrl).hostname,
    );

    const before = await this.listCategories();
    const target = before.find((c) => c.databaseId === databaseId);
    if (!target) {
      // Already absent — idempotent success without submitting delete again
      return { outcome: "VERIFIED_DELETED" };
    }
    if (
      !isTahCanaryCategoryName(target.name) &&
      !input.allowCustomerCategory
    ) {
      throw new Error(
        "ADMIN_WRITE_BLOCKED: deleteCategory refuses non-canary categories unless allowCustomerCategory: true",
      );
    }

    const unrelatedBefore = before.filter((c) => c.databaseId !== databaseId);
    let responseStatus = 0;
    try {
      const posted = await postCategoryDelete({ page, baseUrl, databaseId });
      responseStatus = posted.status;
      if (posted.requestPath !== `/admin/categories/${databaseId}`) {
        throw new Error(
          `ADMIN_WRITE_BLOCKED: deleteCategory path mismatch (${posted.requestPath})`,
        );
      }
    } catch (e) {
      // Ambiguous transport — still read-back; never blind-retry
      const afterErr = await this.listCategories();
      const outcome = interpretCategoryDeleteReadBack({
        databaseId,
        categoriesAfter: afterErr,
        responseStatus: 0,
      });
      if (outcome === "VERIFIED_DELETED") return { outcome };
      throw e instanceof Error
        ? e
        : new Error(`ADMIN_WRITE_BLOCKED: deleteCategory failed: ${String(e)}`);
    }

    const after = await this.listCategories();
    const outcome = interpretCategoryDeleteReadBack({
      databaseId,
      categoriesAfter: after,
      responseStatus,
    });
    if (outcome === "VERIFIED_DELETED") {
      const unrelatedAfter = after.filter((c) => c.databaseId !== databaseId);
      const untouched =
        unrelatedBefore.length === unrelatedAfter.length &&
        unrelatedBefore.every((b) =>
          unrelatedAfter.some(
            (a) => a.databaseId === b.databaseId && a.name === b.name,
          ),
        );
      if (!untouched) {
        throw new Error(
          "ADMIN_WRITE_BLOCKED: deleteCategory read-back shows unrelated category drift",
        );
      }
    }
    return { outcome };
  }

  async createProduct(
    _input: CanonicalProduct,
  ): Promise<{ destinationId: string }> {
    throw mutationBlocked("createProduct");
  }
  async updateProduct(
    _destinationId: string,
    _input: CanonicalProduct,
  ): Promise<{ destinationId: string }> {
    throw mutationBlocked("updateProduct");
  }
  async verifyProduct(): Promise<{ ok: boolean; diff?: unknown }> {
    throw new Error("verifyProduct belongs to Milestone 3+ write/read-back");
  }
}

export { parseDatabaseIdFromPath, menuEditPath };
