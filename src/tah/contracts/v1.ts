import { z } from "zod";
import type {
  BasePriceSemantics,
  ContractEvidenceLevel,
  VariantPriceSemantics,
} from "./evidence.js";
import { M2B_ADAPTER_CAPABILITIES } from "./evidence.js";

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
  evidence: z
    .enum(["OBSERVED", "TESTED", "INFERRED", "UNKNOWN"])
    .default("INFERRED"),
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

export type Evidenced<T> = {
  value: T;
  evidence: ContractEvidenceLevel;
  notes?: string;
};

function ev<T>(
  value: T,
  evidence: ContractEvidenceLevel,
  notes?: string,
): Evidenced<T> {
  return notes === undefined ? { value, evidence } : { value, evidence, notes };
}

/**
 * AdminContract v1 — Veroni create-side discovery + NEW WAY populated read certification (M2B).
 */
export const ADMIN_CONTRACT_V1 = {
  version: ADMIN_CONTRACT_VERSION,
  platform: "TakeAwayHero",
  adminVersionMarker: "ADMIN_VERSION_MARKER_NOT_FOUND" as const,
  capabilities: M2B_ADAPTER_CAPABILITIES,
  routes: {
    login: ev(
      "/login",
      "OBSERVED",
      "NEW WAY full URL: https://newwaypizzaringsted.dk/login",
    ),
    dashboard: ev("/admin/dashboard", "OBSERVED"),
    menuList: ev("/admin/menu", "OBSERVED"),
    menuCreate: ev("/admin/menu/create", "OBSERVED", "Veroni + NEW WAY"),
    menuEditPattern: ev(
      "/admin/menu/{databaseId}/edit",
      "OBSERVED",
      "Confirmed on NEW WAY populated products",
    ),
    menuUpdateAction: ev(
      "POST /admin/menu/{databaseId} with _method=PUT",
      "OBSERVED",
      "Update form containing #menu_number; Opdater submit detected only",
    ),
    categoriesList: ev("/admin/categories", "OBSERVED"),
    categoryEditPattern: ev("/admin/categories/{databaseId}/edit", "OBSERVED"),
    categoryShowPattern: ev("/admin/categories/{databaseId}", "OBSERVED"),
  },
  semantics: {
    variantPriceSemantics: ev(
      "SURCHARGE" as VariantPriceSemantics,
      "TESTED",
      "NEW WAY: base+Alm(0)=public list price; Alm absolute 0 impossible. Products 1,2,12,4,18.",
    ),
    basePriceSemantics: ev(
      "DEFAULT_BASE_PRODUCT_PRICE" as BasePriceSemantics,
      "TESTED",
      "Product #price is default/base; public list matches base + Alm surcharge 0.",
    ),
    additionPriceSemantics: ev(
      "ABSOLUTE_ADDON_PRICE" as const,
      "OBSERVED",
      "additions[i][price] are topping/extra amounts (e.g. 17/29).",
    ),
  },
  idStrategy: {
    productDatabaseId: ev(
      "Numeric path segment in /admin/menu/{id}/edit and form action /admin/menu/{id}",
      "OBSERVED",
    ),
    categoryDatabaseId: ev(
      "Numeric path /admin/categories/{id}/edit; checkbox id category-{id}",
      "OBSERVED",
    ),
    menuNumber: ev(
      "Display string #menu_number; may be alphanumeric; MUST NOT equal databaseId",
      "OBSERVED",
      "Examples: menuNumber 0 -> db 1; 45A -> db 4; 20 -> db 12",
    ),
    variantDatabaseId: ev(
      "Hidden input variants[i][id] on edit rows",
      "OBSERVED",
    ),
    ingredientDatabaseId: ev(
      "Hidden input ingredients[i][id] when present on edit rows",
      "OBSERVED",
    ),
    additionDatabaseId: ev(
      "Hidden input additions[i][id] when present on edit rows",
      "OBSERVED",
    ),
  },
  createVsEdit: {
    createSubmit: ev("Skab on POST /admin/menu", "OBSERVED"),
    editSubmit: ev("Opdater on POST /admin/menu/{id} _method=PUT", "OBSERVED"),
    editHasPersistentRowIds: ev(
      true,
      "OBSERVED",
      "variants/ingredients/additions expose hidden [id] fields on edit",
    ),
    createUsesBlueprintsWithoutIds: ev(true, "OBSERVED"),
    deleteFormAlsoPresentOnEditPage: ev(
      true,
      "OBSERVED",
      "Readers must select update form with #menu_number, not delete form",
    ),
  },
  restaurantContext: {
    strategy: "hostname",
    notes: "Compare page hostname to expected restaurant host.",
  },
  selectors: {
    menuNumber: {
      field: "menuNumber",
      type: "id",
      locator: "menu_number",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
      notes: "Also getByLabel('Menunummer')",
    },
    productName: {
      field: "productName",
      type: "label",
      locator: "Navn",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
      notes: "#name",
    },
    description: {
      field: "description",
      type: "label",
      locator: "Beskrivelse",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    basePrice: {
      field: "basePrice",
      type: "label",
      locator: "Pris",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
      notes: "DEFAULT_BASE_PRODUCT_PRICE",
    },
    categories: {
      field: "categories",
      type: "css",
      locator: "input[type='checkbox'][name='categories[]']",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    categoryFilter: {
      field: "categoryFilter",
      type: "id",
      locator: "category",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    variantList: {
      field: "variantStructure",
      type: "id",
      locator: "variant-list",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    addVariant: {
      field: "addVariant",
      type: "id",
      locator: "add-variant",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    variantName: {
      field: "variantName",
      type: "css",
      locator: "input.variant-name[name^='variants[']",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    variantPrice: {
      field: "variantPrice",
      type: "css",
      locator: "input.variant-price[name^='variants[']",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
      notes: "SURCHARGE over base",
    },
    variantIdHidden: {
      field: "variantDatabaseId",
      type: "css",
      locator: "tr.variant-form input[name*='[id]']",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    ingredientList: {
      field: "ingredients",
      type: "id",
      locator: "ingredient-list",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    addIngredient: {
      field: "addIngredient",
      type: "id",
      locator: "add-ingredient",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    ingredientName: {
      field: "ingredientName",
      type: "css",
      locator: "input.ingredient-name[name^='ingredients[']",
      confidence: "HIGH",
      stability: "MODERATE",
      evidence: "OBSERVED",
    },
    additionList: {
      field: "addonStructure",
      type: "id",
      locator: "addition-list",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    addAddition: {
      field: "addAddition",
      type: "id",
      locator: "add-addition",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    additionName: {
      field: "additionName",
      type: "css",
      locator: "input.addition-name[name^='additions[']",
      confidence: "HIGH",
      stability: "MODERATE",
      evidence: "OBSERVED",
    },
    additionPrice: {
      field: "additionPrice",
      type: "css",
      locator: "input.addition-price[name^='additions[']",
      confidence: "HIGH",
      stability: "MODERATE",
      evidence: "OBSERVED",
    },
    image: {
      field: "image",
      type: "id",
      locator: "image",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    active: {
      field: "active",
      type: "label",
      locator: "Aktiv?",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
    saveCreate: {
      field: "saveControl",
      type: "role",
      locator: "Skab",
      confidence: "HIGH",
      stability: "MODERATE",
      evidence: "OBSERVED",
      notes: "DETECT ONLY",
    },
    saveUpdate: {
      field: "saveUpdate",
      type: "role",
      locator: "Opdater",
      confidence: "HIGH",
      stability: "MODERATE",
      evidence: "OBSERVED",
      notes: "DETECT ONLY",
    },
    menuCreateLink: {
      field: "menuCreateLink",
      type: "role",
      locator: "Tilføj",
      confidence: "HIGH",
      stability: "MODERATE",
      evidence: "OBSERVED",
    },
    productEditLink: {
      field: "productEditLink",
      type: "css",
      locator: "a[href*='/admin/menu/'][href$='/edit']",
      confidence: "HIGH",
      stability: "STABLE",
      evidence: "OBSERVED",
    },
  } satisfies Record<string, SelectorSpec>,
  menuListColumns: ["#", "image", "Navn", "Kategorier", "Pris", "Status", "Handlinger"],
  categoryListColumns: ["Navn", "Rækkefølge", "Antal varer", "Handlinger"],
  notes: [
    "No data-testid attributes present.",
    "No data-admin-contract-version marker found.",
    "M2B certified READ against NEW WAY; WRITE remains UNCERTIFIED.",
    "variantPriceSemantics=SURCHARGE (TESTED).",
  ],
} as const;

export type AdminContractV1 = typeof ADMIN_CONTRACT_V1;
