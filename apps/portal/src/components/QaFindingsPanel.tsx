import { readJobArtifact } from "@engine/portal/index.js";

type ReconcileDelta = {
  field?: string;
  reasons?: string[];
};

type ReconcileProduct = {
  menuNumber?: string;
  liveName?: string;
  intendedName?: string;
  canUpdate?: boolean;
  deltas?: ReconcileDelta[];
};

type ReconcileReport = {
  withDiffs?: number;
  updatable?: number;
  blocked?: number;
  fingerprint?: string;
  productCount?: number;
  products?: ReconcileProduct[];
};

/** QA findings panel from menu-reconcile.json (top diffs). */
export function QaFindingsPanel({ jobId }: { jobId: string }) {
  const report = readJobArtifact(jobId, "menu-reconcile.json") as ReconcileReport | null;
  if (!report) {
    return (
      <p className="muted">
        No findings yet — they appear after the live destination snapshot and
        dry-run finish.
      </p>
    );
  }

  const drifted = (report.products ?? []).filter(
    (p) => (p.deltas?.length ?? 0) > 0,
  );
  const preview = drifted.slice(0, 12);

  return (
    <div>
      <div className="metrics" style={{ marginTop: "0.5rem" }}>
        <div className="metric">
          <strong>{report.productCount ?? "—"}</strong>
          <span className="muted">Compared</span>
        </div>
        <div className="metric">
          <strong>{report.withDiffs ?? 0}</strong>
          <span className="muted">With diffs</span>
        </div>
        <div className="metric">
          <strong>{report.updatable ?? 0}</strong>
          <span className="muted">Will update</span>
        </div>
        <div className="metric">
          <strong>{report.blocked ?? 0}</strong>
          <span className="muted">Blocked</span>
        </div>
      </div>
      {preview.length ? (
        <ul className="qa-findings-list">
          {preview.map((p, i) => (
            <li key={`${p.menuNumber ?? i}-${p.liveName ?? ""}`}>
              <strong>#{p.menuNumber ?? "?"}</strong>{" "}
              <span className="muted">
                {p.liveName ?? "?"} → {p.intendedName ?? "?"}
              </span>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                {(p.deltas ?? [])
                  .map((d) => d.field)
                  .filter(Boolean)
                  .join(", ")}
                {p.canUpdate === false ? " · blocked" : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          No product diffs — live menu already matches intended state.
        </p>
      )}
      {drifted.length > preview.length ? (
        <p className="muted">
          Showing {preview.length} of {drifted.length} products with diffs.
          Full report: <code>menu-reconcile.json</code>
        </p>
      ) : null}
    </div>
  );
}
