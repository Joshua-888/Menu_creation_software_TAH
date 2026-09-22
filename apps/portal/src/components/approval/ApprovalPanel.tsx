import { ApproveCreateMenuButton } from "../ApproveCreateMenuButton";
import { Badge, Panel } from "../ui";
import { BundleIdentityCard } from "./BundleIdentityCard";
import { WriteScopeSummary } from "./WriteScopeSummary";
import {
  approvalDisabledReason,
  type ExecutionBundleView,
  type WriteScopeInput,
} from "./approvalView.js";

/**
 * Operator approval surface. It replaces the previous bare approval button and
 * states exactly what approval binds:
 *
 * - the frozen ExecutionBundle identity (hashes, production SHA, adapter),
 * - the write scope (category creates are customer-facing immediately;
 *   products are staged hidden),
 * - unresolved warnings,
 * - and the Part-A safety guard: a BLOCKED TargetMenu quality contract disables
 *   approval even when source coverage is not suspicious.
 *
 * Display only — approval itself still goes through the API, which re-checks
 * the quality contract server-side.
 */
export function ApprovalPanel({
  jobId,
  merchantName,
  destinationHost,
  workflow,
  targetMenuVersion,
  categoryCount,
  productCount,
  unresolvedWarningCount,
  bundle,
  writeScope,
  coverageBlocked,
  coverageDetail,
  menuStatus,
}: {
  jobId: string;
  merchantName: string;
  destinationHost: string;
  workflow: "CREATE_MENU" | "QA_RECONCILE";
  targetMenuVersion: string | null;
  categoryCount: number | null;
  productCount: number | null;
  unresolvedWarningCount: number;
  bundle: ExecutionBundleView | null;
  writeScope: WriteScopeInput;
  coverageBlocked: boolean;
  coverageDetail?: string | null;
  menuStatus: string | null | undefined;
}) {
  const disabledReason = approvalDisabledReason({
    coverageBlocked,
    coverageDetail: coverageDetail ?? null,
    menuStatus,
  });
  const qualityBlocked = menuStatus === "MENU_QUALITY_BLOCKED";

  return (
    <Panel title="Operator approval required">
      <table className="ui-table">
        <tbody>
          <tr className="ui-table-row">
            <td>
              <span className="muted">Restaurant</span>
            </td>
            <td>{merchantName}</td>
          </tr>
          <tr className="ui-table-row">
            <td>
              <span className="muted">Destination</span>
            </td>
            <td>
              <code>{destinationHost}</code>
            </td>
          </tr>
          <tr className="ui-table-row">
            <td>
              <span className="muted">Workflow</span>
            </td>
            <td>
              {workflow === "QA_RECONCILE" ? "Quality check" : "Create menu"}
            </td>
          </tr>
          <tr className="ui-table-row">
            <td>
              <span className="muted">Target menu version</span>
            </td>
            <td>
              <code>{targetMenuVersion ?? "—"}</code>
            </td>
          </tr>
          <tr className="ui-table-row">
            <td>
              <span className="muted">Categories / products</span>
            </td>
            <td>
              {categoryCount ?? "—"} categories · {productCount ?? "—"} products
            </td>
          </tr>
          <tr className="ui-table-row">
            <td>
              <span className="muted">Unresolved warnings</span>
            </td>
            <td>
              {unresolvedWarningCount === 0 ? (
                <Badge tone="ok">none</Badge>
              ) : (
                <Badge tone="warn">{unresolvedWarningCount}</Badge>
              )}
            </td>
          </tr>
          <tr className="ui-table-row">
            <td>
              <span className="muted">Quality contract</span>
            </td>
            <td>
              <Badge tone={qualityBlocked ? "danger" : "neutral"}>
                {menuStatus ?? "unknown"}
              </Badge>
            </td>
          </tr>
        </tbody>
      </table>

      <p className="muted" style={{ marginTop: "0.75rem" }}>
        Approval binds the exact frozen ExecutionBundle and TargetMenu version
        shown above. After approval there is no replanning, no TargetMenu
        mutation and no policy reapplication — execution uses only the approved
        bundle. Category creation is customer-facing immediately; products are
        staged hidden unless storefront publishing was explicitly enabled.
      </p>

      <WriteScopeSummary input={writeScope} />
      <BundleIdentityCard bundle={bundle} />

      <ApproveCreateMenuButton jobId={jobId} disabledReason={disabledReason} />
    </Panel>
  );
}
