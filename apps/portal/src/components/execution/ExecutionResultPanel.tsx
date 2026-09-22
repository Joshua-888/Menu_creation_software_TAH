import { StatGrid, StatTile } from "../ui";
import {
  buildExecutionResultTiles,
  type LiveExecuteResultView,
} from "./executionView.js";

/**
 * Structured replacement for the previous raw `JSON.stringify(liveResult)`
 * dump. Missing evidence shows "—"; nothing is inferred.
 */
export function ExecutionResultPanel({
  result,
}: {
  result: LiveExecuteResultView | null;
}) {
  const tiles = buildExecutionResultTiles(result);
  if (tiles.length === 0) {
    return <p className="muted">No live execute result yet for this job.</p>;
  }
  return (
    <StatGrid>
      {tiles.map((tile) => (
        <StatTile key={tile.label} value={tile.value} label={tile.label} />
      ))}
    </StatGrid>
  );
}
