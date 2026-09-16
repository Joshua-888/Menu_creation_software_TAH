import type { CanonicalMenu, CanonicalProduct } from "../domain/schema/canonical.js";
import type { AdapterCapabilities } from "../tah/contracts/evidence.js";
import {
  createMigrationWritePlan,
  planBlockProduct,
  planCreateCategory,
  planCreateProduct,
  planReviewProduct,
  planSkipProduct,
  planUpdateProduct,
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
import {
  mapProductChoicesToWriteFields,
  type ProductPolicyTrace,
} from "./structureMapping.js";
import {
  assessLabelQuality,
  labelQualityBlocksWrite,
} from "../domain/textNormalize.js";
import { lookupLearnedLabelCorrection } from "../decisions/labelQuality.js";
import type { DecisionStore } from "../decisions/store.js";
import {
  defaultStructurePattern,
  loadActiveStructurePattern,
} from "../learning/structurePolicy.js";
import type { StructurePatternSummary } from "../learning/peerMenuStructure.js";
import {
  filterAdditionsWithTrace,
  type ProbabilityPolicyMap,
} from "../learning/categoryLikelihood.js";
import type { IngredientLikelihoodPolicy } from "../learning/ingredientLikelihood.js";
import {
  sanitizeAdditionList,
  sanitizeIngredientList,
} from "../domain/menuCardQuality.js";
import { stripForbiddenMenuVariants } from "../learning/categorySizeVariantPolicy.js";
import {
  capabilitiesForReconcileFields,
  diffProductReconcile,
  missingReconcileCapabilities,
  recoverProductLabelsForReconcile,
  type LiveProductSnapshot,
  type ProductReconcileDiff,
  type ReconcileField,
} from "./menuReconcile.js";
import {
  buildQaTargetPayload,
  filterNeverWorseDeltas,
  liveSnapshotCategoryName,
  qaTargetHasWriteBlockingIssues,
} from "./qaLiveImprove.js";

export type DryRunDestinationSnapshot = {
  host: string;
  categories: Array<{ databaseId: string; name: string }>;
  products: Array<{
    databaseId: string;
    menuNumber: string;
    name: string;
    categoryIds: string[];
    listStatus?: string;
    description?: string;
    basePriceOre?: number;
    variants?: Array<{ name: string; priceOre: number }>;
    ingredients?: string[];
    additions?: Array<{ name: string; priceOre: number }>;
  }>;
};

/** Fields the portal Opdater path applies on QA reconcile (full product card). */
export const PORTAL_OPDATER_RECONCILE_FIELDS: ReconcileField[] = [
  "name",
  "description",
  "ingredients",
  "variants",
  "additions",
  "basePrice",
  "categoryIds",
];

function toLiveSnapshot(
  p: DryRunDestinationSnapshot["products"][number],
): LiveProductSnapshot {
  return {
    databaseId: p.databaseId,
    menuNumber: p.menuNumber,
    name: p.name,
    categoryIds: p.categoryIds,
    ...(typeof p.description === "string" ? { description: p.description } : {}),
    ...(typeof p.basePriceOre === "number" ? { basePriceOre: p.basePriceOre } : {}),
    ...(p.variants ? { variants: p.variants } : {}),
    ...(p.ingredients ? { ingredients: p.ingredients } : {}),
    ...(p.additions ? { additions: p.additions } : {}),
  };
}

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

/**
 * Map TargetMenu product → WritePlan payload.
 * TRUSTS TargetMenu from MenuIntelligenceEngine — does not invent ingredients,
 * additions, descriptions, or peer fills. Fail-closed strips only.
 */
function toPayload(
  product: CanonicalProduct,
  categoryIds: string[],
  overrides?: {
    name?: string;
    description?: string;
    ingredients?: string[];
  },
  structurePattern?: StructurePatternSummary | null,
  _probabilityPolicy?: ProbabilityPolicyMap | null,
  categoryName?: string,
  _ingredientLikelihood?: IngredientLikelihoodPolicy | null,
): PlannedProductPayload {
  const productName = overrides?.name ?? product.name;
  const desc = overrides?.description ?? product.description ?? "";
  const ingredientList =
    overrides?.ingredients ?? product.ingredients.map((i) => i.display);

  const assessment = assessLabelQuality({
    name: productName,
    description: desc,
    ingredients: ingredientList,
  });
  const pattern = structurePattern ?? defaultStructurePattern();
  const mapped = mapProductChoicesToWriteFields(product, pattern);
  // Prefer TargetMenu addOns; structure mapping only places already-decided choices.
  let additions = product.addOns.map((a) => ({
    name: a.name,
    priceOre: a.price ?? 0,
  }));
  if (mapped.additions.length && additions.length === 0) {
    additions = mapped.additions;
  }
  // Fail-closed: strip drinks/forbidden — never invent replacements.
  additions = filterAdditionsWithTrace({
    name: productName,
    ...(categoryName ? { categoryNames: [categoryName] } : {}),
    ...(desc ? { description: desc } : {}),
    additions,
    policy: null,
  }).after;

  const safeName = assessment.repaired.name || product.name;
  const safeIngredients = sanitizeIngredientList(
    assessment.repaired.ingredients.length
      ? assessment.repaired.ingredients
      : ingredientList,
    safeName,
  );
  const safeAdditions = sanitizeAdditionList(
    additions,
    safeName,
    categoryName,
  );
  // Description must already be on TargetMenu; only use label hygiene repairs.
  const description = assessment.repaired.description || desc;
  const safeVariants = stripForbiddenMenuVariants(
    mapped.variants.length
      ? mapped.variants
      : product.variants.map((v) => ({
          name: v.name,
          surchargeOre: v.surcharge ?? 0,
        })),
  );
  return {
    sourceId: product.sourceId,
    menuNumber:
      product.assignedMenuNumber ?? product.sourceMenuNumber ?? "",
    name: safeName,
    description,
    basePriceOre: product.basePrice ?? 0,
    categoryIds,
    variants: safeVariants.length
      ? safeVariants
      : [{ name: "Alm.", surchargeOre: 0 }],
    ingredients: safeIngredients,
    additions: safeAdditions,
    intendedHidden: shouldCreateProductsHidden(),
  };
}

/**
 * CREATE_MENU stages products hidden by default. Publishing requires an explicit
 * opt-in because TAH has no atomic menu-level publish transaction.
 */
export function shouldCreateProductsHidden(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    env.PORTAL_CREATE_HIDDEN === "0" ||
    env.PORTAL_CREATE_HIDDEN === "false" ||
    env.PORTAL_STOREFRONT_PUBLISH === "1" ||
    env.PORTAL_STOREFRONT_PUBLISH === "true"
  ) {
    return false;
  }
  return true;
}

