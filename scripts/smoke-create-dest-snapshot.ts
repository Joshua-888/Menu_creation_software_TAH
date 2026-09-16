/**
 * Smoke: Create ARTIFACTS live destination snapshot for a host.
 * Usage: npx tsx scripts/smoke-create-dest-snapshot.ts [host]
 */
import { loadDestinationSnapshotForDryRun } from "../src/portal/liveExecute.js";

const host = process.argv[2] || "bellakebab.dk";
const started = Date.now();
const result = await loadDestinationSnapshotForDryRun({
  destinationHost: host,
  deep: false,
});
console.log(
  JSON.stringify(
    {
      host,
      ms: Date.now() - started,
      source: result.source,
      categories: result.destination.categories.length,
      products: result.destination.products.length,
      error: result.error ?? null,
    },
    null,
    2,
  ),
);
if (result.source !== "live") process.exit(1);
