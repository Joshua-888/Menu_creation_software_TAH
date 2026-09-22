import {
  Panel,
  Table,
  TableBody,
  TableHead,
  TableRow,
  TableWrap,
  Td,
  Th,
} from "../ui";
import type {
  JobRun,
  MigrationJob,
  ReviewAnswer,
} from "@engine/portal/types.js";
import { buildJobHistory, type HistoryKind } from "./historyView.js";

const KIND_LABEL: Record<HistoryKind, string> = {
  CREATED: "Created",
  RUN: "Run",
  REVIEW_ANSWER: "Review",
  APPROVAL: "Approval",
  EXECUTION: "Execution",
};

function formatAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * Chronological history: job creation, run start/finish, review answers, the
 * approval event and execution attempts. Read-only; sourced from the store's
 * listJobRuns / listReviewAnswers queries.
 */
export function JobHistoryTimeline({
  job,
  runs,
  reviewAnswers,
  employeeNames,
}: {
  job: Pick<MigrationJob, "createdAt" | "workflow" | "status">;
  runs: JobRun[];
  reviewAnswers: ReviewAnswer[];
  employeeNames?: Record<string, string>;
}) {
  const entries = buildJobHistory({ job, runs, reviewAnswers, employeeNames });
  return (
    <Panel title="History">
      {entries.length === 0 ? (
        <p className="muted">No history yet.</p>
      ) : (
        <TableWrap>
          <Table>
            <TableHead>
              <TableRow>
                <Th>When</Th>
                <Th>Event</Th>
                <Th>Detail</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry, index) => (
                <TableRow key={`${entry.kind}-${entry.at}-${index}`}>
                  <Td>{formatAt(entry.at)}</Td>
                  <Td>
                    {KIND_LABEL[entry.kind]} · {entry.title}
                  </Td>
                  <Td>{entry.detail}</Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </Panel>
  );
}
