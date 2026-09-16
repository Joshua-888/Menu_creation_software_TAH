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
      {isQa ? (
        <p className="muted">
          Quality check reads the live admin menu and improves it in place
          (grammar, missing beskrivelse/ingredients, wrong categories, REVIEW
          stubs). It does not upload a PDF and will not overwrite good live
          content with a worse source document.
        </p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="file">Menu PDF or photo</label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
            />
            <span className="muted">
              PDF preferred. Clear menu photos (JPEG/PNG) are OCR’d (max 25MB).
            </span>
          </div>
          <div className="field">
            <label htmlFor="sourceUrl">
              Existing menu / ordering site URL (optional)
            </label>
            <input
              id="sourceUrl"
              name="sourceUrl"
              type="url"
              placeholder="https://..."
            />
            <span className="muted">
              URL is stored now; HTML extraction remains queued until certified.
              PDF upload runs end-to-end.
            </span>
          </div>
        </>
      )}
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
