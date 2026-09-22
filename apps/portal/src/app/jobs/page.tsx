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
import {
  Badge,
  StatGrid,
  StatTile,
  WorkflowBadge,
} from "../../components/ui";

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
      ![
        "COMPLETED",
        "COMPLETED_WITH_ERRORS",
        "PARTIAL_WRITE",
        "RECOVERY_REQUIRED",
        "LIVE_EXECUTION_FAILED",
        "FAILED",
        "CANCELLED",
      ].includes(m.latestStatus),
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
            onto TakeAwayHero (storefront-visible when live writes run).
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

      <StatGrid>
        <StatTile value={merchants.length} label="Restaurants" />
        <StatTile value={inFlight} label="In progress" />
        <StatTile value={needsReview} label="Need review" />
        <StatTile value={completed} label="Completed" />
      </StatGrid>

      <div className="section-head">
        <h2 className="section-title">Restaurants</h2>
        <Link className="btn btn-secondary" href="/review">
          Review queue
        </Link>
      </div>

      {merchants.length === 0 ? (
        <p className="muted">
          No restaurants yet. Start with Create menu or Quality check.
        </p>
      ) : (
        <div className="merchant-table">
          <div className="merchant-head">
            <span>Restaurant</span>
            <span>Latest workflow</span>
            <span>Status</span>
            <span>Jobs</span>
            <span>Last activity</span>
          </div>
          {merchants.map((m) => (
            <Link
              key={m.restaurantKey}
              className="merchant-row"
              href={`/restaurants/${encodeURIComponent(m.restaurantKey)}`}
            >
              <div>
                <strong>{m.merchantName}</strong>
                <div className="muted">{m.destinationHost}</div>
              </div>
              <div>
                <WorkflowBadge workflow={m.latestWorkflow}>
                  {workflowLabel(m.latestWorkflow)}
                </WorkflowBadge>
              </div>
              <div>
                <Badge tone={statusTone(m.latestStatus)}>
                  {statusLabel(m.latestStatus)}
                </Badge>
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
                <Badge tone={statusTone(job.status)}>
                  {statusLabel(job.status)}
                </Badge>
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
