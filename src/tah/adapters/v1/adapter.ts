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
import {
  parseDatabaseIdFromPath,
  probeAdminContract,
} from "../../probe/contractProbe.js";
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
  active: boolean | null;
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

    return page.evaluate(() => {
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
    });
  }

  async listProducts(): Promise<DestinationProductListItem[]> {
    const { page, baseUrl } = this.options;
    await page.goto(new URL(V1_ROUTES.menuList, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });

    return page.evaluate(() => {
      const rows = [...document.querySelectorAll("table tbody tr")];
      return rows.map((tr) => {
        const cells = [...tr.querySelectorAll("td")];
        const cellText = (td: Element | undefined) =>
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
    });
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
    const editPath = menuEditPath(destinationId);
    const response = await page.goto(new URL(editPath, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    if (response && response.status() === 404) {
      throw new Error(`Product databaseId ${destinationId} not found (404)`);
    }

    const data = await page.evaluate((selectors) => {
      const form =
        (document.querySelector(selectors.productUpdateForm) as HTMLFormElement | null) ||
        (document.querySelector("#menu_number")?.closest("form") as HTMLFormElement | null);
      const root: ParentNode = form || document;

      const val = (sel: string) => {
        const el = root.querySelector(sel) as HTMLInputElement | null;
        return el ? el.value : null;
      };
      const checked = (sel: string) => {
        const el = root.querySelector(sel) as HTMLInputElement | null;
        return el ? el.checked : null;
      };
      const categoryIds = [
        ...root.querySelectorAll(selectors.categoryCheckboxes),
      ]
        .filter((el) => (el as HTMLInputElement).checked)
        .map((el) => {
          const id = el.id || "";
          const m = /category-(\d+)/i.exec(id);
          return m?.[1] || (el as HTMLInputElement).value;
        });

      const variants = [...root.querySelectorAll("tr.variant-form")].map(
        (tr, index) => ({
          databaseId:
            (
              tr.querySelector('input[name*="[id]"]') as HTMLInputElement | null
            )?.value || null,
          name:
            (tr.querySelector("input.variant-name") as HTMLInputElement | null)
              ?.value || "",
          priceRaw:
            (tr.querySelector("input.variant-price") as HTMLInputElement | null)
              ?.value || "",
          index,
        }),
      );
      const ingredients = [
        ...root.querySelectorAll("tr.ingredient-form"),
      ].map((tr, index) => ({
        databaseId:
          (
            tr.querySelector('input[name*="[id]"]') as HTMLInputElement | null
          )?.value || null,
        name:
          (
            tr.querySelector("input.ingredient-name") as HTMLInputElement | null
          )?.value || "",
        index,
      }));
      const additions = [...root.querySelectorAll("tr.addition-form")].map(
        (tr, index) => ({
          databaseId:
            (
              tr.querySelector('input[name*="[id]"]') as HTMLInputElement | null
            )?.value || null,
          name:
            (
              tr.querySelector("input.addition-name") as HTMLInputElement | null
            )?.value || "",
          priceRaw:
            (
              tr.querySelector("input.addition-price") as HTMLInputElement | null
            )?.value || "",
          index,
        }),
      );

      const methodOverride =
        (
          form?.querySelector(
            'input[name="_method"]',
          ) as HTMLInputElement | null
        )?.value || null;
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
    }, V1_SELECTORS);

    return {
      databaseId: destinationId,
      editPath,
      menuNumber: normalizeWhitespace(data.menuNumber),
      name: normalizeWhitespace(data.name),
      description: normalizeWhitespace(data.description),
      basePriceRaw: data.basePriceRaw,
      basePriceOre: parseAdminPriceToOre(data.basePriceRaw),
      active: checkboxToBoolean(data.active),
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

  async createCategory(_input: { name: string }): Promise<{ destinationId: string }> {
    throw mutationBlocked("createCategory");
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
