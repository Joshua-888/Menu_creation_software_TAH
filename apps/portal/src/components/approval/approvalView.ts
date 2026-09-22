/**
 * Pure presentation logic for the operator approval panel: bundle identity
 * summary and WritePlan write-scope breakdown. Mirrors `src/portal/menuView.ts`
 * — display only. It never regenerates hashes, edits a bundle or re-runs
 * planning; approval must bind the exact frozen ExecutionBundle shown here.
 */

export type ApprovalBadgeTone = "ok" | "warn" | "danger" | "neutral";

/** Read-only projection of execution-bundle.json (older jobs may lack fields). */
export type ExecutionBundleView = {
  bundleVersion?: string | null;
  restaurantKey?: string | null;
  destinationHost?: string | null;
  destinationIdentity?: string | null;
  productionSha?: string | null;
  adapterVersion?: string | null;
  contractFingerprint?: string | null;
  targetMenuHash?: string | null;
  destinationSnapshotHash?: string | null;
  writePlanHash?: string | null;
  createdAt?: string | null;
  operationCount?: number | null;
  capabilityRequirements?: readonly string[] | null;
  qualityStatus?: string | null;
};

export type BundleIdentityRow = { label: string; value: string };

/**
 * Bundle identity rows for BundleIdentityCard. Only the approved
 * ExecutionBundle is shown — never a recomputed or client-side hash. Missing
 * values degrade to "—" rather than hiding the row.
 */
export function buildBundleIdentityRows(
  bundle: ExecutionBundleView | null,
): BundleIdentityRow[] {
  if (!bundle) return [];
  return [
    { label: "Bundle version", value: bundle.bundleVersion ?? "—" },
    { label: "Target menu hash", value: bundle.targetMenuHash ?? "—" },
    { label: "WritePlan hash", value: bundle.writePlanHash ?? "—" },
    {
      label: "Destination snapshot hash",
      value: bundle.destinationSnapshotHash ?? "—",
    },
    { label: "Production SHA", value: bundle.productionSha ?? "—" },
    { label: "Contract fingerprint", value: bundle.contractFingerprint ?? "—" },
    { label: "Adapter version", value: bundle.adapterVersion ?? "—" },
    { label: "Destination host", value: bundle.destinationHost ?? "—" },
    { label: "Destination identity", value: bundle.destinationIdentity ?? "—" },
    { label: "Created at", value: bundle.createdAt ?? "—" },
  ];
}

/**
 * Artifact-derived write scope rows. Only deterministic facts are summarised:
 * approval.json `writePlan` counts (when present) or ExecutionBundle operation
 * counts plus capability evidence. Nothing here decides menu semantics.
 */
export type WriteScopeRow = { label: string; value: string; tone: ApprovalBadgeTone };

export type WriteScopeSummary = {
  categoryCreates: number | null;
  productCreates: number | null;
  choiceModifiers: number | null;
  additions: number | null;
  unsupportedCapabilities: string[];
  operationCount: number | null;
  rows: WriteScopeRow[];
};

export type WriteScopeInput = {
  /** `writePlan` block from awaiting-operator-approval.json, when present. */
  writePlan?: {
    categoryCreates?: number | null;
    productCreates?: number | null;
  } | null;
  /** Frozen ExecutionBundle, when present. */
  bundle?: ExecutionBundleView | null;
  /** Artifact `targetMenu` block (category/product counts). */
  targetMenu?: { categoryCount?: number | null; productCount?: number | null } | null;
  /** Destructive/skip signals surface as unsupported capability warnings. */
  missingCapabilities?: readonly string[] | null;
};

function count(value: number | null | undefined): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Build the write-scope breakdown shown before approval. Category creation is
 * customer-facing immediately; products are staged hidden — those facts are
 * reported verbatim and never softened.
 */
export function buildWriteScopeSummary(
  input: WriteScopeInput,
): WriteScopeSummary {
  const categoryCreates =
    count(input.writePlan?.categoryCreates) ?? count(input.targetMenu?.categoryCount);
  const productCreates =
    count(input.writePlan?.productCreates) ?? count(input.targetMenu?.productCount);
  const operationCount = count(input.bundle?.operationCount);
  const capabilities = input.bundle?.capabilityRequirements ?? [];
  const missing = [...(input.missingCapabilities ?? [])];
  const unsupported = missing.filter(
    (name) => !capabilities.includes(name),
  );

  return {
    categoryCreates,
    productCreates,
    // Choice modifiers / additions are carried inside product payloads, so they
    // are not separately counted in the frozen operation list. Report unknown.
    choiceModifiers: null,
    additions: null,
    unsupportedCapabilities: unsupported,
    operationCount,
    rows: [
      {
        label: "Category creates (customer-facing immediately)",
        value: categoryCreates === null ? "—" : String(categoryCreates),
        tone: "warn",
      },
      {
        label: "Product creates (staged hidden by default)",
        value: productCreates === null ? "—" : String(productCreates),
        tone: "neutral",
      },
      { label: "Choice modifiers", value: "—", tone: "neutral" },
      { label: "Additions", value: "—", tone: "neutral" },
      {
        label: "Unsupported capabilities",
        value: unsupported.length === 0 ? "none" : unsupported.join(", "),
        tone: unsupported.length === 0 ? "ok" : "warn",
      },
      {
        label: "Total operations in bundle",
        value: operationCount === null ? "—" : String(operationCount),
        tone: "neutral",
      },
    ],
  };
}

/** True when the quality contract blocks approval. */
export function isQualityBlocked(
  menuStatus: string | null | undefined,
): boolean {
  return menuStatus === "MENU_QUALITY_BLOCKED";
}

export type ApprovalDisabledInput = {
  coverageBlocked: boolean;
  coverageDetail?: string | null;
  menuStatus: string | null | undefined;
};

/**
 * The Part-A safety rule for the UI: refusal message(s) that disable approval,
 * or `undefined` when approval may proceed. A BLOCKED quality contract always
 * wins over the source-coverage message.
 */
export function approvalDisabledReason(
  input: ApprovalDisabledInput,
): string | undefined {
  if (isQualityBlocked(input.menuStatus)) {
    return "TargetMenu quality is BLOCKED. Cannot approve blocked menus.";
  }
  if (input.coverageBlocked) {
    return (
      input.coverageDetail ??
      "Source coverage is suspicious; re-extract before approval."
    );
  }
  return undefined;
}
