import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalStore } from "@engine/portal/index.js";
import { getCurrentEmployee } from "../../lib/session";
import { AppShell } from "../../components/AppShell";

export default async function JobsPage() {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  const store = getPortalStore();
  const jobs = store.listJobs();

  return (
    <AppShell employeeName={emp.name}>
      <section className="home-hero">
        <h1>
          TakeAway<span>Hero</span>
        </h1>
        <p className="page-sub" style={{ marginBottom: 0 }}>
          Menu migrations for merchants moving onto TakeAwayHero ordering.
          Dry-run by default — set PORTAL_LIVE_WRITES=1 on an allowlisted host
          (veronipizza.dk) to enable gated live admin writes.
        </p>
      </section>

      <div className="actions">
        <Link className="btn" href="/jobs/new">
          New migration
        </Link>
        <Link className="btn btn-secondary" href="/review">
          Review queue
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p className="muted">No jobs yet. Create a migration to get started.</p>
      ) : (
        <div className="job-list">
          {jobs.map((job) => (
            <Link key={job.id} className="job-row" href={`/jobs/${job.id}`}>
              <div>
                <strong>{job.merchantName}</strong>
                <div className="muted">{job.destinationHost}</div>
              </div>
              <div className="status-pill">{job.status}</div>
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
      )}
    </AppShell>
  );
}
