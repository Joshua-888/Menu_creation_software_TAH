import { z } from "zod";

export const ADMIN_CONTRACT_VERSION = "1" as const;

export const LocatorTypeSchema = z.enum([
  "testId",
  "role",
  "label",
  "css",
  "id",
]);

export const SelectorSpecSchema = z.object({
  field: z.string(),
  type: LocatorTypeSchema,
  locator: z.string(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  stability: z.enum(["STABLE", "MODERATE", "FRAGILE"]),
  notes: z.string().optional(),
});

export type SelectorSpec = z.infer<typeof SelectorSpecSchema>;

export const ProbeCheckStatusSchema = z.enum(["PASS", "FAIL", "UNKNOWN"]);
export type ProbeCheckStatus = z.infer<typeof ProbeCheckStatusSchema>;

export const ContractStatusSchema = z.enum([
  "CONTRACT_MATCH",
  "CONTRACT_DRIFT",
  "UNKNOWN",
]);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const DetailedProbeResultSchema = z.object({
  authentication: ProbeCheckStatusSchema,
  restaurantContext: ProbeCheckStatusSchema,
  menuPage: ProbeCheckStatusSchema,
  categoryListing: ProbeCheckStatusSchema,
  productListing: ProbeCheckStatusSchema,
  productEditRoute: ProbeCheckStatusSchema,
  menuNumberField: ProbeCheckStatusSchema,
  nameField: ProbeCheckStatusSchema,
  descriptionField: ProbeCheckStatusSchema,
  ingredientsField: ProbeCheckStatusSchema,
  basePriceField: ProbeCheckStatusSchema,
  categoryField: ProbeCheckStatusSchema,
  variantStructure: ProbeCheckStatusSchema,
  addonStructure: ProbeCheckStatusSchema,
  activeField: ProbeCheckStatusSchema,
  saveControlDetected: ProbeCheckStatusSchema,
  adminVersion: z.string(),
  contractStatus: ContractStatusSchema,
  expectedHost: z.string().optional(),
  actualHost: z.string().optional(),
  details: z.array(z.string()).default([]),
  mismatches: z.array(z.string()).default([]),
});

export type DetailedProbeResult = z.infer<typeof DetailedProbeResultSchema>;

/**
 * AdminContract v1 — derived from read-only inspection of
 * https://veronipizza.dk/admin/menu (and create/categories routes).
 * Sanitized: no customer menu content.
 */
export const ADMIN_CONTRACT_V1 = {
  version: ADMIN_CONTRACT_VERSION,
  platform: "TakeAwayHero",
  adminVersionMarker: "ADMIN_VERSION_MARKER_NOT_FOUND" as const,
  routes: {
    login: "/login",
    dashboard: "/admin/dashboard",
    menuList: "/admin/menu",
    menuCreate: "/admin/menu/create",
    /** Laravel-style resource; verified pattern via categories; product edit 404 when ID missing. */
    menuEditPattern: "/admin/menu/{databaseId}/edit",
    categoriesList: "/admin/categories",
    categoryEditPattern: "/admin/categories/{databaseId}/edit",
    categoryShowPattern: "/admin/categories/{databaseId}",
  },
  idStrategy: {
    productDatabaseId:
      "Numeric path segment in /admin/menu/{id}/edit — NOT the visible menu_number field",
    categoryDatabaseId:
      "Numeric path segment in /admin/categories/{id}/edit and option/checkbox values",
    menuNumber:
      "Display string on #menu_number / name=menu_number; supports alphanumeric (placeholder fx. 27 eller 15A)",
    variantId: "DOM row id variant-{index}; form names variants[{i}][name|price] — index not durable DB id",
    ingredientId: "DOM row id ingredient-{index}; form names ingredients[{i}][name]",
    additionId: "DOM row id addition-{index}; form names additions[{i}][name|price] (Tilbehør)",
  },
  restaurantContext: {
    strategy: "hostname",
    notes:
      "Compare page hostname to expected restaurant host (e.g. veronipizza.dk). Login heading includes Restaurant Login for https://{host}.",
  },
  selectors: {
    menuNumber: {
      field: "menuNumber",
      type: "id",
      locator: "menu_number",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "Also getByLabel('Menunummer') / name=menu_number",
    },
    productName: {
      field: "productName",
      type: "label",
      locator: "Navn",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "#name name=name",
    },
    description: {
      field: "description",
      type: "label",
      locator: "Beskrivelse",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "#description textarea",
    },
    basePrice: {
      field: "basePrice",
      type: "label",
      locator: "Pris",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "#price name=price type=number step=.01",
    },
    categories: {
      field: "categories",
      type: "css",
      locator: "input[type='checkbox'][name='categories[]']",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "Ids category-{databaseId}",
    },
    categoryFilter: {
      field: "categoryFilter",
      type: "id",
      locator: "category",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "select#category on menu list",
    },
    variantList: {
      field: "variantStructure",
      type: "id",
      locator: "variant-list",
      confidence: "HIGH",
      stability: "STABLE",
    },
    addVariant: {
      field: "addVariant",
      type: "id",
      locator: "add-variant",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "type=button — detect only; do not click in production writes without care",
    },
    variantName: {
      field: "variantName",
      type: "css",
      locator: "input.variant-name[name^='variants[']",
      confidence: "HIGH",
      stability: "STABLE",
    },
    variantPrice: {
      field: "variantPrice",
      type: "css",
      locator: "input.variant-price[name^='variants[']",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "Appears to be absolute variant price on form, not necessarily surcharge UI",
    },
    ingredientList: {
      field: "ingredients",
      type: "id",
      locator: "ingredient-list",
      confidence: "HIGH",
      stability: "STABLE",
    },
    addIngredient: {
      field: "addIngredient",
      type: "id",
      locator: "add-ingredient",
      confidence: "HIGH",
      stability: "STABLE",
    },
    ingredientName: {
      field: "ingredientName",
      type: "css",
      locator: "input.ingredient-name[name^='ingredients[']",
      confidence: "HIGH",
      stability: "MODERATE",
      notes: "Rows added dynamically from #blueprint-ingredient",
    },
    additionList: {
      field: "addonStructure",
      type: "id",
      locator: "addition-list",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "Tilbehør uses additions[*] naming",
    },
    addAddition: {
      field: "addAddition",
      type: "id",
      locator: "add-addition",
      confidence: "HIGH",
      stability: "STABLE",
    },
    additionName: {
      field: "additionName",
      type: "css",
      locator: "input.addition-name[name^='additions[']",
      confidence: "HIGH",
      stability: "MODERATE",
    },
    additionPrice: {
      field: "additionPrice",
      type: "css",
      locator: "input.addition-price[name^='additions[']",
      confidence: "HIGH",
      stability: "MODERATE",
    },
    image: {
      field: "image",
      type: "id",
      locator: "image",
      confidence: "HIGH",
      stability: "STABLE",
    },
    active: {
      field: "active",
      type: "label",
      locator: "Aktiv?",
      confidence: "HIGH",
      stability: "STABLE",
      notes: "#active checkbox name=active value=1",
    },
    saveCreate: {
      field: "saveControl",
      type: "role",
      locator: "Skab",
      confidence: "HIGH",
      stability: "MODERATE",
      notes: "Create submit — DETECT ONLY in M2; never click",
    },
    saveUpdate: {
      field: "saveUpdate",
      type: "role",
      locator: "Opdater",
      confidence: "HIGH",
      stability: "MODERATE",
      notes: "Seen on category edit; product edit not live-verified (empty menu)",
    },
    menuCreateLink: {
      field: "menuCreateLink",
      type: "role",
      locator: "Tilføj",
      confidence: "HIGH",
      stability: "MODERATE",
    },
  } satisfies Record<string, SelectorSpec>,
  menuListColumns: ["#", "image", "Navn", "Kategorier", "Pris", "Status", "Handlinger"],
  categoryListColumns: ["Navn", "Rækkefølge", "Antal varer", "Handlinger"],
  notes: [
    "No data-testid attributes present on inspected pages.",
    "No data-admin-contract-version / machine-readable admin version marker found.",
    "Veroni menu listing had 0 product rows at discovery time — product edit/list actions not observed live.",
    "Variant price inputs look like absolute prices in UI; domain surcharge conversion remains in domain engine.",
    "CSRF via meta csrf-token and hidden _token — relevant for M3 writes only.",
  ],
} as const;

export type AdminContractV1 = typeof ADMIN_CONTRACT_V1;
