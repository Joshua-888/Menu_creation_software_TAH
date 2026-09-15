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
        subtitle="QA / reconcile — requires live dest. Produces menu-reconcile report and Opdater UPDATE plans (name/description/ingredients). Live apply needs RECONCILE_WRITE confirm."
        backHref="/jobs"
        backLabel="Dashboard"
      />
      <NewJobForm workflow="QA_RECONCILE" />
    </AppShell>
  );
}
