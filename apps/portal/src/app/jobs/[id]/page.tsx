import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  evaluatePortalLiveWriteGate,
  getPortalStore,
  readJobArtifact,
  reconcileJobStatusFromArtifacts,
} from "@engine/portal/index.js";
import type { PolicyApplicationReport } from "@engine/learning/policyApplicationReport.js";
import { getCurrentEmployee } from "../../../lib/session";
import { AppShell } from "../../../components/AppShell";
import { JobStatusPoller } from "../../../components/JobStatusPoller";
import { PolicyApplicationPanel } from "../../../components/PolicyApplicationPanel";
import { PageHeader } from "../../../components/PageHeader";
import { DeleteJobButton } from "../../../components/DeleteJobButton";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  const { id } = await params;
  const store = getPortalStore();
  reconcileJobStatusFromArtifacts(id, store);
  const job = store.getJob(id);
  if (!job) notFound();

  const files = store.listJobFiles(id);
  const run = store.latestJobRun(id);
  const metrics = (() => {
    if (!run?.metricsJson) return null;
    try {
      return JSON.parse(run.metricsJson) as Record<string, number>;
    } catch {
      return null;
    }
  })();
  const drySummary = readJobArtifact(id, "dry-run-summary.json") as Record<
    string,
    unknown
  > | null;
  const liveResult = readJobArtifact(id, "live-execute-result.json") as Record<
    string,
    unknown
  > | null;
  const policyApplication = readJobArtifact(
    id,
    "policy-application.json",
  ) as PolicyApplicationReport | null;
  const remaining = store.listOpenQuestions(id);
  const liveGate = evaluatePortalLiveWriteGate({
    destinationHost: job.destinationHost,
  });

  return (
    <AppShell employeeName={emp.name}>
      <JobStatusPoller status={job.status} />
      <PageHeader
        title={job.merchantName}
        subtitle={`${job.destinationHost} · ${
          job.workflow === "QA_RECONCILE" ? "Quality check" : "Create menu"
        } · ${job.status}`}
        backHref="/jobs"
        backLabel="Dashboard"
        actions={<DeleteJobButton jobId={job.id} merchantName={job.merchantName} />}
      />

      {job.workflow === "QA_RECONCILE" ? (
        <div className="panel">
          <h2>Quality check</h2>
          <p className="muted">
            QA diffs the intended menu (source + policies) against the live
            destination. Opdater rewrites the full product card — name,
            description, price, variants, ingredients, and additions — when
            admin credentials are configured and the host is allowlisted.
          </p>
          {drySummary &&
          typeof drySummary === "object" &&
          drySummary.reconcile &&
          typeof drySummary.reconcile === "object" ? (
            <div className="metrics" style={{ marginTop: "0.75rem" }}>
              <div className="metric">
                <strong>
                  {String(
                    (drySummary.reconcile as { withDiffs?: number }).withDiffs ??
                      0,
                  )}
                </strong>
                <span className="muted">Diffs</span>
              </div>
              <div className="metric">
                <strong>
                  {String(
                    (drySummary.reconcile as { updatable?: number })
                      .updatable ?? 0,
                  )}
                </strong>
                <span className="muted">Updatable</span>
              </div>
              <div className="metric">
                <strong>
                  {String(
                    (drySummary.reconcile as { blocked?: number }).blocked ?? 0,
                  )}
                </strong>
                <span className="muted">Blocked</span>
              </div>
              <div className="metric">
                <strong style={{ fontSize: "0.95rem" }}>
                  {String(
                    (drySummary.reconcile as { fingerprint?: string })
                      .fingerprint ?? "—",
                  )}
                </strong>
                <span className="muted">Fingerprint</span>
              </div>
            </div>
          ) : (
            <p className="muted">No reconcile artifact yet — wait for dry-run.</p>
          )}
        </div>
      ) : null}

      {liveGate.canLiveExecute ? (
        <div className="panel">
          <h2>Live writes enabled</h2>
          <p className="muted">
            Admin credentials configured and host allowlisted. When the last
            review question is cleared, the worker schedules live execute from
            existing dry-run artifacts (storefront-visible by default). Kill
            switch: <code>PORTAL_LIVE_WRITES=0</code>. Keep hidden with{" "}
            <code>PORTAL_CREATE_HIDDEN=1</code>.
          </p>
          {liveResult ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontSize: "0.85rem",
                margin: 0,
              }}
            >
              {JSON.stringify(liveResult, null, 2)}
            </pre>
          ) : (
            <p className="muted">No live execute result yet for this job.</p>
          )}
        </div>
      ) : (
        <div className="blocker">
          <strong>Live admin write controls are disabled.</strong>
          <div className="muted">
            Blockers: {liveGate.blockers.join(" · ") || "dry-run default"}
          </div>
        </div>
      )}

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
          {liveGate.canLiveExecute ? " → gated live execute" : ""}
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
            <strong>
              {metrics?.remainingQuestions ?? job.remainingQuestions}
            </strong>
            <span className="muted">Open questions</span>
          </div>
          <div className="metric">
            <strong>{metrics?.dryRunCreates ?? "—"}</strong>
            <span className="muted">Dry-run creates</span>
          </div>
        </div>
      </div>

      {policyApplication ? (
        <PolicyApplicationPanel report={policyApplication} />
      ) : (
        <div className="panel">
          <h2>Applied policies</h2>
          <p className="muted">
            No policy-application.json yet. Appears after dry-run when peer
            structure / probability policies are available (
            <code>npm run m76:pipeline</code>).
          </p>
          {drySummary &&
          typeof drySummary.policyApplication === "object" &&
          drySummary.policyApplication ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontSize: "0.85rem",
                margin: 0,
              }}
            >
              {JSON.stringify(drySummary.policyApplication, null, 2)}
            </pre>
          ) : null}
        </div>
      )}

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
