import Link from "next/link";
import { redirect } from "next/navigation";
import {
  buildMerchantDashboard,
  getPortalStore,
  statusLabel,
  statusTone,
  workflowLabel,
} from "@engine/portal/index.js";
import { getCurrentEmployee } from "../../lib/session";
import { AppShell } from "../../components/AppShell";
import { BrandLogo } from "../../components/BrandLogo";

export default async function JobsPage() {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  const store = getPortalStore();
  const jobs = store.listJobs();
  const merchants = buildMerchantDashboard(jobs);
  const needsReview = merchants.filter(
    (m) => m.latestStatus === "AWAITING_REVIEW" || m.remainingQuestions > 0,
  ).length;
  const completed = merchants.filter((m) => m.latestStatus === "COMPLETED").length;
  const inFlight = merchants.filter(
    (m) =>
      !["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"].includes(
        m.latestStatus,
      ),
  ).length;

  return (
    <AppShell employeeName={emp.name}>
      <section className="home-hero">
        <div className="home-hero-brand">
          <BrandLogo href={null} size="mark" priority />
        </div>
        <h1 className="home-hero-title">Operator dashboard</h1>
        <p className="page-sub home-hero-sub">
          Create menus for new merchants, or quality-check live menus against
          peer standards and policy.
        </p>
      </section>

      <div className="workflow-grid">
        <Link className="workflow-card" href="/jobs/new">
          <span className="workflow-kicker">Create</span>
          <strong>Create menu</strong>
          <p>
            Upload a PDF, run extraction → domain → dry-run. Builds the menu
            onto TakeAwayHero (hidden creates when live writes are gated on).
          </p>
          <span className="workflow-cta">Start create →</span>
        </Link>
        <Link className="workflow-card workflow-card-qa" href="/jobs/qa">
          <span className="workflow-kicker">Quality</span>
          <strong>Quality check menu</strong>
          <p>
            Analyse an existing live menu against source + peer probability /
            structure rules. Propose bulk reconcile fixes for bad names,
            variants, and Tilbehør.
          </p>
          <span className="workflow-cta">Start check →</span>
        </Link>
      </div>

      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">{merchants.length}</span>
          <span className="dash-stat-label">Merchants</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{inFlight}</span>
          <span className="dash-stat-label">In progress</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{needsReview}</span>
          <span className="dash-stat-label">Need review</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{completed}</span>
          <span className="dash-stat-label">Completed</span>
        </div>
      </div>

      <div className="section-head">
        <h2 className="section-title">Merchants</h2>
        <Link className="btn btn-secondary" href="/review">
          Review queue
        </Link>
      </div>

      {merchants.length === 0 ? (
        <p className="muted">
          No merchants yet. Start with Create menu or Quality check.
        </p>
      ) : (
        <div className="merchant-table">
          <div className="merchant-head">
            <span>Merchant</span>
            <span>Latest workflow</span>
            <span>Status</span>
            <span>Jobs</span>
            <span>Updated</span>
          </div>
          {merchants.map((m) => (
            <Link
              key={m.restaurantKey}
              className="merchant-row"
              href={`/jobs/${m.latestJobId}`}
            >
              <div>
                <strong>{m.merchantName}</strong>
                <div className="muted">{m.destinationHost}</div>
              </div>
              <div>
                <span
                  className={
                    m.latestWorkflow === "QA_RECONCILE"
                      ? "workflow-pill workflow-pill-qa"
                      : "workflow-pill"
                  }
                >
                  {workflowLabel(m.latestWorkflow)}
                </span>
              </div>
              <div>
                <span className={`status-pill tone-${statusTone(m.latestStatus)}`}>
                  {statusLabel(m.latestStatus)}
                </span>
                {m.remainingQuestions > 0 ? (
                  <div className="muted">{m.remainingQuestions} open questions</div>
                ) : null}
              </div>
              <div className="muted">
                {m.jobCount} total
                <div>
                  {m.createJobCount} create · {m.qaJobCount} QA
                </div>
              </div>
              <div className="muted">
                {new Date(m.updatedAt).toLocaleString()}
              </div>
            </Link>
          ))}
        </div>
      )}

      {jobs.length > 0 ? (
        <>
          <div className="section-head" style={{ marginTop: "2.5rem" }}>
            <h2 className="section-title">Recent jobs</h2>
          </div>
          <div className="job-list">
            {jobs.slice(0, 12).map((job) => (
              <Link key={job.id} className="job-row" href={`/jobs/${job.id}`}>
                <div>
                  <strong>{job.merchantName}</strong>
                  <div className="muted">
                    {workflowLabel(job.workflow)} · {job.destinationHost}
                  </div>
                </div>
                <div className={`status-pill tone-${statusTone(job.status)}`}>
                  {statusLabel(job.status)}
                </div>
                <div className="muted">
                  {job.remainingQuestions
                    ? `${job.remainingQuestions} questions`
                    : "—"}
                </div>
                <div className="muted">
                  {new Date(job.updatedAt).toLocaleString()}
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
