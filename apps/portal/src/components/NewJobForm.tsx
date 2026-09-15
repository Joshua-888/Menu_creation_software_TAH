"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewJobForm({
  workflow = "CREATE_MENU",
}: {
  workflow?: "CREATE_MENU" | "QA_RECONCILE";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isQa = workflow === "QA_RECONCILE";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("workflow", workflow);
    try {
      const res = await fetch("/api/jobs", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string; id?: string };
      if (!res.ok) {
        setError(data.error || "Could not create job");
        setBusy(false);
        return;
      }
      router.push(`/jobs/${data.id}`);
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="workflow" value={workflow} />
      <div className="field">
        <label htmlFor="merchantName">Merchant name</label>
        <input id="merchantName" name="merchantName" required />
      </div>
      <div className="field">
        <label htmlFor="destinationHost">
          Destination TakeAwayHero ordering URL / host
        </label>
        <input
          id="destinationHost"
          name="destinationHost"
          placeholder="https://merchant.example"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="file">
          {isQa ? "Source menu PDF (for intended state)" : "Menu PDF"}
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".pdf,application/pdf"
        />
        <span className="muted">
          {isQa
            ? "Quality check diffs this PDF (after policies) against the live menu. Max 25MB."
            : "End-to-end create runs require a PDF (max 25MB). Optional source URL can be stored alongside it."}
        </span>
      </div>
      <div className="field">
        <label htmlFor="sourceUrl">
          {isQa
            ? "Live / peer menu URL (optional context)"
            : "Existing menu / ordering site URL (optional)"}
        </label>
        <input
          id="sourceUrl"
          name="sourceUrl"
          type="url"
          placeholder="https://..."
        />
        <span className="muted">
          {isQa
            ? "Peer/probability policies still come from observed peer menus in the learning pipeline."
            : "URL is stored now; HTML extraction remains queued until certified. PDF upload runs end-to-end."}
        </span>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" type="submit" disabled={busy}>
        {busy
          ? "Starting…"
          : isQa
            ? "Start quality check"
            : "Create & run"}
      </button>
    </form>
  );
}
