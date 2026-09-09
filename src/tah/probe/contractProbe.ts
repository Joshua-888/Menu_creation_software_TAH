import type { Page } from "playwright";
import {
  ADMIN_CONTRACT_V1,
  type DetailedProbeResult,
  type ProbeCheckStatus,
} from "../contracts/v1.js";
import { V1_SELECTORS } from "../adapters/v1/selectors.js";

export type ProbeOptions = {
  page: Page;
  baseUrl: string;
  expectedHost?: string;
  expectedRestaurantName?: string;
  /** When true, open /admin/menu/create for field detection then leave without submit. */
  inspectCreateForm?: boolean;
};

function passFail(ok: boolean): ProbeCheckStatus {
  return ok ? "PASS" : "FAIL";
}

/**
 * Read-only contract probe. Never clicks Skab/Opdater/Slet or submits menu forms.
 */
export async function probeAdminContract(
  options: ProbeOptions,
): Promise<DetailedProbeResult> {
  const { page, baseUrl } = options;
  const details: string[] = [];
  const mismatches: string[] = [];
  const expectedHost =
    options.expectedHost ??
    (() => {
      try {
        return new URL(baseUrl).host;
      } catch {
        return undefined;
      }
    })();

  const menuUrl = new URL(ADMIN_CONTRACT_V1.routes.menuList, baseUrl).toString();
  await page.goto(menuUrl, { waitUntil: "domcontentloaded" });

  const actualHost = new URL(page.url()).host;
  const onLogin = /\/login/i.test(page.url());
  const authentication: ProbeCheckStatus = passFail(!onLogin);
  if (onLogin) mismatches.push("not_authenticated");

  let restaurantContext: ProbeCheckStatus = "UNKNOWN";
  if (expectedHost) {
    restaurantContext = passFail(
      actualHost.toLowerCase() === expectedHost.toLowerCase(),
    );
    if (restaurantContext === "FAIL") {
      mismatches.push(
        `restaurant_host_mismatch:expected=${expectedHost}:actual=${actualHost}`,
      );
    } else {
      details.push(`restaurant_host_ok:${actualHost}`);
    }
  }

  const menuPage: ProbeCheckStatus = passFail(
    /\/admin\/menu\/?(\?|$)/i.test(page.url()) ||
      (await page.getByRole("heading", { name: /^Menu$/i }).count()) > 0,
  );
  if (menuPage === "FAIL") mismatches.push("menu_page_not_reachable");

  const categoryFilterCount = await page.locator(V1_SELECTORS.categoryFilter).count();
  const categoryListing: ProbeCheckStatus = passFail(categoryFilterCount > 0);
  if (categoryListing === "FAIL") mismatches.push("category_filter_missing");

  // Product listing structure: table headers present even if 0 rows
  const headers = await page.locator("table thead th").allTextContents();
  const normalizedHeaders = headers.map((h) => h.trim()).filter(Boolean);
  const productListing: ProbeCheckStatus = passFail(
    normalizedHeaders.includes("Navn") &&
      normalizedHeaders.includes("Pris") &&
      normalizedHeaders.includes("Handlinger"),
  );
  if (productListing === "FAIL") mismatches.push("product_table_headers_missing");
  else details.push(`product_table_headers:${normalizedHeaders.join("|")}`);

  // Version marker
  const bodyVersion = await page
    .locator("body")
    .getAttribute("data-admin-contract-version");
  const adminVersion =
    bodyVersion ?? ADMIN_CONTRACT_V1.adminVersionMarker;
  if (!bodyVersion) {
    details.push("ADMIN_VERSION_MARKER_NOT_FOUND");
  }

  let menuNumberField: ProbeCheckStatus = "UNKNOWN";
  let nameField: ProbeCheckStatus = "UNKNOWN";
  let descriptionField: ProbeCheckStatus = "UNKNOWN";
  let ingredientsField: ProbeCheckStatus = "UNKNOWN";
  let basePriceField: ProbeCheckStatus = "UNKNOWN";
  let categoryField: ProbeCheckStatus = "UNKNOWN";
  let variantStructure: ProbeCheckStatus = "UNKNOWN";
  let addonStructure: ProbeCheckStatus = "UNKNOWN";
  let activeField: ProbeCheckStatus = "UNKNOWN";
  let saveControlDetected: ProbeCheckStatus = "UNKNOWN";
  let productEditRoute: ProbeCheckStatus = "UNKNOWN";

  if (options.inspectCreateForm !== false) {
    const createUrl = new URL(
      ADMIN_CONTRACT_V1.routes.menuCreate,
      baseUrl,
    ).toString();
    await page.goto(createUrl, { waitUntil: "domcontentloaded" });

    // Ensure we did not land on login
    if (/\/login/i.test(page.url())) {
      mismatches.push("lost_auth_on_create_navigation");
    }

    menuNumberField = passFail(
      (await page.locator(V1_SELECTORS.menuNumber).count()) > 0,
    );
    nameField = passFail(
      (await page.locator(V1_SELECTORS.productName).count()) > 0 ||
        (await page.getByLabel(/^Navn/i).count()) > 0,
    );
    descriptionField = passFail(
      (await page.locator(V1_SELECTORS.description).count()) > 0,
    );
    basePriceField = passFail(
      (await page.locator(V1_SELECTORS.basePrice).count()) > 0,
    );
    categoryField = passFail(
      (await page.locator(V1_SELECTORS.categoryCheckboxes).count()) > 0,
    );
    variantStructure = passFail(
      (await page.locator(V1_SELECTORS.variantList).count()) > 0 &&
        (await page.locator(V1_SELECTORS.addVariant).count()) > 0,
    );
    ingredientsField = passFail(
      (await page.locator(V1_SELECTORS.ingredientList).count()) > 0 &&
        (await page.locator(V1_SELECTORS.addIngredient).count()) > 0,
    );
    addonStructure = passFail(
      (await page.locator(V1_SELECTORS.additionList).count()) > 0 &&
        (await page.locator(V1_SELECTORS.addAddition).count()) > 0,
    );
    activeField = passFail((await page.locator(V1_SELECTORS.active).count()) > 0);
    saveControlDetected = passFail(
      (await page.getByRole("button", { name: /^Skab$/i }).count()) > 0,
    );

    // Product edit route: pattern documented; live product may be absent
    productEditRoute = passFail(
      Boolean(ADMIN_CONTRACT_V1.routes.menuEditPattern.includes("{databaseId}")),
    );
    details.push(
      "product_edit_route_pattern:/admin/menu/{databaseId}/edit (empty menus yield 404 for missing ids)",
    );

    for (const [name, status] of Object.entries({
      menuNumberField,
      nameField,
      descriptionField,
      ingredientsField,
      basePriceField,
      categoryField,
      variantStructure,
      addonStructure,
      activeField,
      saveControlDetected,
    })) {
      if (status === "FAIL") mismatches.push(`missing_${name}`);
    }

    // Leave create page without submitting — navigate away
    await page.goto(menuUrl, { waitUntil: "domcontentloaded" });
  }

  // Categories page
  await page.goto(
    new URL(ADMIN_CONTRACT_V1.routes.categoriesList, baseUrl).toString(),
    { waitUntil: "domcontentloaded" },
  );
  const catHeaders = await page.locator("table thead th").allTextContents();
  if (!catHeaders.some((h) => /Navn/i.test(h))) {
    mismatches.push("category_listing_headers_missing");
  } else {
    details.push("category_listing_ok");
  }

  const criticalFails = [
    authentication,
    menuPage,
    menuNumberField,
    nameField,
    basePriceField,
    variantStructure,
  ].filter((s) => s === "FAIL").length;

  let contractStatus: DetailedProbeResult["contractStatus"] = "CONTRACT_MATCH";
  if (authentication === "FAIL") {
    contractStatus = "UNKNOWN";
  } else if (criticalFails > 0 || mismatches.length > 0) {
    contractStatus = "CONTRACT_DRIFT";
  }

  // Soft: missing version marker alone does not force DRIFT (documented as NOT_FOUND)
  if (
    contractStatus === "CONTRACT_DRIFT" &&
    mismatches.every((m) => m.startsWith("restaurant_host"))
  ) {
    // keep DRIFT for wrong restaurant
  }

  const result: DetailedProbeResult = {
    authentication,
    restaurantContext,
    menuPage,
    categoryListing,
    productListing,
    productEditRoute,
    menuNumberField,
    nameField,
    descriptionField,
    ingredientsField,
    basePriceField,
    categoryField,
    variantStructure,
    addonStructure,
    activeField,
    saveControlDetected,
    adminVersion,
    contractStatus,
    details,
    mismatches,
  };
  if (expectedHost !== undefined) result.expectedHost = expectedHost;
  result.actualHost = actualHost;
  return result;
}

