"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = {
  id: string;
  label: string;
  resolution: string;
  help?: string;
};

type Question = {
  id: string;
  jobId: string;
  title: string;
  prompt: string;
  optionsJson: string;
  productRef: string | null;
  batchKey: string | null;
  decisionCaseId?: string | null;
};

export function ReviewQueueClient({ questions }: { questions: Question[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(
    q: Question,
    option: Option,
    scope: "single" | "batch_similar",
  ) {
    setBusyId(q.id);
    setError(null);
    try {
      const res = await fetch("/api/review/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: q.id,
          selectedOptionId: option.id,
          resolution: option.resolution,
          scopePreference: scope,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Failed to save answer");
        setBusyId(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusyId(null);
    }
  }

  if (!questions.length) {
    return <p className="muted">No open review questions.</p>;
  }

  return (
    <div>
      <div className="review-guide">
        <strong>How to decide</strong>
        <p>
          Peer practices (prices, Tilbehør, structure) already run automatically
          in the job. These buttons only clear blockers so the job can finish.
        </p>
        <ul>
          <li>
            <strong>Continue anyway</strong> — safe default when the rest of the
            menu looks fine and this is a messy PDF option stub.
          </li>
          <li>
            <strong>PDF is unclear</strong> — use when you will upload a better
            PDF and run again (does not re-scan by itself).
          </li>
          <li>
            <strong>Leave this product alone</strong> — ignore this line for now.
          </li>
        </ul>
        <p className="muted" style={{ marginBottom: 0 }}>
          For this queue type, answers are <strong>not</strong> saved as lasting
          “how we always do it” peer rules — they won’t train the system the
          wrong way for future merchants.
        </p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {questions.map((q) => {
        let options: Option[] = [];
        try {
          options = JSON.parse(q.optionsJson) as Option[];
        } catch {
          options = [];
        }
        return (
          <div className="question" key={q.id}>
            <strong>{q.title}</strong>
            <p style={{ margin: "0.35rem 0", whiteSpace: "pre-wrap" }}>
              {q.prompt}
            </p>
            <p className="muted">
              Job {q.jobId.slice(0, 14)}…
              {q.productRef ? ` · ${q.productRef}` : ""}
            </p>
            <div className="option-row">
              {options.map((opt) => (
                <div key={opt.id} className="option-stack">
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === q.id}
                    onClick={() => answer(q, opt, "single")}
                    title={opt.help}
                  >
                    {opt.label}
                  </button>
                  {opt.help ? (
                    <span className="option-help muted">{opt.help}</span>
                  ) : null}
                </div>
              ))}
              {q.batchKey && options[0] ? (
                <div className="option-stack">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyId === q.id}
                    onClick={() => answer(q, options[0]!, "batch_similar")}
                  >
                    Continue anyway for all similar
                  </button>
                  <span className="option-help muted">
                    Applies “Continue anyway” to every open item like this on
                    the same job.
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
