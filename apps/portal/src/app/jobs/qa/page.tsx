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
        subtitle="Improves the live menu in place — grammar, missing beskrivelse/ingredients, wrong categories. Never forces a PDF over good live content. Full-card Opdater writes when admin credentials are configured."
        backHref="/jobs"
        backLabel="Dashboard"
      />
      <NewJobForm workflow="QA_RECONCILE" />
    </AppShell>
  );
}
