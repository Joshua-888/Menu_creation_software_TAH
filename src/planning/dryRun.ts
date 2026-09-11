import type { CanonicalMenu, CanonicalProduct } from "../domain/schema/canonical.js";
import type { AdapterCapabilities } from "../tah/contracts/evidence.js";
import {
  createMigrationWritePlan,
  planBlockProduct,
  planCreateCategory,
  planCreateProduct,
  planReviewProduct,
  planSkipProduct,
  type MigrationWritePlan,
  type PlannedProductPayload,
  type WritePlanOperation,
} from "../runner/writePlan.js";
import {
  matchDestinationByEvidence,
  type DestinationProduct,
} from "../runner/executor.js";
import { isTahCanaryProduct } from "./canaries.js";
import {
  isSourceStructurePlaceholder,
  mapProductToDestinationCategory,
  type CategoryMappingResult,
} from "./categoryMapping.js";
import { assertDecisionsResolvedForWrite } from "../decisions/transforms.js";

export type DryRunDestinationSnapshot = {
  host: string;
  categories: Array<{ databaseId: string; name: string }>;
  products: Array<{
    databaseId: string;
    menuNumber: string;
    name: string;
    categoryIds: string[];
    listStatus?: string;
  }>;
};

function requiredCapsForCreate(product: CanonicalProduct): string[] {
  const caps = new Set<string>([
    "createProduct",
    "createHiddenProduct",
    "assignExistingCategory",
  ]);
  if (product.variants.length <= 1) caps.add("writeDefaultVariant");
  if (product.variants.some((v) => v.surcharge !== 0)) {
    caps.add("writeNonZeroVariants");
  }
  if (product.variants.length > 1) caps.add("writeMultipleVariants");
  if (product.ingredients.length) caps.add("writeIngredients");
  if (product.addOns.length) caps.add("writeAdditions");
  return [...caps];
}

function missingCaps(
  required: string[],
  capabilities: AdapterCapabilities,
): string[] {
  const missing: string[] = [];
  for (const name of required) {
    const status =
      capabilities.write[name as keyof AdapterCapabilities["write"]];
    if (status !== "CERTIFIED") missing.push(name);
  }
  return missing;
}

function toPayload(
  product: CanonicalProduct,
  categoryIds: string[],
): PlannedProductPayload {
  return {
    sourceId: product.sourceId,
    menuNumber:
      product.assignedMenuNumber ?? product.sourceMenuNumber ?? "",
    name: product.name,
    description: product.description ?? "",
    basePriceOre: product.basePrice ?? 0,
    categoryIds,
    variants: product.variants.map((v) => ({
      name: v.name,
      surchargeOre: v.surcharge,
    })),
    ingredients: product.ingredients.map((i) => i.display),
    additions: product.addOns.map((a) => ({
      name: a.name,
      priceOre: a.price ?? 0,
    })),
    intendedHidden: true,
  };
}

/**
 * Build a DRY_RUN WritePlan. Never mutates destination.
 */
