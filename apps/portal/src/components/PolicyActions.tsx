"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PolicyActions({
  policyId,
  status,
  canEdit,
  title,
  body,
}: {
  policyId: string;
  status: string;
  canEdit: boolean;
  title: string;
  body: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [editBody, setEditBody] = useState(body);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "deprecate" | "activate" | "update") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "update"
            ? {
                action: "update",
                policyId,
                title: editTitle,
                body: editBody,
              }
            : { action, policyId },
        ),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Action failed");
        setBusy(false);
        return;
      }
      setEditing(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  return (
    <div className="policy-actions">
      {status === "ACTIVE" ? (
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          disabled={busy}
          onClick={() => run("deprecate")}
        >
          Deprecate
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          disabled={busy}
          onClick={() => run("activate")}
        >
          Activate
        </button>
      )}
      {canEdit ? (
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          disabled={busy}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Cancel" : "Edit"}
        </button>
      ) : null}
      {editing ? (
        <div className="policy-edit">
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            aria-label="Policy title"
          />
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={4}
            aria-label="Policy text"
          />
          <button
            type="button"
            className="btn btn-compact"
            disabled={busy}
            onClick={() => run("update")}
          >
            Save changes
          </button>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
