import type { Page } from "playwright";
import type { CanonicalProduct } from "../../../domain/schema/canonical.js";
import type {
  AdminAdapterLifecycle,
  ContractProbeResult,
  TahAdminAdapter,
} from "../../types.js";
import { ADMIN_CONTRACT_V1 } from "../../contracts/v1.js";
import {
  parseDatabaseIdFromPath,
  probeAdminContract,
} from "../../probe/contractProbe.js";
import { V1_ROUTES, V1_SELECTORS } from "./selectors.js";

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
  priceText: string | null;
  statusText: string | null;
  editPath: string | null;
};

export type DestinationProduct = {
  databaseId: string;
  menuNumber: string | null;
  name: string | null;
  description: string | null;
  basePrice: string | null;
  active: boolean | null;
  categoryIds: string[];
  variants: Array<{ name: string; price: string }>;
  ingredients: Array<{ name: string }>;
  additions: Array<{ name: string; price: string }>;
  editPath: string;
};

export type V1AdapterOptions = {
  page: Page;
  baseUrl: string;
  expectedHost?: string;
};

function mutationBlocked(op: string): Error {
  return new Error(
    `ADMIN_WRITE_BLOCKED: ${op} is not implemented in Milestone 2 (read-only). Writes start only in Milestone 3 against a canary.`,
  );
}

/**
 * TakeAwayHero Admin adapter v1 — READ-ONLY for Milestone 2.
 */
export class TahAdminAdapterV1 implements TahAdminAdapter {
  readonly version = "1.0.0";
  lifecycle: AdminAdapterLifecycle = "DEVELOPMENT";

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
        const cells = [...tr.querySelectorAll("td")].map((td) =>
          (td.textContent || "").replace(/\s+/g, " ").trim(),
        );
        const editAnchor = [...tr.querySelectorAll("a[href]")].find((a) =>
          /\/admin\/menu\/\d+/i.test(a.getAttribute("href") || ""),
        );
        const editPath = (editAnchor?.getAttribute("href") || "").replace(
          /^https?:\/\/[^/]+/i,
          "",
        );
        const idMatch = /\/admin\/menu\/(\d+)/i.exec(editPath);
        return {
          databaseId: idMatch?.[1] ?? null,
          menuNumber: cells[0] || null,
          name: cells[2] || cells[1] || "",
          priceText: cells.find((c, i) => i >= 3 && /\d/.test(c)) || null,
          statusText: cells.length >= 6 ? cells[cells.length - 2] ?? null : null,
          editPath: editPath || null,
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
    const editPath = `/admin/menu/${destinationId}/edit`;
    const response = await page.goto(new URL(editPath, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    if (response && response.status() === 404) {
      throw new Error(`Product databaseId ${destinationId} not found (404)`);
    }

    const data = await page.evaluate((selectors) => {
      const val = (sel: string) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        return el ? el.value : null;
      };
      const checked = (sel: string) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        return el ? el.checked : null;
      };
      const categoryIds = [
        ...document.querySelectorAll(selectors.categoryCheckboxes),
      ]
        .filter((el) => (el as HTMLInputElement).checked)
        .map((el) => {
          const id = el.id || "";
          const m = /category-(\d+)/i.exec(id);
          return m?.[1] || (el as HTMLInputElement).value;
        });
      const variants = [...document.querySelectorAll("tr.variant-form")].map(
        (tr) => ({
          name:
            (tr.querySelector("input.variant-name") as HTMLInputElement | null)
              ?.value || "",
          price:
            (tr.querySelector("input.variant-price") as HTMLInputElement | null)
              ?.value || "",
        }),
      );
      const ingredients = [
        ...document.querySelectorAll("tr.ingredient-form"),
      ].map((tr) => ({
        name:
          (
            tr.querySelector("input.ingredient-name") as HTMLInputElement | null
          )?.value || "",
      }));
      const additions = [...document.querySelectorAll("tr.addition-form")].map(
        (tr) => ({
          name:
            (
              tr.querySelector("input.addition-name") as HTMLInputElement | null
            )?.value || "",
          price:
            (
              tr.querySelector("input.addition-price") as HTMLInputElement | null
            )?.value || "",
        }),
      );
      return {
        menuNumber: val(selectors.menuNumber),
        name: val(selectors.productName),
        description: val(selectors.description),
        basePrice: val(selectors.basePrice),
        active: checked(selectors.active),
        categoryIds,
        variants,
        ingredients,
        additions,
      };
    }, V1_SELECTORS);

    return {
      databaseId: destinationId,
      editPath,
      ...data,
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

export { parseDatabaseIdFromPath };