export function buildDryRunWritePlan(input: {
  runId: string;
  restaurant: string;
  host: string;
  source: string;
  schemaVersion: string;
  domainRuleVersion: string;
  adapterVersion: string;
  contractFingerprint: string;
  canonical: CanonicalMenu;
  categoryMappings: CategoryMappingResult[];
  destination: DryRunDestinationSnapshot;
  capabilities: AdapterCapabilities;
  /** When provided, unresolved semantic decisions block the plan. */
  decisionCases?: Array<{ status: string; decisionCaseId: string }>;
  /** Exact-product destination overrides from human decisions (e.g. #38). */
  humanApprovedProductCategories?: Record<
    string,
    { destinationCategoryId: string; destinationCategoryName: string }
  >;
}): MigrationWritePlan {
  if (input.decisionCases) {
    assertDecisionsResolvedForWrite({ cases: input.decisionCases });
  }
  const catBySource = new Map(
    input.categoryMappings.map((m) => [m.sourceCategoryId, m]),
  );

  const realDest = input.destination.products.filter(
    (p) => !isTahCanaryProduct(p.name),
  );
  const destCatalog: DestinationProduct[] = realDest.map((p) => ({
    databaseId: p.databaseId,
    menuNumber: p.menuNumber,
    name: p.name,
    description: "",
    basePriceOre: 0,
    categoryIds: p.categoryIds,
    variants: [],
    ingredients: [],
    additions: [],
    listStatus: p.listStatus ?? "",
  }));

  const operations: WritePlanOperation[] = [];
  let opSeq = 0;
  const pendingCategoryCreates = new Set<string>();
  const createCategoryCertified =
    input.capabilities.write.createCategory === "CERTIFIED";

  function pendingCategoryToken(categoryName: string): string {
    return `__resolve__:${categoryName.trim()}`;
  }

  for (const category of input.canonical.categories) {
    const mapping = catBySource.get(category.sourceId);
    for (const product of category.products) {
      opSeq += 1;
      const operationId = `dry-${opSeq}`;
      const identityBase = {
        sourceId: product.sourceId,
        menuNumber:
          product.assignedMenuNumber ?? product.sourceMenuNumber ?? "",
        name: product.name,
      };

      // Product-level mapping for source-structure placeholders (e.g. 36–38)
      let effectiveMapping = mapping;
      const menuNum =
        product.sourceMenuNumber ?? product.assignedMenuNumber ?? "";
      if (
        mapping?.outcome === "SOURCE_STRUCTURE_PLACEHOLDER" ||
        isSourceStructurePlaceholder(category.name) ||
        Boolean(input.humanApprovedProductCategories?.[menuNum])
      ) {
        const pm = mapProductToDestinationCategory(
          {
            menuNumber: menuNum,
            name: product.name,
            sourceCategoryName: category.name,
          },
          input.destination.categories,
          input.humanApprovedProductCategories
            ? {
                humanApprovedByMenuNumber:
                  input.humanApprovedProductCategories,
              }
            : undefined,
        );
        if (
          pm.outcome === "SAFE_MAPPED_MATCH" ||
          pm.outcome === "EXACT_MATCH"
        ) {
          effectiveMapping = {
            sourceCategoryId: category.sourceId,
            sourceCategoryName: category.name,
            outcome: "SAFE_MAPPED_MATCH",
            reason: pm.reason,
            ...(pm.destinationCategoryId
              ? { destinationCategoryId: pm.destinationCategoryId }
              : {}),
            ...(pm.destinationCategoryName
              ? { destinationCategoryName: pm.destinationCategoryName }
              : {}),
          };
        } else if (pm.outcome === "MANUAL_REVIEW_REQUIRED") {
          operations.push(
            planReviewProduct({
              operationId,
              identity: identityBase,
              reason: pm.reason,
            }),
          );
          continue;
        } else if (
          createCategoryCertified &&
          (pm.outcome === "MISSING_DESTINATION_CATEGORY" ||
            pm.outcome === "SOURCE_STRUCTURE_PLACEHOLDER")
        ) {
          effectiveMapping = {
            sourceCategoryId: category.sourceId,
            sourceCategoryName: category.name,
            outcome: "MISSING_DESTINATION_CATEGORY",
            reason: pm.reason,
          };
        } else {
          operations.push(
            planBlockProduct({
              operationId,
              identity: identityBase,
              reason: pm.reason,
              missingCapabilities: ["createCategory"],
            }),
          );
          continue;
        }
      }

      if (
        !effectiveMapping ||
        effectiveMapping.outcome === "AMBIGUOUS_MATCH" ||
        effectiveMapping.outcome === "SOURCE_STRUCTURE_PLACEHOLDER"
      ) {
        operations.push(
          planBlockProduct({
            operationId,
            identity: identityBase,
            reason: `category mapping ${effectiveMapping?.outcome ?? "missing"}; createCategory UNCERTIFIED`,
            missingCapabilities: ["createCategory"],
          }),
        );
        continue;
      }

      if (effectiveMapping.outcome === "MISSING_DESTINATION_CATEGORY") {
        if (!createCategoryCertified) {
          operations.push(
            planBlockProduct({
              operationId,
              identity: identityBase,
              reason:
                "category mapping MISSING_DESTINATION_CATEGORY; createCategory UNCERTIFIED",
              missingCapabilities: ["createCategory"],
            }),
          );
          continue;
        }
        const catName = effectiveMapping.sourceCategoryName || category.name;
        if (!pendingCategoryCreates.has(category.sourceId)) {
          pendingCategoryCreates.add(category.sourceId);
          opSeq += 1;
          operations.push(
            planCreateCategory({
              operationId: `dry-cat-${opSeq}`,
              sourceId: category.sourceId,
              name: catName,
              requiredCapabilities: ["createCategory"],
              reason:
                "destination category missing; createCategory CERTIFIED",
            }),
          );
        }
        effectiveMapping = {
          ...effectiveMapping,
          outcome: "SAFE_MAPPED_MATCH",
          destinationCategoryId: pendingCategoryToken(catName),
          destinationCategoryName: catName,
          reason: `${effectiveMapping.reason}; pending createCategory`,
        };
      }

      const identity = {
        ...identityBase,
        ...(effectiveMapping.destinationCategoryId
          ? { categoryHint: effectiveMapping.destinationCategoryId }
          : {}),
      };

      if (
        product.status === "BLOCKED" ||
        product.status === "MANUAL_REVIEW_REQUIRED"
      ) {
        operations.push(
          planReviewProduct({
            operationId,
            identity,
            reason: `validation status ${product.status}`,
          }),
        );
        continue;
      }

      const categoryIds = effectiveMapping.destinationCategoryId
        ? [effectiveMapping.destinationCategoryId]
        : [];

      const menuForMatch =
        product.assignedMenuNumber ?? product.sourceMenuNumber;
      const resolvedCatHint =
        effectiveMapping.destinationCategoryId &&
        !effectiveMapping.destinationCategoryId.startsWith("__resolve__:")
          ? effectiveMapping.destinationCategoryId
          : undefined;
      const match = matchDestinationByEvidence(destCatalog, {
        ...(menuForMatch ? { menuNumber: menuForMatch } : {}),
        name: product.name,
        ...(resolvedCatHint ? { categoryHint: resolvedCatHint } : {}),
      });

      if (match.outcome === "AMBIGUOUS") {
        operations.push(
          planReviewProduct({
            operationId,
            identity,
            reason: "MANUAL_REVIEW_REQUIRED: ambiguous destination match",
          }),
        );
        continue;
      }

      const required = requiredCapsForCreate(product);
      const missing = missingCaps(required, input.capabilities);

      if (match.outcome === "FOUND") {
        operations.push(
          planBlockProduct({
            operationId,
            identity: {
              ...identity,
              destinationDatabaseId: match.product.databaseId,
            },
            reason:
              "destination product exists; updateProduct capability UNCERTIFIED",
            missingCapabilities: ["updateProduct"],
          }),
        );
        continue;
      }

      if (missing.length) {
        operations.push(
          planBlockProduct({
            operationId,
            identity,
            reason: `missing certified capabilities: ${missing.join(",")}`,
            missingCapabilities: missing,
          }),
        );
        continue;
      }

      if (product.status === "WARNING") {
        operations.push(
          planReviewProduct({
            operationId,
            identity,
            reason: "WARNING status — human gate before create",
          }),
        );
        continue;
      }

      operations.push(
        planCreateProduct({
          operationId,
          payload: toPayload(product, categoryIds),
          requiredCapabilities: required,
          missingCapabilities: [],
        }),
      );
    }
  }

  // Canaries are DESTINATION_INTERNAL_TEST_RECORDS — not part of the 72 source actions.
  // Still emitted as SKIP ops for visibility, but summarizeSourceDryRun excludes them.
  for (const canary of input.destination.products.filter((p) =>
    isTahCanaryProduct(p.name),
  )) {
    opSeq += 1;
    operations.push(
      planSkipProduct({
        operationId: `canary-skip-${opSeq}`,
        identity: {
          sourceId: `dest-canary:${canary.databaseId}`,
          menuNumber: canary.menuNumber,
          name: canary.name,
          destinationDatabaseId: canary.databaseId,
        },
        reason: "INTERNAL TEST DATA (__TAH_CANARY_) — excluded from production matching",
      }),
    );
  }

  return createMigrationWritePlan({
    runId: input.runId,
    restaurant: input.restaurant,
    host: input.host,
    source: input.source,
    schemaVersion: input.schemaVersion,
    domainRuleVersion: input.domainRuleVersion,
    adapterVersion: input.adapterVersion,
    contractFingerprint: input.contractFingerprint,
    dryRun: true,
    operations,
  });
}

