import Link from "next/link";

export function AppShell({
  employeeName,
  children,
}: {
  employeeName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/jobs" className="brand-mark">
          TakeAway<span>Hero</span>
        </Link>
        <nav className="nav-links">
          <Link href="/jobs">Jobs</Link>
          <Link href="/jobs/new">New</Link>
          <Link href="/review">Review</Link>
          <span className="muted">{employeeName}</span>
          <form action="/api/auth/logout" method="post">
            <button className="btn btn-secondary" type="submit">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
