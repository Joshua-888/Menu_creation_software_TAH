/**
 * Stable pointers for peer observe + probability policy artifacts.
 * Scripts and the M76 pipeline resolve "latest" instead of hard-coded timestamps.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { PeerMenuSnapshot } from "./peerMenuStructure.js";
import type { ProbabilityPolicyMap } from "./categoryLikelihood.js";
import { distillProbabilityPolicy } from "./categoryLikelihood.js";
import type { AdditionLikelihoodPolicy } from "./additionLikelihood.js";
import { distillAdditionLikelihood } from "./additionLikelihood.js";

export const LATEST_PEER_OBSERVE_FILENAME = "latest-peer-observe.json";
export const PEER_PROBABILITY_POLICY_FILENAME = "peer-probability-policy.json";
export const PEER_ADDITION_LIKELIHOOD_FILENAME =
  "peer-addition-likelihood.json";
export const PEER_STRUCTURE_SUMMARY_FILENAME = "peer-structure-summary.json";
export const LATEST_POLICY_APPLICATION_FILENAME =
  "latest-policy-application.json";

export type LatestPeerObservePointer = {
  observedAt: string;
  outDir: string;
  mode?: string;
  hosts?: string[];
  structureFingerprint?: string;
  policyId?: string;
  storePath?: string;
};

export function decisionsDir(repoRoot: string): string {
  return join(repoRoot, "runs", "decisions");
}

export function latestPeerObservePath(repoRoot: string): string {
  return join(decisionsDir(repoRoot), LATEST_PEER_OBSERVE_FILENAME);
}

export function peerProbabilityPolicyPath(repoRoot: string): string {
  return join(decisionsDir(repoRoot), PEER_PROBABILITY_POLICY_FILENAME);
}

export function peerAdditionLikelihoodPath(repoRoot: string): string {
  return join(decisionsDir(repoRoot), PEER_ADDITION_LIKELIHOOD_FILENAME);
}

export function peerStructureSummaryPath(repoRoot: string): string {
  return join(decisionsDir(repoRoot), PEER_STRUCTURE_SUMMARY_FILENAME);
}

export function writeLatestPeerObservePointer(
  repoRoot: string,
  pointer: LatestPeerObservePointer,
): string {
  const dir = decisionsDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const path = latestPeerObservePath(repoRoot);
  writeFileSync(path, JSON.stringify(pointer, null, 2));
  return path;
}

export function readLatestPeerObservePointer(
  repoRoot: string,
): LatestPeerObservePointer | null {
  const path = latestPeerObservePath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LatestPeerObservePointer;
  } catch {
    return null;
  }
}

/** Prefer latest pointer; else newest m71-peer-observe-* under runs/discovery. */
export function resolvePeerObserveDir(repoRoot: string): string | null {
  const pointer = readLatestPeerObservePointer(repoRoot);
  if (pointer?.outDir && existsSync(pointer.outDir)) {
    return pointer.outDir;
  }
  const discovery = join(repoRoot, "runs", "discovery");
  if (!existsSync(discovery)) return null;
  const dirs = readdirSync(discovery, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("m71-peer-observe-"))
    .map((d) => d.name)
    .sort();
  const last = dirs[dirs.length - 1];
  return last ? join(discovery, last) : null;
}

export function loadPeerSnapshotsFromDir(peerDir: string): PeerMenuSnapshot[] {
  const files = readdirSync(peerDir).filter(
    (f) => f.startsWith("peer-") && f.endsWith(".json"),
  );
  const out: PeerMenuSnapshot[] = [];
  for (const f of files) {
    try {
      out.push(
        JSON.parse(readFileSync(join(peerDir, f), "utf8")) as PeerMenuSnapshot,
      );
    } catch {
      /* skip corrupt peer file */
    }
  }
  return out;
}

export function loadPeerSnapshots(repoRoot: string): PeerMenuSnapshot[] {
  const peerDir = resolvePeerObserveDir(repoRoot);
  if (!peerDir) return [];
  return loadPeerSnapshotsFromDir(peerDir);
}

export function loadProbabilityPolicy(
  repoRoot: string,
): ProbabilityPolicyMap | null {
  const path = peerProbabilityPolicyPath(repoRoot);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as ProbabilityPolicyMap;
    } catch {
      return null;
    }
  }
  try {
    const snaps = loadPeerSnapshots(repoRoot);
    if (snaps.length === 0) return null;
    return distillProbabilityPolicy(snaps);
  } catch {
    return null;
  }
}

/**
 * Peer probability policies are Veroni/pilot-shaped by default.
 * New merchants must opt in via PORTAL_APPLY_PEER_PROBABILITY_HOSTS
 * or PORTAL_APPLY_PEER_PROBABILITY=1 (all hosts).
 */
export function shouldApplyPeerProbabilityPolicy(
  restaurantKey: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    env.PORTAL_APPLY_PEER_PROBABILITY === "1" ||
    env.PORTAL_APPLY_PEER_PROBABILITY === "true"
  ) {
    return true;
  }
  const host = restaurantKey.trim().toLowerCase().replace(/^www\./, "");
  if (host === "veronipizza.dk") return true;
  const extra = (env.PORTAL_APPLY_PEER_PROBABILITY_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
  return extra.includes(host);
}

export function loadProbabilityPolicyForRestaurant(
  repoRoot: string,
  restaurantKey: string,
  env: NodeJS.ProcessEnv = process.env,
): ProbabilityPolicyMap | null {
  if (!shouldApplyPeerProbabilityPolicy(restaurantKey, env)) return null;
  return loadProbabilityPolicy(repoRoot);
}

export function writeProbabilityPolicyArtifact(
  repoRoot: string,
  policy: ProbabilityPolicyMap,
): string {
  const dir = decisionsDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const path = peerProbabilityPolicyPath(repoRoot);
  writeFileSync(path, JSON.stringify(policy, null, 2));
  return path;
}

export function loadAdditionLikelihood(
  repoRoot: string,
): AdditionLikelihoodPolicy | null {
  const path = peerAdditionLikelihoodPath(repoRoot);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as AdditionLikelihoodPolicy;
    } catch {
      return null;
    }
  }
  try {
    const snaps = loadPeerSnapshots(repoRoot);
    if (snaps.length === 0) return null;
    return distillAdditionLikelihood(snaps);
  } catch {
    return null;
  }
}

export function writeAdditionLikelihoodArtifact(
  repoRoot: string,
  policy: AdditionLikelihoodPolicy,
): string {
  const dir = decisionsDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const path = peerAdditionLikelihoodPath(repoRoot);
  writeFileSync(path, JSON.stringify(policy, null, 2));
  return path;
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
