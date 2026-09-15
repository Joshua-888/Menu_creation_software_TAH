import { PortalNav } from "./PortalNav";

export function AppShell({
  employeeName,
  children,
}: {
  employeeName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <PortalNav employeeName={employeeName} />
      <main className="shell-main">{children}</main>
    </div>
  );
}
