"use client";

import Link from "next/link";
import { useState } from "react";
import type { RestaurantOption } from "@engine/portal/merchantDashboard.js";
import type { QaDashboardModel } from "@engine/portal/qaDashboard.js";
import { NewJobForm } from "../NewJobForm";
import {
  Badge,
  StatGrid,
  StatTile,
  Table,
  TableBody,
  TableHead,
  TableRow,
  TableWrap,
  Td,
  Th,
} from "../ui";

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

/**
 * Quality-check dashboard: aggregate QA_RECONCILE stats, the QA jobs table and
 * a collapsible "start new check" panel. It only displays what the store and
 * artifacts already recorded — no job state is derived or mutated here.
 */
export function QaDashboardView({
  model,
  restaurants,
}: {
  model: QaDashboardModel;
  restaurants: RestaurantOption[];
}) {
  const [showNewCheck, setShowNewCheck] = useState(false);
  const { stats, rows } = model;

  return (
    <div className="qa-dashboard">
      <StatGrid>
        <StatTile value={stats.totalQaJobs} label="QA jobs" />
        <StatTile value={stats.awaitingReview} label="Awaiting review" />
        <StatTile value={stats.comparedProducts} label="Products compared" />
        <StatTile value={stats.diffsFound} label="Diffs found" />
      </StatGrid>

      <div className="panel">
        <h2>Quality checks</h2>
        {rows.length === 0 ? (
          <p className="muted">
            No quality checks yet. Start one below to compare a live menu
            against its intended state.
          </p>
        ) : (
          <TableWrap>
            <Table>
              <TableHead>
                <TableRow>
                  <Th>Merchant</Th>
                  <Th>Destination</Th>
                  <Th>Status</Th>
                  <Th>Diff summary</Th>
                  <Th>Open questions</Th>
                  <Th>Updated</Th>
                  <Th>Actions</Th>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.jobId}>
                    <Td>{row.merchantName}</Td>
                    <Td>
                      <code>{row.destinationHost}</code>
                    </Td>
                    <Td>
                      <Badge tone={row.tone}>{row.statusLabel}</Badge>
                    </Td>
                    <Td>{row.diffSummary}</Td>
                    <Td>{row.remainingQuestions}</Td>
                    <Td className="muted">{formatUpdatedAt(row.updatedAt)}</Td>
                    <Td>
                      <div className="table-actions">
                        <Link className="btn btn-ghost btn-compact" href={`/jobs/${row.jobId}`}>
                          Inspect findings
                        </Link>
                        <Link
                          className="btn btn-secondary btn-compact"
                          href={`/review?job=${row.jobId}`}
                        >
                          Open review
                        </Link>
                      </div>
                    </Td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </div>

      <div className="panel">
        <button
          type="button"
          className="btn btn-secondary"
          aria-expanded={showNewCheck}
          onClick={() => setShowNewCheck((value) => !value)}
        >
          {showNewCheck ? "Cancel" : "Start new QA check"}
        </button>
        {showNewCheck ? (
          <div className="qa-new-check">
            <NewJobForm workflow="QA_RECONCILE" restaurants={restaurants} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
