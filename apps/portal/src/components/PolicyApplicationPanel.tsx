import type { PolicyApplicationReport } from "@engine/learning/policyApplicationReport.js";

type Props = {
  report: PolicyApplicationReport;
};

function fingerprintShort(fp: string | undefined | null): string {
  if (!fp) return "—";
  return fp.length > 64 ? `${fp.slice(0, 64)}…` : fp;
}

export function PolicyApplicationPanel({ report }: Props) {
  const structure = report.knowledge.structureSemanticRule;
  const prob = report.knowledge.probabilityPolicy;
  const facts = report.knowledge.restaurantBusinessFacts;
  const interesting = report.products
    .filter(
      (t) =>
        t.removed.length > 0 ||
        t.fanOutTilbehor ||
        t.reasonCodes.some((c) => c.startsWith("STRUCTURE_")),
    )
    .slice(0, 12);

  return (
    <div className="panel">
      <h2>Applied policies</h2>
      <p className="muted">
        Owner audit of SEMANTIC_RULE vs BUSINESS_FACT that shaped this dry-run (
        {report.runId})
      </p>

      <div className="metrics" style={{ marginBottom: "1rem" }}>
        <div className="metric">
          <strong>{report.summary.productCount}</strong>
          <span className="muted">Products traced</span>
        </div>
        <div className="metric">
          <strong>{report.summary.withRemovals}</strong>
          <span className="muted">With removals</span>
        </div>
        <div className="metric">
          <strong>{prob?.dipAllowKinds.join(", ") || "—"}</strong>
          <span className="muted">Dip allow kinds</span>
        </div>
      </div>

      <h3 style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>
        SEMANTIC_RULE — structure
      </h3>
      {structure ? (
        <ul style={{ marginTop: 0 }}>
          <li>
            Fingerprint:{" "}
            <code title={structure.fingerprint}>
              {fingerprintShort(structure.fingerprint)}
            </code>
          </li>
          <li>
            Meat choice: without size → <strong>{structure.meatChoiceWithoutSize}</strong>
            ; with size → <strong>{structure.meatChoiceWithSize}</strong>
          </li>
          <li>
            Tilbehør scope: <strong>{structure.tilbehorScope}</strong> · peers:{" "}
            {structure.peerHosts.join(", ") || "(none)"}
          </li>
        </ul>
      ) : (
        <p className="muted">No structure SEMANTIC_RULE loaded for this run.</p>
      )}

      <h3 style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>
        SEMANTIC_RULE — category probability
      </h3>
      {prob ? (
        <ul style={{ marginTop: 0 }}>
          <li>
            Fingerprint:{" "}
            <code title={prob.fingerprint}>
              {fingerprintShort(prob.fingerprint)}
            </code>
          </li>
          <li>Dip deny: {prob.dipDenyKinds.join(", ") || "(none)"}</li>
          <li>Never Tilbehør: {prob.neverTilbehorKinds.join(", ")}</li>
          <li>Never meat add: {prob.neverMeatAddKinds.join(", ")}</li>
          {prob.hardPriors.map((h) => (
            <li key={h} className="muted">
              {h}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No probability policy loaded for this run.</p>
      )}

      <h3 style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>
        BUSINESS_FACT — restaurant
      </h3>
      {facts.length ? (
        <ul style={{ marginTop: 0 }}>
          {facts.map((f) => (
            <li key={f.name}>
              <strong>{f.name}:</strong> {f.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No restaurant BUSINESS_FACTs recorded on this run.</p>
      )}

      {interesting.length ? (
        <>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>
            Sample product decisions
          </h3>
          <ul style={{ marginTop: 0, fontSize: "0.9rem" }}>
            {interesting.map((t) => (
              <li key={t.sourceId}>
                <strong>
                  {t.menuNumber ? `#${t.menuNumber} ` : ""}
                  {t.name}
                </strong>{" "}
                <span className="muted">({t.kind})</span>:{" "}
                {t.reasonCodes.join(", ") || "—"}
                {t.removed.length ? (
                  <span className="muted">
                    {" "}
                    — removed {t.removed.map((r) => r.name).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {report.products.length > interesting.length ? (
            <p className="muted">
              Showing {interesting.length} of {report.products.length} products.
              Full detail in artifact <code>policy-application.json</code>.
            </p>
          ) : null}
        </>
      ) : null}

      {Object.keys(report.summary.reasonCodeCounts).length ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Reason codes:{" "}
          {Object.entries(report.summary.reasonCodeCounts)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
