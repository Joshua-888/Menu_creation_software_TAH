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
import { QaFindingsPanel } from "../../../components/QaFindingsPanel";
import { operatorExecutionSummary } from "@engine/runtime/operatorSummary.js";
import { MenuView } from "../../../components/menu/MenuView";
import { ApprovalPanel } from "../../../components/approval/ApprovalPanel";
import type { ExecutionBundleView } from "../../../components/approval/approvalView.js";
import { ExecutionStepper } from "../../../components/execution/ExecutionStepper";
import { ExecutionResultPanel } from "../../../components/execution/ExecutionResultPanel";
import { FailureStateBadge } from "../../../components/execution/FailureStateBadge";
import type { LiveExecuteResultView } from "../../../components/execution/executionView.js";
import { JobHistoryTimeline } from "../../../components/history/JobHistoryTimeline";
import type { CanonicalMenu } from "@engine/domain/schema/canonical.js";
import type { SourceMenu } from "@engine/domain/schema/source.js";
import type { MenuQualityContractResult } from "@engine/intelligence/types.js";

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
  // Read-only projection of the frozen ExecutionBundle that approval binds.
  // Missing for older/dry-run-only jobs — the panel degrades gracefully.
  const executionBundle = readJobArtifact(
    id,
    "execution-bundle.json",
  ) as ExecutionBundleView | null;
  const liveResultView = liveResult as LiveExecuteResultView | null;
  const runs = store.listJobRuns(id);
  const reviewAnswers = store.listReviewAnswers(id);
  const employeeNames: Record<string, string> = {};
  for (const answer of reviewAnswers) {
    if (employeeNames[answer.employeeId]) continue;
    employeeNames[answer.employeeId] =
      store.getEmployeeById(answer.employeeId)?.name ?? answer.employeeId;
  }
  const targetMenu = readJobArtifact(id, "target-menu.json") as CanonicalMenu | null;
  const sourceMenu = readJobArtifact(id, "source-menu.json") as
    | (SourceMenu & { productCount?: number })
    | null;
  const qualityContract =
    (readJobArtifact(id, "menu-quality-contract.json") as
      | MenuQualityContractResult
      | null) ??
    (readJobArtifact(id, "quality-report.json") as
      | MenuQualityContractResult
      | null);
  const extractionAccounting = readJobArtifact(
    id,
    "extraction-accounting.json",
  ) as {
    accounting?: { summary?: { candidatesDetected?: number } };
    uniqueProducts?: number;
  } | null;
  const sourceCoverage = readJobArtifact(id, "source-coverage.json") as {
    suspicious?: boolean;
    detail?: string;
    priceAnchorCount?: number;
    priceLikeTokens?: number;
  } | null;
  const approval = readJobArtifact(
    id,
    "awaiting-operator-approval.json",
  ) as {
    writePlan?: { categoryCreates?: number; productCreates?: number };
  } | null;
  const recoveryPlan = readJobArtifact(id, "recovery-plan.json") as {
    operations?: Array<{ state?: string }>;
    neverAutoDelete?: boolean;
  } | null;
  const liveError = readJobArtifact(id, "live-execute-error.json") as {
    message?: string;
  } | null;
  const policyApplication = readJobArtifact(
    id,
    "policy-application.json",
  ) as PolicyApplicationReport | null;
  const remaining = store.listOpenQuestions(id);
  const liveGate = evaluatePortalLiveWriteGate({
    destinationHost: job.destinationHost,
  });
  const sourceProducts =
    sourceMenu?.productCount ??
    sourceMenu?.categories?.reduce(
      (count, category) => count + (category.products?.length ?? 0),
      0,
    ) ??
    metrics?.uniqueProducts ??
    null;
  const targetProducts =
    targetMenu?.categories?.reduce(
      (count, category) => count + (category.products?.length ?? 0),
      0,
    ) ?? null;
  const sourceCandidates =
    extractionAccounting?.accounting?.summary?.candidatesDetected ?? null;
  const coverageBlocked = sourceCoverage?.suspicious === true;
  const liveCount = (key: string): number | null =>
    typeof liveResult?.[key] === "number"
      ? (liveResult[key] as number)
      : null;
  const categoriesExecuted =
    liveCount("categoriesVerified") == null
      ? null
      : (liveCount("categoriesVerified") ?? 0) +
        (liveCount("categoriesFailed") ?? 0);
  const productsExecuted =
    liveCount("productsVerified") == null
      ? null
      : (liveCount("productsVerified") ?? 0) +
        (liveCount("productsFailed") ?? 0);

  return (
    <AppShell employeeName={emp.name}>
      <JobStatusPoller status={job.status} errorMessage={job.errorMessage} />
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
          <h2>Quality check findings</h2>
          <p className="muted">
            Diffs the intended menu (PDF + policies) against the live
            destination, then Opdater rewrites the full product card when live
            writes are available.
          </p>
          <QaFindingsPanel jobId={job.id} />
        </div>
      ) : null}

      {job.status === "AWAITING_OPERATOR_APPROVAL" ? (
        <ApprovalPanel
          jobId={job.id}
          merchantName={job.merchantName}
          destinationHost={job.destinationHost}
          workflow={job.workflow}
          targetMenuVersion={executionBundle?.bundleVersion ?? null}
          categoryCount={targetMenu?.categories?.length ?? null}
          productCount={targetProducts}
          unresolvedWarningCount={remaining.length}
          bundle={executionBundle}
          writeScope={{
            writePlan: approval?.writePlan ?? null,
            bundle: executionBundle,
            targetMenu: {
              categoryCount: targetMenu?.categories?.length ?? null,
              productCount: targetProducts,
            },
          }}
          coverageBlocked={coverageBlocked}
          coverageDetail={sourceCoverage?.detail ?? null}
          menuStatus={qualityContract?.menuStatus ?? null}
        />
      ) : null}

      {job.status === "AWAITING_OPERATOR_APPROVAL" && coverageBlocked ? (
        <p className="muted">
          Source candidates: {sourceCandidates ?? "—"} · Extracted source
          products: {sourceProducts ?? "—"} · TargetMenu products:{" "}
          {targetProducts ?? "—"}
        </p>
      ) : null}

      {liveGate.canLiveExecute ? (
        <div className="panel">
          <h2>Execution</h2>
          <p className="muted">
            Admin credentials configured and host allowlisted. Products are
            hidden by default. Publish explicitly with{" "}
            <code>PORTAL_STOREFRONT_PUBLISH=1</code>. Kill switch:{" "}
            <code>PORTAL_LIVE_WRITES=0</code>.
          </p>
          <ExecutionStepper status={job.status} result={liveResultView} />
          <FailureStateBadge
            status={job.status}
            result={liveResultView}
            errorMessage={job.errorMessage ?? liveError?.message ?? null}
          />
          <ExecutionResultPanel result={liveResultView} />
          {liveResult ? (
            <details style={{ marginTop: "0.75rem" }}>
              <summary className="muted">Raw live-execute-result.json</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "0.85rem",
                  margin: 0,
                }}
              >
                {JSON.stringify(liveResult, null, 2)}
              </pre>
            </details>
          ) : null}
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
          <h2>What happened</h2>
          <p>
            {operatorExecutionSummary({
              result: liveResult as never,
              recovery: recoveryPlan as never,
              errorMessage: job.errorMessage ?? liveError?.message ?? null,
            })}
          </p>
          <p className="muted">{job.errorMessage}</p>
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
            <strong>{sourceProducts ?? "—"}</strong>
            <span className="muted">Source products</span>
          </div>
          <div className="metric">
            <strong>
              {metrics?.remainingQuestions ?? job.remainingQuestions}
            </strong>
            <span className="muted">Open questions</span>
          </div>
          <div className="metric">
            <strong>{targetProducts ?? "—"}</strong>
            <span className="muted">Target products</span>
          </div>
          <div className="metric">
            <strong>{approval?.writePlan?.categoryCreates ?? "—"}</strong>
            <span className="muted">Planned categories</span>
          </div>
          <div className="metric">
            <strong>{approval?.writePlan?.productCreates ?? "—"}</strong>
            <span className="muted">Planned products</span>
          </div>
          <div className="metric">
            <strong>{categoriesExecuted ?? "—"}</strong>
            <span className="muted">Categories executed</span>
          </div>
          <div className="metric">
            <strong>{liveCount("categoriesVerified") ?? "—"}</strong>
            <span className="muted">Categories verified</span>
          </div>
          <div className="metric">
            <strong>{productsExecuted ?? "—"}</strong>
            <span className="muted">Products executed</span>
          </div>
          <div className="metric">
            <strong>{liveCount("productsVerified") ?? "—"}</strong>
            <span className="muted">Products verified</span>
          </div>
          <div className="metric">
            <strong>
              {typeof liveResult?.menuVerified === "boolean"
                ? liveResult.menuVerified
                  ? "YES"
                  : "NO"
                : "—"}
            </strong>
            <span className="muted">Menu verified</span>
          </div>
        </div>
      </div>

      <MenuView
        targetMenu={targetMenu}
        qualityContract={qualityContract}
        sourceMenu={sourceMenu}
        jobId={id}
      />

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

      <JobHistoryTimeline
        job={{ createdAt: job.createdAt, workflow: job.workflow, status: job.status }}
        runs={runs}
        reviewAnswers={reviewAnswers}
        employeeNames={employeeNames}
      />

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
