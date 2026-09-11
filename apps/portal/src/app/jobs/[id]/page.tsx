import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalStore, readJobArtifact } from "@engine/portal/index.js";
import { getCurrentEmployee } from "../../../lib/session";
import { AppShell } from "../../../components/AppShell";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  const { id } = await params;
  const store = getPortalStore();
  const job = store.getJob(id);
  if (!job) notFound();

  const files = store.listJobFiles(id);
  const run = store.latestJobRun(id);
  const metrics = run?.metricsJson
    ? (JSON.parse(run.metricsJson) as Record<string, number>)
    : null;
  const drySummary = readJobArtifact(id, "dry-run-summary.json") as Record<
    string,
    unknown
  > | null;
  const remaining = store.listOpenQuestions(id);

  return (
    <AppShell employeeName={emp.name}>
      <h1 className="page-title">{job.merchantName}</h1>
      <p className="page-sub">
        {job.destinationHost} · <span className="status-pill">{job.status}</span>
      </p>

      <div className="blocker">
        <strong>Live admin write controls are disabled.</strong>
        <div className="muted">
          Blockers: createCategory not certified · executor not bound · portal
          MVP is dry-run only.
        </div>
      </div>

      {job.errorMessage ? (
        <div className="panel">
          <h2>Status note</h2>
          <p>{job.errorMessage}</p>
        </div>
      ) : null}

      <div className="panel">
        <h2>Progress</h2>
        <p className="muted">
          extract → domain → decisions → dry-run artifacts
        </p>
        <div className="metrics">
          <div className="metric">
            <strong>{metrics?.pageCount ?? "—"}</strong>
            <span className="muted">Pages</span>
          </div>
          <div className="metric">
            <strong>{metrics?.uniqueProducts ?? "—"}</strong>
            <span className="muted">Products</span>
          </div>
          <div className="metric">
            <strong>{metrics?.remainingQuestions ?? job.remainingQuestions}</strong>
            <span className="muted">Open questions</span>
          </div>
          <div className="metric">
            <strong>{metrics?.dryRunCreates ?? "—"}</strong>
            <span className="muted">Dry-run creates</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Sources</h2>
        <ul>
          {files.map((f) => (
            <li key={f.id}>
              {f.originalName}{" "}
              <span className="muted">
                ({Math.round(f.sizeBytes / 1024)} KB)
              </span>
            </li>
          ))}
          {!files.length ? <li className="muted">No files</li> : null}
        </ul>
        {job.sourceUrl ? (
          <p>
            Source URL:{" "}
            <a href={job.sourceUrl} target="_blank" rel="noreferrer">
              {job.sourceUrl}
            </a>
          </p>
        ) : null}
      </div>

      {drySummary ? (
        <div className="panel">
          <h2>Dry-run WritePlan</h2>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.85rem",
              margin: 0,
            }}
          >
            {JSON.stringify(drySummary, null, 2)}
          </pre>
        </div>
      ) : null}

      <div className="panel">
        <h2>Artifacts</h2>
        {run?.runDir ? (
          <p className="muted">
            Run dir: <code>{run.runDir}</code>
          </p>
        ) : (
          <p className="muted">No run yet.</p>
        )}
        <div className="actions" style={{ marginBottom: 0 }}>
          <Link className="btn" href={`/review?job=${job.id}`}>
            Open review ({remaining.length})
          </Link>
          <Link className="btn btn-secondary" href="/jobs">
            Back to jobs
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
