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
      "M2C: non-default publics observed. Hvidløgsbrød base99 Deep+20→Tilføj 119; Fam+110→Tilføj 209. Vesuvio same 119/209. Cart never mutated.",
    ),
    basePriceSemantics: ev(
      "DEFAULT_BASE_PRODUCT_PRICE" as BasePriceSemantics,
      "TESTED",
      "Product #price is default/base; public Alm total equals base; Deep/Fam finals = base + admin variant.",
    ),
    additionPriceSemantics: ev(
      "ABSOLUTE_ADDON_PRICE" as const,
      "OBSERVED",
      "Admin additions[i][price] equals public '+N kr' extra; customer pays that additional amount when selecting the add-on (not a product-variant surcharge).",
    ),
    activeReadSemantics: ev(
      "CHECKED_MEANS_AVAILABLE" as const,
      "TESTED",
      "SCOPED NEW WAY TESTED. HUMAN_CONFIRMED intended mapping globally: checked Aktiv?=AVAILABLE, unchecked=HIDDEN. Veroni product 18 READ: EDIT_CHECKBOX_NOT_AUTHORITATIVE (list Skjult + public absent while edit #active server-checked) — likely render inconsistency; prefer list/storefront; do not flip checkbox by hostname. Persist always requires Opdater.",
    ),
    activeIntendedMapping: ev(
      "CHECKED_MEANS_AVAILABLE" as const,
      "HUMAN_CONFIRMED",
      "Existing products: checked Aktiv? = intended VISIBLE/AVAILABLE; unchecked = intended HIDDEN. Form intent only until Opdater.",
    ),
    activePersistRequiresOpdater: ev(
      "CHECKBOX_CHANGE_REQUIRES_OPDATER_SUBMIT" as const,
      "HUMAN_CONFIRMED",
      "Any #active change persists only after Opdater. EDIT_CONTROL_STATE ≠ PERSISTED_PRODUCT_STATE ≠ STOREFRONT_VISIBILITY.",
    ),
    editPersistRequiresOpdater: ev(
      "ALL_EDIT_FIELDS_REQUIRE_OPDATER_SUBMIT" as const,
      "HUMAN_CONFIRMED",
      "All existing-product field edits (menu_number, name, description, price, variants, ingredients, additions, categories, image, active) persist only via Opdater. Create uses Skab. Lifecycle: PRE_UPDATE → FORM_MODIFIED → UPDATE_SUBMITTED → WRITTEN → READ_BACK → VERIFIED.",
    ),
    dynamicRowCompletenessRequired: ev(
      "DYNAMIC_ROW_COMPLETENESS_REQUIRED" as const,
      "HUMAN_CONFIRMED",
      "Before Skab/Opdater every instantiated variant/ingredient/addition row must be fully filled or removed via red X. No fixed row limit — any number of complete rows is valid. Variant names are open-ended (no whitelist); adapter executes WritePlan only. Expected collections = product WritePlan. Empty section ≠ blank row. Ignore #blueprint-*. Never invent data. form.checkValidity() alone is insufficient.",
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
    createSubmit: ev(
      "Skab on POST /admin/menu",
      "OBSERVED",
      "HUMAN_CONFIRMED create persist boundary — CREATE only; does not certify UPDATE",
    ),
    editSubmit: ev(
      "Opdater on POST /admin/menu/{id} _method=PUT",
      "OBSERVED",
      "HUMAN_CONFIRMED: Opdater is edit persist boundary. M3H CERTIFIED on Veroni canary 18 for description-only updateExistingProductForm (multipart POST /admin/menu/{id} + read-back). Full updateProduct remains UNCERTIFIED.",
    ),
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
      notes:
        "EDIT_CONTROL_STATE only until Opdater. HUMAN_CONFIRMED: clicking Aktiv? does not by itself change storefront visibility.",
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
      notes:
        "DETECT ONLY until visibility write certification. HUMAN_CONFIRMED persist gate for #active and other edit fields.",
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
    "M3 Veroni canary BLOCKED: create #active defaults checked (CANARY_PUBLIC_VISIBILITY_RISK).",
    "HUMAN_CONFIRMED: intended Aktiv? mapping checked=AVAILABLE / unchecked=HIDDEN; all edit fields require Opdater; Skab≠Opdater; M3H update caps CERTIFIED; M3 CREATE + writeAdditions CERTIFIED (hidden canaries); M6.7 createCategory CERTIFIED (synthetic canary); image/setProductHidden/setProductAvailable/updateProduct remain UNCERTIFIED.",
    "HUMAN_CONFIRMED: DYNAMIC_ROW_COMPLETENESS_REQUIRED — every instantiated row complete or removed; multiple complete rows valid; variant names open-ended (no whitelist); expected collections from WritePlan only; never invent row data.",
    "HUMAN_CONFIRMED (M3H): cookie/consent overlays may block Skab/Opdater — dismiss safely and verify interactability; never force-click through overlays.",
  ],
} as const;

export type AdminContractV1 = typeof ADMIN_CONTRACT_V1;
