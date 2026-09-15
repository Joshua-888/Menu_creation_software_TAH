"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "./BrandLogo";

const LINKS = [
  { href: "/jobs", label: "Dashboard", match: (p: string) => p === "/jobs" },
  {
    href: "/jobs/new",
    label: "Create",
    match: (p: string) => p.startsWith("/jobs/new"),
  },
  {
    href: "/jobs/qa",
    label: "Quality check",
    match: (p: string) => p.startsWith("/jobs/qa"),
  },
  {
    href: "/policies",
    label: "Policies",
    match: (p: string) => p.startsWith("/policies"),
  },
  {
    href: "/review",
    label: "Review",
    match: (p: string) => p.startsWith("/review"),
  },
] as const;

export function PortalNav({ employeeName }: { employeeName: string }) {
  const pathname = usePathname() || "/";

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <BrandLogo size="nav" href="/jobs" />
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((link) => {
            const active = link.match(pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? "nav-link nav-link-active" : "nav-link"}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="topbar-user">
          <span className="topbar-user-name">{employeeName}</span>
          <form action="/api/auth/logout" method="post">
            <button className="btn btn-ghost btn-compact" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
