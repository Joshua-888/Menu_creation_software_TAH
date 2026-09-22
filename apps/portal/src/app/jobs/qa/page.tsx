import { redirect } from "next/navigation";
import {
  buildQaDashboard,
  getPortalStore,
  readJobArtifact,
  restaurantOptions,
} from "@engine/portal/index.js";
import type { QaFindingsByJob } from "@engine/portal/index.js";
import { getCurrentEmployee } from "../../../lib/session";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import { QaDashboardView } from "../../../components/qa/QaDashboardView";

/** Per-job reconcile summary read from `menu-reconcile.json` (presentation only). */
type ReconcileSummaryArtifact = {
  productCount?: number | null;
  withDiffs?: number | null;
  blocked?: number | null;
};

export default async function QaJobPage() {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  const store = getPortalStore();
  const jobs = store.listJobs();
  const restaurants = restaurantOptions(jobs);

  const findings: QaFindingsByJob = {};
  for (const job of jobs) {
    if (job.workflow !== "QA_RECONCILE") continue;
    const report = readJobArtifact(
      job.id,
      "menu-reconcile.json",
      store,
    ) as ReconcileSummaryArtifact | null;
    if (report) {
      findings[job.id] = {
        productCount: report.productCount ?? null,
        withDiffs: report.withDiffs ?? null,
        blocked: report.blocked ?? null,
      };
    }
  }

  const model = buildQaDashboard({ jobs, findings });

  return (
    <AppShell employeeName={emp.name}>
      <PageHeader
        title="Quality check menu"
        subtitle="Compares the live TakeAwayHero menu against the intended menu, shows where they differ and improves the live menu in place where a full-card Opdater is available."
        backHref="/jobs"
        backLabel="Dashboard"
      />
      <QaDashboardView model={model} restaurants={restaurants} />
    </AppShell>
  );
}
