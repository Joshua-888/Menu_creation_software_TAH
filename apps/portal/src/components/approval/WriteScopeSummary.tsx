import { Badge, Panel } from "../ui";
import {
  buildWriteScopeSummary,
  type WriteScopeInput,
} from "./approvalView.js";

/**
 * What approval will actually write: category/product creates plus unsupported
 * capabilities. Category creation is customer-facing immediately and products
 * are staged hidden — disclosed verbatim, never softened.
 */
export function WriteScopeSummary({ input }: { input: WriteScopeInput }) {
  const summary = buildWriteScopeSummary(input);
  return (
    <Panel title="Write scope">
      <table className="ui-table">
        <tbody>
          {summary.rows.map((row) => (
            <tr className="ui-table-row" key={row.label}>
              <td>{row.label}</td>
              <td>
                <Badge tone={row.tone}>{row.value}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
