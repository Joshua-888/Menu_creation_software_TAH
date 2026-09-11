import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPortalStore, type PortalStore } from "./store.js";

/** Read a JSON artifact from the latest job run (no extraction imports). */
export function readJobArtifact(
  jobId: string,
  name: string,
  store: PortalStore = getPortalStore(),
): unknown | null {
  const run = store.latestJobRun(jobId);
  if (!run?.runDir) return null;
  const path = join(run.runDir, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}
