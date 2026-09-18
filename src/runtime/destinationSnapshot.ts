import type { DryRunDestinationSnapshot } from "../planning/dryRun.js";

export type SnapshotBlocker = {
  code:
    | "LOGIN_FAILED"
    | "BROWSER_RUNTIME_UNAVAILABLE"
    | "NETWORK_FAILED"
    | "CONTRACT_FAILED"
    | "SNAPSHOT_TRUNCATED"
    | "PARTIAL_READ_ERRORS"
    | "TIMEOUT"
    | "UNKNOWN";
  message: string;
};

export type DestinationSnapshotMeta = {
  categoryCount: number;
  productCount: number;
  pagesRead: number;
  complete: boolean;
  errors: string[];
};

export type DestinationSnapshotResult =
  | {
      status: "LIVE_COMPLETE";
      snapshot: DryRunDestinationSnapshot;
      meta: DestinationSnapshotMeta;
    }
  | {
      status: "LIVE_PARTIAL_WITH_ERRORS";
      snapshot: DryRunDestinationSnapshot;
      meta: DestinationSnapshotMeta;
      blocker: SnapshotBlocker;
    }
  | {
      status: "OFFLINE_EXPLICIT";
      reason: string;
    }
  | {
      status: "FAILED";
      blocker: SnapshotBlocker;
    };

export function snapshotMetaFrom(
  snapshot: DryRunDestinationSnapshot,
  extra?: Partial<DestinationSnapshotMeta>,
): DestinationSnapshotMeta {
  return {
    categoryCount: snapshot.categories.length,
    productCount: snapshot.products.length,
    pagesRead: extra?.pagesRead ?? 1,
    complete: extra?.complete ?? true,
    errors: extra?.errors ?? [],
  };
}

export function isLiveComplete(
  result: DestinationSnapshotResult,
): result is Extract<DestinationSnapshotResult, { status: "LIVE_COMPLETE" }> {
  return result.status === "LIVE_COMPLETE";
}

/** Planning/execution may only use LIVE_COMPLETE. Never treat FAILED as empty catalog. */
export function requireLiveCompleteSnapshot(
  result: DestinationSnapshotResult,
  purpose: "CREATE" | "QA" | "EXECUTE",
): DryRunDestinationSnapshot {
  if (result.status === "LIVE_COMPLETE") return result.snapshot;
  if (result.status === "OFFLINE_EXPLICIT") {
    throw new Error(
      `${purpose} requires LIVE_COMPLETE destination snapshot; got OFFLINE_EXPLICIT (${result.reason}). Offline planning cannot become live-executable.`,
    );
  }
  if (result.status === "LIVE_PARTIAL_WITH_ERRORS") {
    throw new Error(
      `${purpose} refuses LIVE_PARTIAL_WITH_ERRORS: ${result.blocker.message}`,
    );
  }
  throw new Error(
    `${purpose} refuses FAILED snapshot (${result.blocker.code}): ${result.blocker.message}`,
  );
}
