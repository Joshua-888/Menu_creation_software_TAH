"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AddPolicyForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(fd.get("title") ?? ""),
          body: String(fd.get("body") ?? ""),
          decisionType: String(fd.get("decisionType") ?? "OPERATOR_GUIDANCE"),
        }),
      });
      const data = (await res.json()) as { error?: string; policyId?: string };
      if (!res.ok) {
        setError(data.error || "Could not save policy");
        setBusy(false);
        return;
      }
      setOk("Policy saved as ACTIVE GLOBAL SEMANTIC_RULE.");
      e.currentTarget.reset();
      setBusy(false);
      router.refresh();
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  return (
    <form className="form-grid panel" onSubmit={onSubmit}>
      <h2 className="panel-heading">Add global policy</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Operator guidance the system should consider on future jobs (SEMANTIC_RULE,
        GLOBAL). Do not put fixed merchant prices here — those stay restaurant
        BUSINESS_FACTs.
      </p>
      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          required
          placeholder="e.g. Never invent Fam. surcharge without sibling price"
        />
      </div>
      <div className="field">
        <label htmlFor="decisionType">Decision type</label>
        <select id="decisionType" name="decisionType" defaultValue="OPERATOR_GUIDANCE">
          <option value="OPERATOR_GUIDANCE">Operator guidance (general)</option>
          <option value="VARIANT_SEMANTICS">Variant semantics</option>
          <option value="ADDITION_SCOPE">Addition / Tilbehør scope</option>
          <option value="INGREDIENT_SEMANTICS">Ingredient semantics</option>
          <option value="CATEGORY_MAPPING">Category mapping</option>
          <option value="LABEL_QUALITY">Label quality</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="body">Policy text</label>
        <textarea
          id="body"
          name="body"
          required
          rows={5}
          placeholder="Write the rule in plain language…"
        />
      </div>
      {error ? <p className="error">{error}</p> : null}
      {ok ? <p className="ok-msg">{ok}</p> : null}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save global policy"}
      </button>
    </form>
  );
}
