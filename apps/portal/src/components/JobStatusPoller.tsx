"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const IN_FLIGHT = new Set([
  "QUEUED",
  "EXTRACTING",
  "DOMAIN",
  "DECISIONS",
  "ARTIFACTS",
]);

/** Poll job detail while the worker is still running. */
export function JobStatusPoller({ status }: { status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!IN_FLIGHT.has(status)) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, 3000);
    return () => window.clearInterval(id);
  }, [status, router]);
  return null;
}
