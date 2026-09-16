"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApproveCreateMenuButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    if (
      !window.confirm(
        "Approve this TargetMenu for live creation? Categories are customer-facing immediately; products are staged hidden by default.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/approve`, {
        method: "POST",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not approve menu");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="btn"
        onClick={approve}
        disabled={busy}
      >
        {busy ? "Starting…" : "APPROVE & CREATE MENU"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
