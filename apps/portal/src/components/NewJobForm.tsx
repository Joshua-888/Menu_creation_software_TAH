"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { RestaurantOption } from "@engine/portal/merchantDashboard.js";

type Mode = "existing" | "new";

export function NewJobForm({
  workflow = "CREATE_MENU",
  restaurants = [],
}: {
  workflow?: "CREATE_MENU" | "QA_RECONCILE";
  restaurants?: RestaurantOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isQa = workflow === "QA_RECONCILE";
  const hasExisting = restaurants.length > 0;
  const [mode, setMode] = useState<Mode>(hasExisting ? "existing" : "new");
  const [selectedKey, setSelectedKey] = useState(
    hasExisting ? restaurants[0]!.restaurantKey : "",
  );

  const selected = useMemo(
    () => restaurants.find((r) => r.restaurantKey === selectedKey) ?? null,
    [restaurants, selectedKey],
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("workflow", workflow);
    if (mode === "existing") {
      if (!selected) {
        setError("Select a restaurant");
        setBusy(false);
        return;
      }
      fd.set("merchantName", selected.merchantName);
      fd.set("destinationHost", selected.destinationHost);
    }
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

      {hasExisting ? (
        <div className="field">
          <label>Restaurant</label>
          <div className="choice-row">
            <label className="choice">
              <input
                type="radio"
                name="restaurantMode"
                value="existing"
                checked={mode === "existing"}
                onChange={() => setMode("existing")}
              />
              Existing restaurant
            </label>
            <label className="choice">
              <input
                type="radio"
                name="restaurantMode"
                value="new"
                checked={mode === "new"}
                onChange={() => setMode("new")}
              />
              New restaurant
            </label>
          </div>
        </div>
      ) : null}

      {mode === "existing" && hasExisting ? (
        <div className="field">
          <label htmlFor="restaurantKey">Select restaurant</label>
          <select
            id="restaurantKey"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
          >
            {restaurants.map((r) => (
              <option key={r.restaurantKey} value={r.restaurantKey}>
                {r.merchantName} — {r.destinationHost}
              </option>
            ))}
          </select>
          {selected ? (
            <span className="muted">
              Destination host: {selected.destinationHost}
            </span>
          ) : null}
        </div>
      ) : (
        <>
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
        </>
      )}

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
              PDF preferred. Clear menu photos (JPEG/PNG) are OCR’d (max 100MB).
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
