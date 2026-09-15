import { redirect } from "next/navigation";
import { getCurrentEmployee } from "../../../lib/session";
import { AppShell } from "../../../components/AppShell";
import { NewJobForm } from "../../../components/NewJobForm";
import { PageHeader } from "../../../components/PageHeader";

export default async function NewJobPage() {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  return (
    <AppShell employeeName={emp.name}>
      <PageHeader
        title="Create menu"
        subtitle="Migration workflow — extract from PDF, apply policies, dry-run (and gated live creates when enabled)."
        backHref="/jobs"
        backLabel="Dashboard"
      />
      <NewJobForm workflow="CREATE_MENU" />
    </AppShell>
  );
}
