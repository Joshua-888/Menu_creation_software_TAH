import { Panel } from "../ui";
import {
  buildBundleIdentityRows,
  type ExecutionBundleView,
} from "./approvalView.js";

/**
 * Read-only identity of the exact frozen ExecutionBundle that approval binds.
 * Hashes are shown monospace; nothing here regenerates or edits a bundle.
 */
export function BundleIdentityCard({
  bundle,
}: {
  bundle: ExecutionBundleView | null;
}) {
  const rows = buildBundleIdentityRows(bundle);
  if (rows.length === 0) {
    return (
      <Panel title="Execution bundle">
        <p className="muted">
          No execution-bundle.json yet. It is written after the dry-run
          WritePlan is frozen.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Execution bundle (approved version)">
      <table className="ui-table">
        <tbody>
          {rows.map((row) => (
            <tr className="ui-table-row" key={row.label}>
              <td>
                <span className="muted">{row.label}</span>
              </td>
              <td>
                <code style={{ wordBreak: "break-all" }}>{row.value}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
