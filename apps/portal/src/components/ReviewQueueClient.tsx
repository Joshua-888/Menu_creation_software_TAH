"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { id: string; label: string; resolution: string };

type Question = {
  id: string;
  jobId: string;
  title: string;
  prompt: string;
  optionsJson: string;
  productRef: string | null;
  batchKey: string | null;
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
            <p style={{ margin: "0.35rem 0" }}>{q.prompt}</p>
            <p className="muted">
              Job {q.jobId}
              {q.productRef ? ` · ${q.productRef}` : ""}
              {q.batchKey ? ` · batch ${q.batchKey}` : ""}
            </p>
            <div className="option-row">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="btn"
                  disabled={busyId === q.id}
                  onClick={() => answer(q, opt, "single")}
                >
                  {opt.label}
                </button>
              ))}
              {q.batchKey ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busyId === q.id || !options[0]}
                  onClick={() => options[0] && answer(q, options[0], "batch_similar")}
                >
                  Apply first option to similar
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