/**
 * Build a DRY_RUN WritePlan from an already-complete TargetMenu.
 * Does NOT invent ingredients/additions/variants — MenuIntelligenceEngine owns that.
 * Planning role: TargetMenu + destination snapshot + capabilities → WritePlan.
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
  /** Optional decision store for learned label corrections. */
  decisionStore?: DecisionStore | null;
  /** Peer-learned structure pattern; falls back to store ACTIVE policy or defaults. */
  structurePattern?: StructurePatternSummary | null;
  /** @deprecated Applied in MenuIntelligenceEngine — ignored here. */
  probabilityPolicy?: ProbabilityPolicyMap | null;
  /** @deprecated Applied in MenuIntelligenceEngine — ignored here. */
  ingredientLikelihood?: IngredientLikelihoodPolicy | null;
  /** Optional sink filled with per-product policy traces for owner reports. */
  policyTraces?: ProductPolicyTrace[];
  /**
   * When true (QA_RECONCILE), FOUND products emit UPDATE via certified Opdater
   * for the full product card (name/description/price/variants/ingredients/additions)
   * instead of blanket BLOCK.
   */
  emitReconcileUpdates?: boolean;
  /** Optional sink for reconcile diffs (QA report). */
  reconcileDiffs?: ProductReconcileDiff[];
}): MigrationWritePlan {
  if (input.decisionCases) {
    assertDecisionsResolvedForWrite({ cases: input.decisionCases });
  }

  const structurePattern =
    input.structurePattern ??
    (input.decisionStore
      ? loadActiveStructurePattern(input.decisionStore)
      : null) ??
    defaultStructurePattern();

  // TargetMenu is authoritative — no variant/Tilbehør invent here.
  const canonical = input.canonical;
  void input.probabilityPolicy;
  void input.ingredientLikelihood;

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
    description: p.description ?? "",
    basePriceOre: p.basePriceOre ?? 0,
    categoryIds: p.categoryIds,
    variants: p.variants ?? [],
    ingredients: (p.ingredients ?? []).map((name) => ({ name })),
    additions: p.additions ?? [],
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

  for (const category of canonical.categories) {
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
        // Prefer menu-number identity when available so CREATE BLOCKs (and QA
        // UPDATEs) existing live rows even when the live name is header-like garbage.
        ...(menuForMatch
          ? { menuNumber: menuForMatch }
          : { name: product.name }),
        ...(resolvedCatHint && !menuForMatch
          ? { categoryHint: resolvedCatHint }
          : {}),
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
        if (!input.emitReconcileUpdates) {
          operations.push(
            planBlockProduct({
              operationId,
              identity: {
                ...identity,
                destinationDatabaseId: match.product.databaseId,
              },
              reason:
                "destination product exists; create path does not update live products",
              missingCapabilities: ["updateProduct"],
            }),
          );
          continue;
        }

        const live = toLiveSnapshot({
          databaseId: match.product.databaseId,
          menuNumber: match.product.menuNumber,
          name: match.product.name,
          categoryIds: match.product.categoryIds,
          description: match.product.description,
          basePriceOre: match.product.basePriceOre,
          variants: match.product.variants,
          ingredients: match.product.ingredients.map((i) => i.name),
          additions: match.product.additions,
        });

        const menuForLabel =
          product.assignedMenuNumber ?? product.sourceMenuNumber ?? "";
        const learned =
          input.decisionStore != null
            ? lookupLearnedLabelCorrection(input.decisionStore, {
                restaurantKey: input.restaurant,
                menuNumber: menuForLabel,
                name: product.name,
                ingredients: product.ingredients.map((i) => i.display),
              })
            : null;
        const labelAssessment = assessLabelQuality({
          name: learned?.name ?? product.name,
          description: learned?.description ?? product.description ?? "",
          ingredients:
            learned?.ingredients ??
            product.ingredients.map((i) => i.display),
        });
        const sourcePayload = toPayload(
          product,
          categoryIds,
          learned
            ? {
                name: learned.name,
                description: learned.description ?? "",
                ingredients: learned.ingredients,
              }
            : {
                name: labelAssessment.repaired.name,
                description: labelAssessment.repaired.description,
                ingredients: labelAssessment.repaired.ingredients,
              },
          structurePattern,
          input.probabilityPolicy,
          category.name,
          input.ingredientLikelihood,
        );
        const liveCategoryName =
          liveSnapshotCategoryName(live, input.destination.categories) ||
          category.name;
        // Live-first quality merge: never overwrite good live with worse source/PDF.
        const intended = buildQaTargetPayload({
          live,
          sourcePayload,
          liveCategoryName,
          destinationCategories: input.destination.categories,
          ...(input.ingredientLikelihood != null
            ? { ingredientLikelihood: input.ingredientLikelihood }
            : {}),
          ...(input.probabilityPolicy != null
            ? { probabilityPolicy: input.probabilityPolicy }
            : {}),
        });
        const liveRecovered = recoverProductLabelsForReconcile({
          name: live.name,
          description: live.description ?? intended.description,
          ingredients: live.ingredients ?? intended.ingredients,
          ...(liveCategoryName ? { categoryName: liveCategoryName } : {}),
        });
        const labelReasons = [...new Set(liveRecovered.reasons)];

        const rawDiff = diffProductReconcile({
          live,
          intended,
          capabilities: input.capabilities,
          labelReasons,
        });
        const { kept, blocked } = filterNeverWorseDeltas({
          live,
          intended,
          deltas: rawDiff.deltas,
          liveCategoryName,
        });
        const diff: ProductReconcileDiff = {
          ...rawDiff,
          deltas: kept,
          blockedWorseThanLive: blocked,
          canUpdate:
            kept.length > 0 && rawDiff.missingCapabilities.length === 0,
        };
        input.reconcileDiffs?.push(diff);

        const safeDeltas = diff.deltas.filter((d) =>
          PORTAL_OPDATER_RECONCILE_FIELDS.includes(d.field),
        );
        const unsafeDeltas = diff.deltas.filter(
          (d) => !PORTAL_OPDATER_RECONCILE_FIELDS.includes(d.field),
        );

        if (diff.deltas.length === 0) {
          const worseNote =
            blocked.length > 0
              ? `; blocked worse-than-live: ${blocked
                  .map((d) => d.field)
                  .join(",")}`
              : "";
          operations.push(
            planSkipProduct({
              operationId,
              identity: {
                ...identity,
                destinationDatabaseId: match.product.databaseId,
              },
              reason: `QA reconcile: live already good / no safe improvements${worseNote}`,
            }),
          );
          continue;
        }

        const blockReason = qaTargetHasWriteBlockingIssues(
          intended,
          liveCategoryName,
        );
        if (blockReason) {
          operations.push(
            planReviewProduct({
              operationId,
              identity: {
                ...identity,
                destinationDatabaseId: match.product.databaseId,
              },
              reason: `QA reconcile write gate: ${blockReason}`,
            }),
          );
          continue;
        }

        if (safeDeltas.length === 0) {
          operations.push(
            planBlockProduct({
              operationId,
              identity: {
                ...identity,
                destinationDatabaseId: match.product.databaseId,
              },
              reason: `QA reconcile: diffs only on fields outside portal Opdater card (${unsafeDeltas
                .map((d) => d.field)
                .join(",")})`,
              missingCapabilities: [
                "portalOpdaterFullCard",
                ...diff.missingCapabilities,
              ],
            }),
          );
          continue;
        }

        const requiredCaps = capabilitiesForReconcileFields(
          safeDeltas.map((d) => d.field),
        );
        const missingUpd = missingReconcileCapabilities(
          requiredCaps,
          input.capabilities,
        );
        if (missingUpd.length) {
          operations.push(
            planBlockProduct({
              operationId,
              identity: {
                ...identity,
                destinationDatabaseId: match.product.databaseId,
              },
              reason: `QA reconcile: missing certified caps ${missingUpd.join(",")}`,
              missingCapabilities: missingUpd,
            }),
          );
          continue;
        }

        operations.push(
          planUpdateProduct({
            operationId,
            identity: {
              ...identity,
              destinationDatabaseId: match.product.databaseId,
            },
            payload: intended,
            reason:
              unsafeDeltas.length > 0 || blocked.length > 0
                ? `QA live-first Opdater; deferred: ${[
                    ...unsafeDeltas.map((d) => d.field),
                    ...blocked.map((d) => `${d.field}:worse`),
                  ].join(",")}`
                : "QA live-first Opdater (improve live, never worse)",
            requiredCapabilities: requiredCaps,
            missingCapabilities: [],
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

      const menuForLabel =
        product.assignedMenuNumber ?? product.sourceMenuNumber ?? "";
      const learned =
        input.decisionStore != null
          ? lookupLearnedLabelCorrection(input.decisionStore, {
              restaurantKey: input.restaurant,
              menuNumber: menuForLabel,
              name: product.name,
              ingredients: product.ingredients.map((i) => i.display),
            })
          : null;
      const labelAssessment = assessLabelQuality({
        name: learned?.name ?? product.name,
        description:
          learned?.description ?? product.description ?? "",
        ingredients:
          learned?.ingredients ??
          product.ingredients.map((i) => i.display),
      });
      if (!learned && labelQualityBlocksWrite(labelAssessment)) {
        operations.push(
          planReviewProduct({
            operationId,
            identity,
            reason: `LABEL_QUALITY_${labelAssessment.severity}: ${labelAssessment.reasons.join(",")}; correct name/ingredients before create`,
          }),
        );
        continue;
      }

      operations.push(
        planCreateProduct({
          operationId,
          payload: toPayload(
            product,
            categoryIds,
            learned
              ? {
                  name: learned.name,
                  description: learned.description ?? "",
                  ingredients: learned.ingredients,
                }
              : {
                  name: labelAssessment.repaired.name,
                  description: labelAssessment.repaired.description,
                  ingredients: labelAssessment.repaired.ingredients,
                },
            structurePattern,
            input.probabilityPolicy,
            category.name,
            input.ingredientLikelihood,
          ),
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
