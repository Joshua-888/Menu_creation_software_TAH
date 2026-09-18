import type { PlannedProductPayload } from "../runner/writePlan.js";

export type CreateIdentityAvailability = "CONFLICT" | "UNKNOWN";

export type DuplicateHit = {
  key: string;
  sourceIds: string[];
};

export type TahInputContractViolation = {
  field: string;
  submittedValueShape: string;
  expectedConstraint: string;
  evidence: string;
  sourceId?: string;
};

export type CreatePreflightReport = {
  TARGET_MENU_DUPLICATE_MENU_NUMBERS: DuplicateHit[];
  TARGET_MENU_DUPLICATE_NAMES: DuplicateHit[];
  VISIBLE_DESTINATION_MENU_NUMBER_CONFLICTS: DuplicateHit[];
  VISIBLE_DESTINATION_NAME_CONFLICTS: DuplicateHit[];
  TAH_INPUT_CONTRACT_VIOLATIONS: TahInputContractViolation[];
  VISIBLE_DESTINATION_EMPTY: boolean;
  CREATE_IDENTITY_AVAILABILITY: CreateIdentityAvailability;
  ok: boolean;
  blockers: string[];
};

export type PreflightProduct = {
  sourceId: string;
  menuNumber?: string | null;
  name?: string | null;
  payload?: PlannedProductPayload | null;
};

export type PreflightDestinationProduct = {
  databaseId?: string;
  menuNumber?: string | null;
  name?: string | null;
};

export function normalizeMenuNumber(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function numericEquivalentMenuNumber(
  value: string | null | undefined,
): string | null {
  const trimmed = normalizeMenuNumber(value);
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return trimmed.toLocaleLowerCase("da-DK");
  return String(Number(trimmed));
}

export function normalizeProductName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("da-DK");
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      return true;
    }
  }
  return false;
}

function shapeOf(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") {
    if (value.length === 0) return "empty_string";
    if (!value.trim()) return "whitespace_only";
    if (hasControlChars(value)) {
      return `string_len_${value.length}_control_chars`;
    }
    return `string_len_${value.length}`;
  }
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "non_finite_number";
  if (Array.isArray(value)) return `array_len_${value.length}`;
  return typeof value;
}

function collectDuplicates(
  items: Array<{ sourceId: string; key: string }>,
): DuplicateHit[] {
  const map = new Map<string, string[]>();
  for (const item of items) {
    if (!item.key) continue;
    const list = map.get(item.key) ?? [];
    list.push(item.sourceId);
    map.set(item.key, list);
  }
  return [...map.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, sourceIds]) => ({ key, sourceIds }));
}

export function findTargetMenuDuplicateMenuNumbers(
  products: readonly PreflightProduct[],
): DuplicateHit[] {
  const exact = collectDuplicates(
    products.map((p) => ({
      sourceId: p.sourceId,
      key: normalizeMenuNumber(p.menuNumber)
        ? `exact:${normalizeMenuNumber(p.menuNumber)}`
        : "",
    })),
  );
  const numeric = collectDuplicates(
    products.map((p) => ({
      sourceId: p.sourceId,
      key: numericEquivalentMenuNumber(p.menuNumber)
        ? `num:${numericEquivalentMenuNumber(p.menuNumber)}`
        : "",
    })),
  );
  const merged = new Map<string, string[]>();
  for (const hit of [...exact, ...numeric]) {
    merged.set(hit.key, hit.sourceIds);
  }
  return [...merged.entries()].map(([key, sourceIds]) => ({ key, sourceIds }));
}

export function findTargetMenuDuplicateNames(
  products: readonly PreflightProduct[],
): DuplicateHit[] {
  return collectDuplicates(
    products.map((p) => ({
      sourceId: p.sourceId,
      key: normalizeProductName(p.name),
    })),
  );
}

