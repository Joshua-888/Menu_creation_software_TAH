"use client";

import { useEffect } from "react";
import type { MenuProductView } from "@engine/portal/menuView.js";
import { buildProvenanceView, originLabel } from "@engine/portal/menuView.js";
import { Badge } from "../ui/Badge";

function OriginPill({ origin }: { origin: string | null }) {
  if (!origin) return <span className="muted">unknown</span>;
  return <span className="origin-chip">{originLabel(origin as never)}</span>;
}

/**
 * Provenance drawer for one product: source evidence, field origins, the
 * source↔target diff and the quality-contract checks. Purely explanatory — it
 * exposes recorded pipeline facts and never edits them.
 */
export function ProductProvenanceModal({
  view,
  onClose,
}: {
  view: MenuProductView;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const model = buildProvenanceView({
    product: view.product,
    sourceProduct: view.sourceProduct,
    qualityProduct: view.quality,
  });

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Provenance for ${view.product.name}`}
      >
        <div className="modal-head">
          <div>
            <h3 className="modal-title">
              {view.menuNumber ? `#${view.menuNumber} ` : ""}
              {view.product.name}
            </h3>
            <div className="modal-sub">
              <Badge tone={view.tone}>{view.statusLabel}</Badge>
              <span className="muted">{view.priceLabel}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="modal-body">
          <section className="modal-section">
            <h4 className="modal-section-title">Source evidence</h4>
            {model.evidence ? (
              <>
                <div className="modal-meta">
                  <span>
                    Page:{" "}
                    <strong>{model.evidence.pageNumber ?? "—"}</strong>
                  </span>
                  <span>
                    Section:{" "}
                    <strong>{model.evidence.sourceSection ?? "—"}</strong>
                  </span>
                  <span>
                    Confidence:{" "}
                    <strong>
                      {model.evidence.confidence != null
                        ? `${Math.round(model.evidence.confidence * 100)}%`
                        : "—"}
                    </strong>
                  </span>
                  <span>
                    Origin: <strong>{model.evidence.origin ?? "—"}</strong>
                  </span>
                </div>
                {model.evidence.rawText ? (
                  <pre className="modal-code">{model.evidence.rawText}</pre>
                ) : (
                  <p className="muted">No raw source text recorded.</p>
                )}
              </>
            ) : (
              <p className="muted">No source evidence recorded for this line.</p>
            )}
          </section>

          <section className="modal-section">
            <h4 className="modal-section-title">Field provenance</h4>
            {model.fields.length === 0 ? (
              <p className="muted">No derived fields to show.</p>
            ) : (
              <ul className="provenance-list">
                {model.fields.map((field, index) => (
                  <li key={`${field.field}-${index}`}>
                    <span className="provenance-field">{field.field}</span>
                    <span className="provenance-value">{field.value}</span>
                    <OriginPill origin={field.origin} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="modal-section">
            <h4 className="modal-section-title">Source vs target</h4>
            {model.diffs.length === 0 ? (
              <p className="muted">
                No matching source product — showing target values only.
              </p>
            ) : (
              <ul className="diff-list">
                {model.diffs.map((diff) => (
                  <li
                    key={diff.field}
                    className={diff.changed ? "diff-row diff-changed" : "diff-row"}
                  >
                    <span className="diff-field">{diff.field}</span>
                    <span className="diff-source">
                      {diff.source ?? <span className="muted">—</span>}
                    </span>
                    <span className="diff-arrow">→</span>
                    <span className="diff-target">
                      {diff.target ?? <span className="muted">—</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="modal-section">
            <h4 className="modal-section-title">Quality contract checks</h4>
            {model.checks.length === 0 ? (
              <p className="muted">
                No quality-contract result for this product (no contract
                artifact).
              </p>
            ) : (
              <ul className="check-list">
                {model.checks.map((check) => (
                  <li key={check.id} className="check-row">
                    <Badge tone={check.pass ? "ok" : "danger"}>
                      {check.pass ? "pass" : "fail"}
                    </Badge>
                    <span className="check-id">{check.id}</span>
                    {check.detail ? (
                      <span className="muted">{check.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {model.blockers.length > 0 ? (
              <div className="product-alert product-alert-danger">
                {model.blockers.map((blocker) => (
                  <div key={blocker}>{blocker}</div>
                ))}
              </div>
            ) : null}
            {model.completenessWarnings.length > 0 ? (
              <div className="product-alert product-alert-warn">
                {model.completenessWarnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            ) : null}
            {model.issues.length > 0 ? (
              <ul className="product-issue-list">
                {model.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    <Badge
                      tone={
                        issue.severity === "BLOCKED"
                          ? "danger"
                          : issue.severity === "MANUAL_REVIEW_REQUIRED" ||
                              issue.severity === "WARNING"
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {issue.code}
                    </Badge>{" "}
                    <span className="muted">{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