export function summarizeDryRun(plan: MigrationWritePlan): Record<string, number> {
  const counts: Record<string, number> = {
    CREATE: 0,
    SKIP: 0,
    UPDATE: 0,
    REVIEW: 0,
    BLOCK: 0,
  };
  for (const op of plan.operations) {
    counts[op.action] = (counts[op.action] ?? 0) + 1;
  }
  return counts;
}

/** Source-product dry-run totals — excludes destination canary SKIP ops. Must sum to 72. */
export function summarizeSourceDryRun(plan: MigrationWritePlan): {
  SOURCE_CREATE: number;
  SOURCE_SKIP: number;
  SOURCE_UPDATE: number;
  SOURCE_REVIEW: number;
  SOURCE_BLOCK: number;
  total: number;
  DESTINATION_INTERNAL_TEST_RECORDS: number;
} {
  let SOURCE_CREATE = 0;
  let SOURCE_SKIP = 0;
  let SOURCE_UPDATE = 0;
  let SOURCE_REVIEW = 0;
  let SOURCE_BLOCK = 0;
  let DESTINATION_INTERNAL_TEST_RECORDS = 0;

  for (const op of plan.operations) {
    if (op.entityType === "category") {
      continue;
    }
    if (
      op.action === "SKIP" &&
      (op.identity.name?.startsWith("__TAH_CANARY_") ||
        op.identity.sourceId.startsWith("dest-canary:"))
    ) {
      DESTINATION_INTERNAL_TEST_RECORDS += 1;
      continue;
    }
    if (op.action === "CREATE") SOURCE_CREATE += 1;
    else if (op.action === "SKIP") SOURCE_SKIP += 1;
    else if (op.action === "UPDATE") SOURCE_UPDATE += 1;
    else if (op.action === "REVIEW") SOURCE_REVIEW += 1;
    else if (op.action === "BLOCK") SOURCE_BLOCK += 1;
  }

  return {
    SOURCE_CREATE,
    SOURCE_SKIP,
    SOURCE_UPDATE,
    SOURCE_REVIEW,
    SOURCE_BLOCK,
    total:
      SOURCE_CREATE +
      SOURCE_SKIP +
      SOURCE_UPDATE +
      SOURCE_REVIEW +
      SOURCE_BLOCK,
    DESTINATION_INTERNAL_TEST_RECORDS,
  };
}
