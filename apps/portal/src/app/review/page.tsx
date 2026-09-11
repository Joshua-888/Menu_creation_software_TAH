import { redirect } from "next/navigation";
import { getPortalStore } from "@engine/portal/index.js";
import { getCurrentEmployee } from "../../lib/session";
import { AppShell } from "../../components/AppShell";
import { ReviewQueueClient } from "../../components/ReviewQueueClient";

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
      <h1 className="page-title">Review queue</h1>
      <p className="page-sub">
        Only unresolved questions. One answer can batch-resolve similar items.
      </p>
      <div className="panel">
        <ReviewQueueClient questions={questions} />
      </div>
    </AppShell>
  );
}