export function findVisibleDestinationConflicts(input: {
  target: readonly PreflightProduct[];
  destination: readonly PreflightDestinationProduct[];
}): {
  menuNumbers: DuplicateHit[];
  names: DuplicateHit[];
} {
  const destByMenu = new Map<string, string[]>();
  const destByName = new Map<string, string[]>();
  for (const row of input.destination) {
    const menu = numericEquivalentMenuNumber(row.menuNumber);
    const name = normalizeProductName(row.name);
    const destId = row.databaseId || `${row.menuNumber}:${row.name}`;
    if (menu) {
      const list = destByMenu.get(menu) ?? [];
      list.push(destId);
      destByMenu.set(menu, list);
    }
    if (name) {
      const list = destByName.get(name) ?? [];
      list.push(destId);
      destByName.set(name, list);
    }
  }
  const menuNumbers: DuplicateHit[] = [];
  const names: DuplicateHit[] = [];
  for (const product of input.target) {
    const menu = numericEquivalentMenuNumber(product.menuNumber);
    const name = normalizeProductName(product.name);
    if (menu && destByMenu.has(menu)) {
      menuNumbers.push({
        key: menu,
        sourceIds: [product.sourceId, ...destByMenu.get(menu)!],
      });
    }
    if (name && destByName.has(name)) {
      names.push({
        key: name,
        sourceIds: [product.sourceId, ...destByName.get(name)!],
      });
    }
  }
  return { menuNumbers, names };
}

/**
 * Visible emptiness does not prove CREATE identity availability.
 * listProducts() cannot observe soft-deleted / unique-constraint rows.
 */
export function assessCreateIdentityAvailability(input: {
  visibleDestinationProducts: number;
  visibleMenuNumberConflicts: number;
}): CreateIdentityAvailability {
  if (input.visibleMenuNumberConflicts > 0) return "CONFLICT";
  void input.visibleDestinationProducts;
  return "UNKNOWN";
}

export function auditTahInputContract(
  payload: PlannedProductPayload,
): TahInputContractViolation[] {
  const violations: TahInputContractViolation[] = [];
  const push = (
    field: string,
    value: unknown,
    expectedConstraint: string,
    evidence: string,
  ) => {
    violations.push({
      field,
      submittedValueShape: shapeOf(value),
      expectedConstraint,
      evidence,
      sourceId: payload.sourceId,
    });
  };

  const menu = payload.menuNumber;
  if (!normalizeMenuNumber(menu)) {
    push("menuNumber", menu, "non-empty trimmed menu number", "empty or whitespace-only menuNumber");
  }
  if (!payload.name.trim()) {
    push("name", payload.name, "non-empty trimmed name", "empty or whitespace-only name");
  }
  if (hasControlChars(payload.name)) {
    push("name", payload.name, "no control characters", "control characters in name");
  }
  if (hasControlChars(payload.description)) {
    push(
      "description",
      payload.description,
      "no control characters",
      "control characters in description",
    );
  }
  if (!Number.isFinite(payload.basePriceOre) || payload.basePriceOre < 0) {
    push(
      "basePriceOre",
      payload.basePriceOre,
      "finite price in øre, >= 0",
      "malformed or negative base price",
    );
  }
  if (!payload.categoryIds.length || payload.categoryIds.some((id) => !String(id).trim())) {
    push(
      "categoryIds",
      payload.categoryIds,
      "at least one non-empty category id or pending __resolve__ token",
      "missing category reference",
    );
  }
  const variantNames = new Map<string, number>();
  for (const [index, variant] of payload.variants.entries()) {
    if (!variant.name.trim()) {
      push(
        `variants[${index}].name`,
        variant.name,
        "non-empty variant name",
        "empty variant name",
      );
    }
    const key = normalizeProductName(variant.name);
    variantNames.set(key, (variantNames.get(key) ?? 0) + 1);
    if (!Number.isFinite(variant.surchargeOre) || variant.surchargeOre < 0) {
      push(
        `variants[${index}].surchargeOre`,
        variant.surchargeOre,
        "finite surcharge in øre, >= 0",
        "malformed variant surcharge",
      );
    }
  }
  for (const [name, count] of variantNames) {
    if (name && count > 1) {
      push(
        "variants.name",
        name,
        "unique variant names per product",
        `duplicate variant name occurs ${count} times`,
      );
    }
  }
  for (const [index, ingredient] of payload.ingredients.entries()) {
    if (!ingredient.trim()) {
      push(
        `ingredients[${index}]`,
        ingredient,
        "non-empty ingredient string",
        "empty ingredient",
      );
    }
  }
  for (const [index, addition] of payload.additions.entries()) {
    if (!addition.name.trim()) {
      push(
        `additions[${index}].name`,
        addition.name,
        "non-empty addition name",
        "empty addition name",
      );
    }
    if (!Number.isFinite(addition.priceOre) || addition.priceOre < 0) {
      push(
        `additions[${index}].priceOre`,
        addition.priceOre,
        "finite addition price in øre, >= 0",
        "malformed addition price",
      );
    }
  }
  return violations;
}

