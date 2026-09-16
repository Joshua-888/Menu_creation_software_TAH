/**
 * Build Bella RecoveryPlan artifact — NO execution / NO mutations.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const outDir = resolve(root, "runs/bella-recovery-prep");
mkdirSync(outDir, { recursive: true });

const sourceJpeg = readFileSync(
  resolve(root, "fixtures/golden/bella-kebab/raw-source.jpeg"),
);
const sourceHash = createHash("sha256").update(sourceJpeg).digest("hex");
const targetMenu = JSON.parse(
  readFileSync(resolve(outDir, "bella-target-menu.json"), "utf8"),
);
const quality = JSON.parse(
  readFileSync(resolve(outDir, "bella-quality.json"), "utf8"),
);
const preview = JSON.parse(
  readFileSync(resolve(outDir, "BELLA_MENU_PREVIEW.json"), "utf8"),
);

const productionSha = "d1828c832db1eff8ec72fa1fed07e60f58fa4e6f";
const constitutionVersion = "MenuConstitutionV1";

const destinationBefore = {
  host: "bellakebab.dk",
  capturedAt: new Date().toISOString(),
  categories: [
    {
      databaseId: "1",
      name: "PIZZA",
      productCount: 0,
      visibility: "public",
      classification: "INCIDENT_ORPHAN_CATEGORY",
      incidentJobId: "job_eab4d417-32c1-44a0-97c2-7bb4c3bea48f",
      incidentEvidence:
        "Created by failed Create run live-run_e8a2ae86; live-runs.sqlite destination_id=1 VERIFIED; destination previously empty",
    },
  ],
  products: [],
};

const destinationBeforeHash = createHash("sha256")
  .update(JSON.stringify(destinationBefore))
  .digest("hex");

const targetMenuHash = createHash("sha256")
  .update(JSON.stringify(targetMenu))
  .digest("hex");

const reviewProducts = quality.products.filter(
  (p) => p.status !== "QUALITY_READY",
);

const consolidatedReviews = [
  {
    decisionId: "bella-review-combo-contents",
    type: "MENU_COMBO_SEMANTICS_UNCERTAINTY",
    title: "Confirm Menu/combo contents for priced Menu products",
    affectedProducts: reviewProducts
      .filter((p) =>
        p.checks.some((c) => c.id === "COMBO_STRUCTURE_VALID" && !c.pass),
      )
      .map((p) => ({
        menuNumber: p.menuNumber,
        name: p.name,
        sourceId: p.productSourceId,
      })),
    sourceEvidence:
      "Printed descriptions: Durum/Lille/Stor pita menus say 'Kebab, sodavand og pomfritter'; Pomfrit+nuggets menu says 'Ketchup el. salat mayonnaise' (dip choice) with fries+nuggets implied by title; Hamburger menu says 'Pomfritter og sodavand'.",
    currentInterpretation:
      "Products marked isCombo=true but ProductChoices/combo components empty → COMBO_CONTENTS_UNRESOLVED",
    unresolved:
      "Exact selectable components / whether sodavand+pomfritter are fixed inclusions vs choices",
    recommendedInterpretation:
      "Treat durum/pita *menu* lines as fixed combo contents: primary item + sodavand + pomfritter (source-supported). Treat Pomfrit+6 nuggets menu as combo of pomfritter + 6 nuggets with dressing choice ketchup|salat mayonnaise. Do NOT invent unstated items.",
    alternatives: [
      "Leave menus as single products with description-only (no structured ProductChoice) until operator provides explicit choice schema",
      "Model sodavand/pomfritter as additions instead of combo components",
    ],
    proposedScope: "restaurant",
  },
  {
    decisionId: "bella-review-durum-kebab-ingredients",
    type: "OCR_DESCRIPTION_UNCERTAINTY",
    title: "Confirm Durum Kebab ingredients / dressing choice text",
    affectedProducts: reviewProducts
      .filter((p) => /durum kebab/i.test(p.name))
      .map((p) => ({
        menuNumber: p.menuNumber,
        name: p.name,
        sourceId: p.productSourceId,
      })),
    sourceEvidence:
      "Printed: 'Creme fraiche dressing el. tahin dressing' under Durum Kebab; OCR produced fragmented 'Creme fraiche aiche dressing el. t ahin dressing'",
    currentInterpretation:
      "Quality flags INGREDIENTS_COMPLETE / incomplete food ingredients despite OCR dressing line",
    unresolved:
      "Whether dressing line is ProductChoice (creme fraiche|tahin) vs ingredient list; protein fill (kebab) implied by name",
    recommendedInterpretation:
      "Ingredients/protein: Kebab (from product name). Add ProductChoice dressing: Creme fraiche dressing | Tahin dressing (source 'el.').",
    alternatives: [
      "Keep description-only dressing text without ProductChoice",
      "Human-correct OCR description verbatim from photo without structured choice",
    ],
    proposedScope: "single",
  },
];

const plannedCategoriesFromTarget = targetMenu.categories.map((c) => c.name);

const recoveryOperations = [
  {
    operationId: "recover-orphan-pizza-1",
    entityType: "category",
    action: "DELETE",
    classification: "INCIDENT_ORPHAN_CATEGORY",
    identity: { destinationDatabaseId: "1", name: "PIZZA" },
    state: "NOT_STARTED",
    proposedAction: "compensate",
    executable: false,
    blocker: "DELETE_CAPABILITY_UNCERTIFIED",
    notes:
      "deleteCategory is not CERTIFIED in M2B adapter capabilities. Do not delete until separate delete certification with read-back.",
  },
  ...plannedCategoriesFromTarget.map((name, idx) => ({
    operationId: `recover-cat-create-${idx + 1}`,
    entityType: "category",
    action: "CREATE",
    identity: { name },
    state: "NOT_STARTED",
    proposedAction: "continue",
    executable: false,
    intendedHidden: false,
    customerFacingWarning: true,
    notes: "Category create is customer-facing on TAH; stage products hidden.",
  })),
  ...targetMenu.categories.flatMap((c) =>
    c.products.map((p, idx) => ({
      operationId: `recover-prod-create-${c.sourceId}-${idx + 1}`,
      entityType: "product",
      action: "CREATE",
      identity: {
        sourceId: p.sourceId,
        menuNumber: p.assignedMenuNumber ?? p.sourceMenuNumber,
        name: p.name,
        categoryName: c.name,
      },
      state: "NOT_STARTED",
      proposedAction: "continue",
      executable: false,
      intendedHidden: true,
      qualityStatus:
        quality.products.find((q) => q.productSourceId === p.sourceId)
          ?.status ?? null,
    })),
  ),
];

const planBody = {
  schemaVersion: "1",
  planKind: "BELLA_INCIDENT_RECOVERY",
  executeAutomatically: false,
  publicationOperations: 0,
  generatedAt: new Date().toISOString(),
  productionSha,
  constitutionVersion,
  merchantName: "Bella Kebab",
  destinationHost: "bellakebab.dk",
  hashes: {
    sourceHash,
    targetMenuHash,
    destinationBeforeHash,
    // recoveryPlanHash filled after body stabilized
  },
  qualityGate: {
    ready: quality.statusAccounting.ready,
    review: quality.statusAccounting.review,
    blocked: quality.statusAccounting.blocked,
    menuStatus: quality.menuStatus,
    writeEligible: quality.statusAccounting.review === 0 &&
      quality.statusAccounting.blocked === 0,
  },
  consolidatedHumanReviews: consolidatedReviews,
  decisionsReceived: [],
  destinationBefore,
  orphanCategory: destinationBefore.categories[0],
  deleteCapability: {
    deleteCategory: "UNCERTIFIED",
    deleteProduct: "UNCERTIFIED",
    requiredCertification:
      "Separate M? deleteCategory live canary: create empty canary category → delete → list read-back proves absence; never use Bella as canary.",
  },
  counts: {
    plannedCategoryDeletes: 1,
    plannedCategoryDeletesExecutable: 0,
    plannedCategoryCreates: plannedCategoriesFromTarget.length,
    plannedProductCreates: preview.products.length,
    plannedProductUpdates: 0,
    plannedProductDeletes: 0,
    plannedPublicationOperations: 0,
  },
  operations: recoveryOperations,
  executionArchitecture: [
    "OPERATOR_APPROVES_RECOVERY_PLAN",
    "COMPENSATE_ORPHAN_IF_DELETE_CERTIFIED",
    "CREATE_CATEGORIES",
    "CREATE_PRODUCTS_HIDDEN",
    "VERIFY_ALL_PRODUCTS",
    "VERIFY_NORMALIZED_MENU",
    "SEPARATE_PUBLICATION_ACTION",
  ],
};

const recoveryPlanHash = createHash("sha256")
  .update(JSON.stringify(planBody))
  .digest("hex");
planBody.hashes.recoveryPlanHash = recoveryPlanHash;

const artifactPath = resolve(outDir, "BELLA_RECOVERY_PLAN.json");
writeFileSync(artifactPath, JSON.stringify(planBody, null, 2));

writeFileSync(
  resolve(outDir, "BELLA_REVIEW_QUESTIONS.md"),
  [
    "# Bella consolidated human review questions",
    "",
    `Quality: READY=${quality.statusAccounting.ready} REVIEW=${quality.statusAccounting.review} BLOCKED=${quality.statusAccounting.blocked}`,
    "",
    ...consolidatedReviews.flatMap((q, i) => [
      `## ${i + 1}. ${q.title}`,
      `- Type: ${q.type}`,
      `- Decision id: ${q.decisionId}`,
      `- Affected: ${q.affectedProducts.map((p) => `${p.menuNumber} ${p.name}`).join("; ")}`,
      `- Source evidence: ${q.sourceEvidence}`,
      `- Current interpretation: ${q.currentInterpretation}`,
      `- Unresolved: ${q.unresolved}`,
      `- Recommended: ${q.recommendedInterpretation}`,
      `- Alternatives: ${q.alternatives.join(" | ")}`,
      `- Proposed scope: ${q.proposedScope}`,
      "",
    ]),
    "No decisions have been applied yet. Reply with accept/modify per decision id.",
  ].join("\n"),
);

console.log(
  JSON.stringify(
    {
      artifactPath,
      sourceHash,
      targetMenuHash,
      destinationBeforeHash,
      recoveryPlanHash,
      ready: quality.statusAccounting.ready,
      review: quality.statusAccounting.review,
      blocked: quality.statusAccounting.blocked,
      plannedProductCreates: planBody.counts.plannedProductCreates,
      deleteCertified: false,
    },
    null,
    2,
  ),
);
