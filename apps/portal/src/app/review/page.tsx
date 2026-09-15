import { redirect } from "next/navigation";
import { getPortalStore } from "@engine/portal/index.js";
import { getCurrentEmployee } from "../../lib/session";
import { AppShell } from "../../components/AppShell";
import { ReviewQueueClient } from "../../components/ReviewQueueClient";
import { PageHeader } from "../../components/PageHeader";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  const { job } = await searchParams;
  const store = getPortalStore();
  const questions = store.listOpenQuestions(job || undefined);

  return (
    <AppShell employeeName={emp.name}>
      <PageHeader
        title="Review queue"
        subtitle="Clear blockers in plain language. Peer menu practices already run automatically — these answers do not lock in lasting rules for this queue type."
        backHref={job ? `/jobs/${job}` : "/jobs"}
        backLabel={job ? "Back to job" : "Dashboard"}
      />
      <div className="panel">
        <ReviewQueueClient questions={questions} />
      </div>
    </AppShell>
  );
}
