import { redirect } from "next/navigation";
import { getCurrentEmployee } from "../../../lib/session";
import { AppShell } from "../../../components/AppShell";
import { NewJobForm } from "../../../components/NewJobForm";
import { PageHeader } from "../../../components/PageHeader";

export default async function QaJobPage() {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  return (
    <AppShell employeeName={emp.name}>
      <PageHeader
        title="Quality check menu"
        subtitle="QA / reconcile against the live menu. Produces a reconcile report and applies Opdater updates (name/description/ingredients) when admin credentials are configured."
        backHref="/jobs"
        backLabel="Dashboard"
      />
      <NewJobForm workflow="QA_RECONCILE" />
    </AppShell>
  );
}