/**
 * Pure evaluator for fixture-based tests (no browser).
 */
export function evaluateProbeFromFlags(input: {
  authentication: ProbeCheckStatus;
  restaurantContext: ProbeCheckStatus;
  flags: Partial<
    Record<
      Exclude<
        keyof DetailedProbeResult,
        | "authentication"
        | "restaurantContext"
        | "adminVersion"
        | "contractStatus"
        | "details"
        | "mismatches"
        | "expectedHost"
        | "actualHost"
      >,
      ProbeCheckStatus
    >
  >;
  adminVersion?: string;
  mismatches?: string[];
}): DetailedProbeResult {
  const mismatches = [...(input.mismatches ?? [])];
  const flags = input.flags;
  const critical = [
    input.authentication,
    flags.menuPage,
    flags.menuNumberField,
    flags.nameField,
    flags.basePriceField,
    flags.variantStructure,
  ];
  for (const [k, v] of Object.entries(flags)) {
    if (v === "FAIL") mismatches.push(`missing_${k}`);
  }
  if (input.authentication === "FAIL") mismatches.push("not_authenticated");

  let contractStatus: DetailedProbeResult["contractStatus"] = "CONTRACT_MATCH";
  if (input.authentication === "FAIL") contractStatus = "UNKNOWN";
  else if (critical.some((s) => s === "FAIL") || mismatches.length > 0) {
    contractStatus = "CONTRACT_DRIFT";
  }

  return {
    authentication: input.authentication,
    restaurantContext: input.restaurantContext,
    menuPage: flags.menuPage ?? "UNKNOWN",
    categoryListing: flags.categoryListing ?? "UNKNOWN",
    productListing: flags.productListing ?? "UNKNOWN",
    productEditRoute: flags.productEditRoute ?? "UNKNOWN",
    menuNumberField: flags.menuNumberField ?? "UNKNOWN",
    nameField: flags.nameField ?? "UNKNOWN",
    descriptionField: flags.descriptionField ?? "UNKNOWN",
    ingredientsField: flags.ingredientsField ?? "UNKNOWN",
    basePriceField: flags.basePriceField ?? "UNKNOWN",
    categoryField: flags.categoryField ?? "UNKNOWN",
    variantStructure: flags.variantStructure ?? "UNKNOWN",
    addonStructure: flags.addonStructure ?? "UNKNOWN",
    activeField: flags.activeField ?? "UNKNOWN",
    saveControlDetected: flags.saveControlDetected ?? "UNKNOWN",
    adminVersion: input.adminVersion ?? ADMIN_CONTRACT_V1.adminVersionMarker,
    contractStatus,
    details: [],
    mismatches,
  };
}

export function parseDatabaseIdFromPath(
  pathOrUrl: string,
  kind: "menu" | "categories",
): string | null {
  const path = pathOrUrl.replace(/^https?:\/\/[^/]+/i, "");
  const re =
    kind === "menu"
      ? /\/admin\/menu\/(\d+)(?:\/edit)?\/?$/i
      : /\/admin\/categories\/(\d+)(?:\/edit)?\/?$/i;
  const match = re.exec(path);
  return match?.[1] ?? null;
}

export function isMenuNumberSameAsDatabaseId(
  menuNumber: string,
  databaseId: string,
): boolean {
  return menuNumber.trim() === databaseId.trim();
}
