/**
 * Smoke: Create ARTIFACTS live destination snapshot (READ ONLY).
 * Usage: npx tsx scripts/smoke-create-dest-snapshot.ts [host]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDestinationSnapshotForDryRun } from "../src/portal/liveExecute.js";
import { normalizeDestinationHost } from "../src/portal/liveWrites.js";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(join(process.cwd(), ".env"));

const host = normalizeDestinationHost(process.argv[2] || "bellakebab.dk");
const started = Date.now();
const result = await loadDestinationSnapshotForDryRun({
  destinationHost: host,
  deep: false,
});
const snapshotHost = result.destination.host
  ? normalizeDestinationHost(result.destination.host)
  : "";
const hostMatch = snapshotHost === host;
const payload = {
  requestedHost: host,
  snapshotHost: snapshotHost || null,
  hostMatch,
  ms: Date.now() - started,
  source: result.source,
  categories: result.destination.categories.length,
  products: result.destination.products.length,
  categoryNames: result.destination.categories.map((c) => c.name),
  productNames: result.destination.products.map((p) => p.name),
  error: result.error ?? null,
};
console.log(JSON.stringify(payload, null, 2));
if (result.source !== "live") process.exit(1);
if (!hostMatch) {
  console.error("DESTINATION_HOST_MISMATCH");
  process.exit(1);
}
