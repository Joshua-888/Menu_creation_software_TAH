import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  buildMerchantDashboard,
  getPortalStore,
  statusLabel,
  statusTone,
  workflowLabel,
} from "@engine/portal/index.js";
import { getCurrentEmployee } from "../../../lib/session";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import {
  Badge,
  Panel,
  StatGrid,
  StatTile,
  Table,
  TableBody,
  TableHead,
  TableRow,
  TableWrap,
  Td,
  Th,
  WorkflowBadge,
} from "../../../components/ui";

export default async function RestaurantDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  const { key } = await params;
  const restaurantKey = decodeURIComponent(key);
  const store = getPortalStore();
  const jobs = store.listJobsForRestaurant(restaurantKey);
  if (jobs.length === 0) notFound();

  // Derive the rollup row (merchant name / destination host / latest status)
  // from the same pure aggregation used by the dashboard.
  const row = buildMerchantDashboard(jobs)[0] ?? null;
  const latest = jobs[0]!;
  const blockers = jobs.filter((j) => statusTone(j.status) === "danger").length;
  const openQuestions = jobs.reduce(
    (total, job) => total + job.remainingQuestions,
    0,
  );

  return (
    <AppShell employeeName={emp.name}>
      <PageHeader
        title={row?.merchantName ?? latest.merchantName}
        subtitle={row?.destinationHost ?? latest.destinationHost}
        backHref="/jobs"
        backLabel="Dashboard"
      />

      <StatGrid>
        <StatTile value={jobs.length} label="Total runs" />
        <StatTile value={row?.createJobCount ?? 0} label="Create runs" />
        <StatTile value={row?.qaJobCount ?? 0} label="Quality runs" />
        <StatTile value={blockers} label="Blocked runs" />
      </StatGrid>

      <Panel title="Latest state">
        <div className="metrics">
          <div className="metric">
            <Badge tone={statusTone(latest.status)}>
              {statusLabel(latest.status)}
            </Badge>
            <span className="muted">Latest status</span>
          </div>
          <div className="metric">
            <WorkflowBadge workflow={latest.workflow}>
              {workflowLabel(latest.workflow)}
            </WorkflowBadge>
            <span className="muted">Latest workflow</span>
          </div>
          <div className="metric">
            <strong>{openQuestions}</strong>
            <span className="muted">Open questions</span>
          </div>
          <div className="metric">
            <strong>{new Date(latest.updatedAt).toLocaleString()}</strong>
            <span className="muted">Last activity</span>
          </div>
        </div>
        <div className="actions" style={{ marginBottom: 0 }}>
          <Link className="btn" href={`/jobs/${latest.id}`}>
            Open latest run
          </Link>
        </div>
      </Panel>

      <Panel title={`Run history (${jobs.length})`}>
        <TableWrap>
          <Table>
            <TableHead>
              <TableRow>
                <Th>Created</Th>
                <Th>Workflow</Th>
                <Th>Status</Th>
                <Th>Open questions</Th>
                <Th>Job</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <Td className="muted">
                    {new Date(job.createdAt).toLocaleString()}
                  </Td>
                  <Td>
                    <WorkflowBadge workflow={job.workflow}>
                      {workflowLabel(job.workflow)}
                    </WorkflowBadge>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(job.status)}>
                      {statusLabel(job.status)}
                    </Badge>
                  </Td>
                  <Td className="muted">{job.remainingQuestions}</Td>
                  <Td>
                    <Link className="btn btn-secondary btn-compact" href={`/jobs/${job.id}`}>
                      View
                    </Link>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      </Panel>
    </AppShell>
  );
}
