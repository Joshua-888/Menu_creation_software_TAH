import type { ReactNode } from "react";

/**
 * StatTile — thin wrapper over the existing `.dash-stat` / `.dash-stat-value` /
 * `.dash-stat-label` classes.
 */
export function StatTile({
  value,
  label,
}: {
  value: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className="dash-stat">
      <span className="dash-stat-value">{value}</span>
      <span className="dash-stat-label">{label}</span>
    </div>
  );
}

/** Grid container for a row of StatTiles. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="dash-stats">{children}</div>;
}

export const MetricTile = StatTile;
