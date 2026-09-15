"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteJobButton({
  jobId,
  merchantName,
}: {
  jobId: string;
  merchantName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (
      !window.confirm(
        `Delete job for “${merchantName}”? This removes the job record and review queue items. Artifacts on disk are kept.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not delete job");
        setBusy(false);
        return;
      }
      router.push("/jobs");
      router.refresh();
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  return (
    <div className="delete-job-wrap">
      <button
        type="button"
        className="btn btn-danger"
        onClick={onDelete}
        disabled={busy}
      >
        {busy ? "Deleting…" : "Delete job"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
