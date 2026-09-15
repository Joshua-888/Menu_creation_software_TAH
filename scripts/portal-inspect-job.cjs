const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const jobId = "job_5b75ff0a-f810-4e20-bbcf-67480354415d";
const db = new DatabaseSync("/data/portal/portal.sqlite");
const j = db.prepare(
  "SELECT id, status, remaining_questions, error_message, updated_at FROM jobs WHERE id = ?",
).get(jobId);
console.log("JOB", JSON.stringify(j));
const r = db.prepare(
  "SELECT id, status, finished_at, metrics_json, error_message FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1",
).get(jobId);
console.log("RUN", JSON.stringify(r));
const q = db
  .prepare(
    "SELECT count(*) AS c FROM review_questions WHERE job_id = ? AND status = 'open'",
  )
  .get(jobId);
console.log("OPEN_Q", JSON.stringify(q));
console.log(
  "SUMMARY",
  fs.readFileSync(
    `/data/portal/runs/${jobId}/run_41bd145b-1570-48be-a19f-4af622270be7/dry-run-summary.json`,
    "utf8",
  ),
);
