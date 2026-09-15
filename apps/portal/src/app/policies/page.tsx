import { redirect } from "next/navigation";
import {
  buildPolicyCatalog,
  openPortalDecisionStore,
  repoRoot,
} from "@engine/portal/index.js";
import { getCurrentEmployee } from "../../lib/session";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { AddPolicyForm } from "../../components/AddPolicyForm";
import { PolicyActions } from "../../components/PolicyActions";

export default async function PoliciesPage() {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  const root = repoRoot();
  const decisionStore = openPortalDecisionStore(root);
  let catalog: ReturnType<typeof buildPolicyCatalog>;
  try {
    catalog = buildPolicyCatalog(decisionStore, root);
  } finally {
    decisionStore.close();
  }

  const guidance = catalog.storePolicies.filter(
    (p) => p.decisionType === "OPERATOR_GUIDANCE",
  );
  const storeOther = catalog.storePolicies.filter(
    (p) => p.decisionType !== "OPERATOR_GUIDANCE",
  );

  return (
    <AppShell employeeName={emp.name}>
      <PageHeader
        title="Policies & SEMANTIC_RULEs"
        subtitle="Built-in rules, peer artifacts, and decision-store policies — add guidance or activate/deprecate from here."
        backHref="/jobs"
        backLabel="Dashboard"
      />

      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">
            {catalog.builtInSemanticRules.length}
          </span>
          <span className="dash-stat-label">Built-in rules</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">
            {catalog.storeByStatus.ACTIVE ?? 0}
          </span>
          <span className="dash-stat-label">Store ACTIVE</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">
            {catalog.artifacts.filter((a) => a.present).length}/
            {catalog.artifacts.length}
          </span>
          <span className="dash-stat-label">Peer artifacts</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{guidance.length}</span>
          <span className="dash-stat-label">Your guidance</span>
        </div>
      </div>

      <section className="policy-section">
        <h2 className="section-title">1. Built-in SEMANTIC_RULEs</h2>
        <p className="muted">
          Always-on system rules (code defaults). Adjust via operator guidance
          below or by re-running peer distill / env flags — not deleted from here.
        </p>
        <div className="policy-list">
          {catalog.builtInSemanticRules.map((rule) => (
            <article key={rule.id} className="policy-card">
              <div className="policy-card-top">
                <strong>{rule.title}</strong>
                <span className="workflow-pill">SEMANTIC_RULE</span>
              </div>
              <p className="policy-body">{rule.summary}</p>
              <ul className="policy-bullets">
                {rule.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <div className="muted policy-meta">
                Applies: {rule.appliesTo} · Adjust: {rule.adjustableVia}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="policy-section">
        <h2 className="section-title">2. Peer artifact policies</h2>
        <p className="muted">
          Distilled from peer URLs into files under{" "}
          <code>runs/decisions/</code>. Re-run m71/m73/m76 to refresh.
        </p>
        <div className="policy-list">
          {catalog.artifacts.map((a) => (
            <article key={a.id} className="policy-card">
              <div className="policy-card-top">
                <strong>{a.title}</strong>
                <span
                  className={
                    a.present
                      ? "workflow-pill"
                      : "workflow-pill workflow-pill-qa"
                  }
                >
                  {a.present ? "Present" : "Missing"}
                </span>
              </div>
              <p className="policy-body">{a.summary}</p>
              {a.preview ? <pre className="policy-pre">{a.preview}</pre> : null}
              <div className="muted policy-meta">
                {a.path}
                {a.fingerprint ? ` · fp ${a.fingerprint}` : ""}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="policy-section">
        <h2 className="section-title">3. Your global guidance</h2>
        <p className="muted">
          Stored as GLOBAL SEMANTIC_RULE notes for operators. Free-text guidance
          is not yet auto-applied in dry-run — use peer distill / store policies
          for executable rules.
        </p>
        <AddPolicyForm />
        {guidance.length === 0 ? (
          <p className="muted">No operator-authored global policies yet.</p>
        ) : (
          <div className="policy-list">
            {guidance.map((p) => (
              <article
                key={`${p.policyId}@${p.policyVersion}`}
                className="policy-card"
              >
                <div className="policy-card-top">
                  <strong>{p.title}</strong>
                  <span className="workflow-pill">
                    {p.status} · GLOBAL · {p.knowledgeKind}
                  </span>
                </div>
                <p className="policy-body">{p.body}</p>
                <div className="muted policy-meta">
                  {p.decisionType} · v{p.policyVersion} · {p.createdBy} ·{" "}
                  {new Date(p.createdAt).toLocaleString()}
                </div>
                <PolicyActions
                  policyId={p.policyId}
                  status={p.status}
                  canEdit={true}
                  title={p.title}
                  body={p.body}
                />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="policy-section">
        <h2 className="section-title">4. Decision-store policies</h2>
        <p className="muted">
          Latest version per policy id (ACTIVE / SHADOW / DEPRECATED…). Activate
          or deprecate from the UI.
        </p>
        {storeOther.length === 0 ? (
          <p className="muted">
            No store policies yet. Run peer structure distill / learning pipeline.
          </p>
        ) : (
          <div className="policy-list">
            {storeOther.map((p) => (
              <article
                key={`${p.policyId}@${p.policyVersion}`}
                className="policy-card"
              >
                <div className="policy-card-top">
                  <strong>{p.title}</strong>
                  <span className="workflow-pill">
                    {p.status} · {p.scope}
                  </span>
                </div>
                <pre className="policy-pre">
                  {p.body.slice(0, 800)}
                  {p.body.length > 800 ? "…" : ""}
                </pre>
                <div className="muted policy-meta">
                  {p.decisionType} · v{p.policyVersion} · {p.createdBy} ·{" "}
                  {p.knowledgeKind} · {new Date(p.createdAt).toLocaleString()}
                </div>
                <PolicyActions
                  policyId={p.policyId}
                  status={p.status}
                  canEdit={false}
                  title={p.title}
                  body={p.body}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
