import { redirect } from "next/navigation";
import { getCurrentEmployee } from "../../../lib/session";
import { AppShell } from "../../../components/AppShell";
import { NewJobForm } from "../../../components/NewJobForm";

export default async function NewJobPage() {
  const emp = await getCurrentEmployee();
  if (!emp) redirect("/login");

  return (
    <AppShell employeeName={emp.name}>
      <h1 className="page-title">New migration</h1>
      <p className="page-sub">
        Merchant destination host plus menu PDF and/or source URL.
      </p>
      <NewJobForm />
    </AppShell>
  );
}