export function preflightCreateWrites(input: {
  targetProducts: readonly PreflightProduct[];
  destinationProducts: readonly PreflightDestinationProduct[];
}): CreatePreflightReport {
  const menuDupes = findTargetMenuDuplicateMenuNumbers(input.targetProducts);
  const nameDupes = findTargetMenuDuplicateNames(input.targetProducts);
  const visible = findVisibleDestinationConflicts({
    target: input.targetProducts,
    destination: input.destinationProducts,
  });
  const contract: TahInputContractViolation[] = [];
  for (const product of input.targetProducts) {
    if (product.payload) contract.push(...auditTahInputContract(product.payload));
  }
  const availability = assessCreateIdentityAvailability({
    visibleDestinationProducts: input.destinationProducts.length,
    visibleMenuNumberConflicts: visible.menuNumbers.length,
  });
  const blockers: string[] = [];
  if (menuDupes.length) {
    blockers.push("TARGET_MENU_DUPLICATE_MENU_NUMBERS");
  }
  if (nameDupes.length) {
    blockers.push("TARGET_MENU_DUPLICATE_NAMES");
  }
  if (visible.menuNumbers.length) {
    blockers.push("VISIBLE_DESTINATION_MENU_NUMBER_CONFLICTS");
  }
  if (contract.length) {
    blockers.push("TAH_INPUT_CONTRACT_VIOLATION");
  }
  return {
    TARGET_MENU_DUPLICATE_MENU_NUMBERS: menuDupes,
    TARGET_MENU_DUPLICATE_NAMES: nameDupes,
    VISIBLE_DESTINATION_MENU_NUMBER_CONFLICTS: visible.menuNumbers,
    VISIBLE_DESTINATION_NAME_CONFLICTS: visible.names,
    TAH_INPUT_CONTRACT_VIOLATIONS: contract,
    VISIBLE_DESTINATION_EMPTY: input.destinationProducts.length === 0,
    CREATE_IDENTITY_AVAILABILITY: availability,
    ok: blockers.length === 0,
    blockers,
  };
}

export function preflightBlockReason(
  report: CreatePreflightReport,
  sourceId: string,
): string | null {
  const inMenu = report.TARGET_MENU_DUPLICATE_MENU_NUMBERS.some((hit) =>
    hit.sourceIds.includes(sourceId),
  );
  if (inMenu) {
    return "TAH_INPUT_CONTRACT_VIOLATION { field: menuNumber, expectedConstraint: unique in TargetMenu }";
  }
  const inName = report.TARGET_MENU_DUPLICATE_NAMES.some((hit) =>
    hit.sourceIds.includes(sourceId),
  );
  if (inName) {
    return "TAH_INPUT_CONTRACT_VIOLATION { field: name, expectedConstraint: unique in TargetMenu }";
  }
  const visMenu = report.VISIBLE_DESTINATION_MENU_NUMBER_CONFLICTS.some((hit) =>
    hit.sourceIds.includes(sourceId),
  );
  if (visMenu) {
    return "destination-visible identity conflict: menuNumber already present; create path does not update live products";
  }
  const contract = report.TAH_INPUT_CONTRACT_VIOLATIONS.find((v) => v.sourceId === sourceId);
  if (contract) {
    return `TAH_INPUT_CONTRACT_VIOLATION { field: ${contract.field}, submittedValueShape: ${contract.submittedValueShape}, expectedConstraint: ${contract.expectedConstraint}, evidence: ${contract.evidence} }`;
  }
  return null;
}
